# LinkedIn Withdraw Android App

## Overview

Android root app (Kotlin/Compose) that automates withdrawing sent LinkedIn invitations using OCR-based UI navigation. Runs as a ForegroundService with notification stop button and home screen widget.

## Architecture

```
MainActivity (Compose UI)
  ├── "Run" button → opens LinkedIn invitation manager deep link → starts WithdrawService
  └── "Stop" button → sends ACTION_STOP to WithdrawService

WithdrawService (ForegroundService)
  ├── runScript() → su -mm → /data/local/tmp/bash → ~/bin/linkedin
  ├── stopScript() → create stop flag → cancel coroutine → kill process tree
  └── Notification with "Stop" action → PendingIntent.getService(ACTION_STOP)

WithdrawWidget (AppWidgetProvider)
  └── WithdrawReceiver → starts WithdrawService on widget click
```

## Key Files

| File | Purpose |
|---|---|
| `app/.../MainActivity.kt` | Compose UI with Run/Stop buttons, opens LinkedIn deep link |
| `app/.../WithdrawService.kt` | ForegroundService, process management, stop mechanism |
| `app/.../WithdrawReceiver.kt` | Widget click BroadcastReceiver |
| `app/.../WithdrawWidget.kt` | Home screen widget provider |
| `~/bin/linkedin` | Main script: OCR + navigation + withdraw loop |
| `~/linkedin-scripts/linkedin` | Original working script (reference) |

## Script Flow (`~/bin/linkedin`)

1. **su_sys()** — wrapper around `/debug_ramdisk/su -c` that unsets `LD_LIBRARY_PATH LD_PRELOAD` before system commands (critical — Termux libs break `screencap`/`input`)
2. **Wait** — 5s for LinkedIn to load invitation manager
3. **Find "Sent"** — OCR via tesseract on full screenshot (fallback: cropped top 600px), retries 4x with swipe between attempts
4. **Scroll to bottom** — hash-based detection (md5sum consecutive screenshots, 2 identical → bottom)
5. **Scroll back up** — 3 swipes to start from top
6. **Withdraw loop** — OCR "Withdraw" → tap → confirm dialog at (780, 2250) → repeat up to 50
7. **Stop flag** — polls `/data/local/tmp/linkedin-stop-flag` at each iteration; checked before every blocking operation

## Critical Implementation Details

### `LD_LIBRARY_PATH` Poisoning (Root Cause of Sent-not-found Bug)

Termux's `su` wrapper (`/data/data/com.termux/files/usr/bin/su`) unsets `LD_LIBRARY_PATH` before calling Magisk's `/debug_ramdisk/su`:
```sh
unset LD_LIBRARY_PATH LD_PRELOAD
exec /debug_ramdisk/su "$@"
```

Without this, system tools (`screencap`, `input`) load Termux libraries instead of system ones and malfunction silently (corrupted screenshots → OCR finds nothing).

**Our fix**: `su_sys()` function wraps every system command with:
```sh
unset LD_LIBRARY_PATH LD_PRELOAD; PATH=/debug_ramdisk:/sbin:/system/bin:/system/xbin $*
```

Termux binaries (`tesseract`, `convert`) run in the bash script process where `LD_LIBRARY_PATH` IS set — so they find Termux libraries correctly.

### Deep Link for Invitation Manager

```kotlin
val intent = Intent(Intent.ACTION_VIEW,
    Uri.parse("https://www.linkedin.com/mynetwork/invitation-manager/"))
```

Must use deep link, not `getLaunchIntentForPackage()` (which opens LinkedIn home page where "Sent" tab is invisible).

### BAL (Background Activity Launch)

- `am start` from ForegroundService fails (no visible window → BAL blocks it)
- `am start` from Termux/root shell with visible terminal works
- **Solution**: Kotlin Activity (has visible window) opens LinkedIn via `startActivity()` directly before starting service

### Process Execution

```
ProcessBuilder
  └── /debug_ramdisk/su -mm sh -c "PREFIX=... TESSDATA_PREFIX=... PATH=... LD_LIBRARY_PATH=... /data/local/tmp/bash /script"
      └── su -mm enters global mount namespace as root with full capabilities
          └── sh -c sets environment variables
              └── /data/local/tmp/bash /script runs main logic
```

- `/data/local/tmp/bash` is a copy of Termux's bash (SELinux context fix — `shell_data_file`)

### Stop Mechanism

**Layered approach** (best-effort):

1. **Stop flag file** (`/data/local/tmp/linkedin-stop-flag`): Cooperative, script polls at each iteration
2. **Coroutine cancellation**: `scriptJob.cancel()` interrupts the reading thread → `CancellationException` → cleanup
3. **Process destruction**: `process.destroy()` (SIGTERM) → 3s timeout → `process.destroyForcibly()` (SIGKILL)

