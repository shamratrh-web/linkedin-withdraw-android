package com.linkedin.withdraw

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.io.FileWriter
import java.util.concurrent.TimeUnit

class WithdrawService : Service() {

    companion object {
        const val ACTION_START = "com.linkedin.withdraw.START"
        const val ACTION_STOP = "com.linkedin.withdraw.STOP"
        const val CHANNEL_ID = "withdraw_channel"
        const val NOTIFICATION_ID = 1001
        const val STOP_FLAG = "/data/local/tmp/linkedin-stop-flag"
        const val LOG_FILE = "/sdcard/linkedin-debug.log"
        const val BASH_COPY = "/data/local/tmp/bash"

        private val _isRunning = MutableStateFlow(false)
        val isRunning: StateFlow<Boolean> = _isRunning.asStateFlow()

        private val _statusText = MutableStateFlow("Tap Run to withdraw invitations")
        val statusText: StateFlow<String> = _statusText.asStateFlow()
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var process: Process? = null
    private var scriptJob: Job? = null
    private lateinit var notificationManager: NotificationManager

    override fun onCreate() {
        super.onCreate()
        notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopScript()
            ACTION_START -> if (!_isRunning.value) startScript()
        }
        return START_NOT_STICKY
    }

    private fun startScript() {
        _isRunning.value = true
        _statusText.value = "Starting..."
        showNotification("Starting...")
        scriptJob = scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    runScript()
                }
            } finally {
                cleanup()
            }
        }
    }

    private fun stopScript() {
        log("=== STOP REQUESTED ===")
        createStopFlag()
        scriptJob?.cancel()
        scriptJob = null
        log("=== STOP SENT ===")
    }

    private fun createStopFlag() {
        try {
            Runtime.getRuntime().exec(arrayOf(
                "/debug_ramdisk/su", "-mm",
                "sh", "-c",
                "unset LD_LIBRARY_PATH LD_PRELOAD; echo > $STOP_FLAG"
            )).waitFor(3, TimeUnit.SECONDS)
        } catch (_: Exception) {}
    }

    private suspend fun runScript() {
        log("=== SCRIPT START ===")
        showNotification("Starting...")

        suCmd("rm -f $STOP_FLAG")
        val copyOk = suCmd(
            "cp /data/data/com.termux/files/usr/bin/bash $BASH_COPY && " +
            "chmod 755 $BASH_COPY && " +
            "restorecon $BASH_COPY 2>/dev/null || " +
            "chcon u:object_r:shell_data_file:s0 $BASH_COPY 2>/dev/null || true"
        )
        log("copy bash: $copyOk")

        val scriptPath = "/data/data/com.termux/files/home/bin/linkedin"
        val cmd = arrayOf("/debug_ramdisk/su", "-mm",
            "sh", "-c",
            "PREFIX=/data/data/com.termux/files/usr " +
            "TESSDATA_PREFIX=/data/data/com.termux/files/usr/share/tessdata " +
            "HOME=/data/data/com.termux/files/home " +
            "PATH=/data/data/com.termux/files/usr/bin:/debug_ramdisk:/sbin:/system/bin:/system/xbin " +
            "LD_LIBRARY_PATH=/data/data/com.termux/files/usr/lib " +
            "SHELL=/data/data/com.termux/files/usr/bin/bash " +
            "$BASH_COPY $scriptPath")

        log("Running script")
        showNotification("Running...")

        val pb = ProcessBuilder(*cmd)
        pb.redirectErrorStream(true)
        val p = pb.start()
        process = p

        var lineCount = 0
        try {
            p.inputStream.bufferedReader().use { reader ->
                var line: String?
                while (true) {
                    currentCoroutineContext().ensureActive()
                    line = runInterruptible { reader.readLine() }
                    if (line == null) break
                    lineCount++
                    log("OUT: $line")
                    showNotification(line)
                }
            }
        } catch (_: InterruptedException) {
            log("Read interrupted")
        } catch (_: kotlinx.coroutines.CancellationException) {
            log("Cancelled during read")
        }

        if (currentCoroutineContext().isActive) {
            runInterruptible { p.waitFor(10, TimeUnit.SECONDS) }
            val exitCode = try { p.exitValue() } catch (_: IllegalThreadStateException) { -1 }
            log("Script exit: $exitCode, lines: $lineCount")
            showNotification("Done ($lineCount withdrawn)")
        } else {
            log("Script cancelled")
            showNotification("Stopped")
        }
    }

    private fun suCmd(args: String): Boolean {
        return try {
            val p = Runtime.getRuntime().exec(arrayOf(
                "/debug_ramdisk/su", "-mm",
                "sh", "-c",
                "unset LD_LIBRARY_PATH LD_PRELOAD; $args"
            ))
            p.waitFor(10, TimeUnit.SECONDS)
            p.exitValue() == 0
        } catch (_: Exception) {
            false
        }
    }

    private fun cleanup() {
        log("cleanup")
        _isRunning.value = false
        _statusText.value = "Stopped"
        process = null
        scriptJob = null
        try { stopForeground(STOP_FOREGROUND_REMOVE) } catch (_: Exception) {}
        try { stopSelf() } catch (_: Exception) {}
    }

    private fun log(msg: String) {
        try {
            FileWriter(File(LOG_FILE), true).use {
                it.appendLine("${System.currentTimeMillis()} $msg")
            }
        } catch (_: Exception) {}
    }

    private fun showNotification(text: String) {
        _statusText.value = text
        val stopIntent = Intent(this, WithdrawService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPendingIntent = PendingIntent.getService(
            this, 0, stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("LinkedIn Withdraw")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_delete)
            .setOngoing(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(android.R.drawable.ic_media_pause, "Stop", stopPendingIntent)
            .build()
        try {
            ServiceCompat.startForeground(
                this, NOTIFICATION_ID, notification,
                if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
            )
        } catch (_: Exception) {}
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID, "Withdraw Status", NotificationManager.IMPORTANCE_LOW
        ).apply {
            setShowBadge(false)
            lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
        }
        notificationManager.createNotificationChannel(channel)
    }

    override fun onDestroy() {
        log("onDestroy")
        scriptJob?.cancel()
        scope.cancel()
        try { stopForeground(STOP_FOREGROUND_REMOVE) } catch (_: Exception) {}
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