### Environment Variables for Script

```
PREFIX=/data/data/com.termux/files/usr
TESSDATA_PREFIX=/data/data/com.termux/files/usr/share/tessdata
HOME=/data/data/com.termux/files/home
PATH=/data/data/com.termux/files/usr/bin:/debug_ramdisk:/sbin:/system/bin:/system/xbin
LD_LIBRARY_PATH=/data/data/com.termux/files/usr/lib
SHELL=/data/data/com.termux/files/usr/bin/bash
```

### OCR Details

- **Engine**: tesseract with eng traineddata
- **Confidence threshold**: 30 (lowered from original 50 for reliability)
- **Full image OCR first**, fallback to cropped top 600px
- "Sent" is found at approximately top of invitation manager screen
- "Withdraw" is filtered by Y range (400 < y < 1800) — bottom-right of each sent invitation card
- Dialog confirm at fixed position (780, 2250)

### Known Screen Geometry

- Resolution: 1080 × 2412
- "Sent" tab: ~(345, 324) — top of invitation manager
- "Withdraw" button: bottom-right of each card, ~x=835, width=192
- Dialog confirm: (780, 2250) — right-side button in bottom sheet

## Dependencies

- Android SDK 34, minSdk 26
- Gradle 8.11.1, AGP 8.7.3, Kotlin 2.1.0
- Jetpack Compose (BOM 2024.06.00)
- JDK 21 (Termux), Gradle configured with `org.gradle.java.home`
- tesseract, ImageMagick (`convert`), md5sum (via Termux)
- Magisk root with `/debug_ramdisk/su`
- Termux with `bash` copied to `/data/local/tmp/bash`

## Git Repositories

- **Android app**: `~/linkedin-android/` (not yet pushed)
- **Original script**: `~/linkedin-scripts/` — `shamratrh-web/linkedin-scripts` (private)

## Troubleshooting

### "Not going to Sent tab"
1. Check `/sdcard/linkedin-debug.log` for OCR output
2. Verify `su_sys` is used (LD_LIBRARY_PATH unset before system cmds)
3. Check that deep link URL is correct
4. Lower tesseract confidence threshold if needed

### Stop not working
1. Check `/sdcard/linkedin-debug.log` for stop flag detection
2. Verify `su -mm` is used for stop flag creation (not `su -c`)
3. Process tree may survive because **Magisk `su` is an IPC client** — `su` connects to `magiskd`, which forks the actual shell. `Process.destroy()` only kills the `su` client, not the shell.
4. Stop mechanism is **stop flag only** (cooperative) — script polls at every iteration. Never use PID reflection or process group killing (`kill -TERM -$PID`) — PID may be reused and kill a critical system process.
5. Coroutine cancellation via `scriptJob.cancel()` + `runInterruptible` for responsive thread interruption
6. `onDestroy()` just cancels scope and stops service — no process destruction

### Screenshot issues
1. Verify `screencap` works via `su_sys` (LD_LIBRARY_PATH issue)
2. Check file permissions on `/sdcard/`
3. Verify `convert` (ImageMagick) is available

## Research-Backed Design Decisions

### Magisk su Architecture
`su` is NOT a simple setuid binary — it's an IPC client to `magiskd`:
```
caller process
  └─ su -mm sh -c "bash /script"    ← IPC client, connects to magiskd
magiskd (runs as root)
  └─ sh -c "bash /script"           ← actual shell, forked by magiskd
      └─ bash /script               ← child of sh
```
Killing the `su` IPC client (via `Process.destroy()`) does NOT kill the shell. This is why:
- Stop flag is the ONLY mechanism used (cooperative shutdown)
- PID reflection and process group killing are AVOIDED — PID can be reused and kill the wrong process  
  
### Process Architecture (for context)
- The `su -mm` client is a thin IPC bridge to `magiskd`. The actual shell is `magiskd`'s child, not `su`'s child.
- `process.destroy()` (SIGTERM) only kills the `su` IPC client — NOT the shell or script.
- Therefore the stop flag is the sole stop mechanism. The script polls it before every blocking operation.
- On process exit (`su` client terminates), `magiskd` cleans up the shell automatically.

### Coroutine + Process Pattern
- `currentCoroutineContext().ensureActive()` between blocking reads for cooperative cancellation
- `runInterruptible` bridges coroutine cancellation → thread interruption
- `invokeOnCompletion` ensures process is destroyed even if coroutine is stuck in blocking I/O
- `withContext(Dispatchers.IO)` for all blocking operations
- Single cleanup path in `finally` block
