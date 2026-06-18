import { DeepSeekAPI } from '/data/data/com.termux/files/home/resume-forge-ai/lib/ai/DeepSeek.ts';

const TOKEN = process.env.DEEPSEEK_TOKEN || '';
if (!TOKEN) { console.error('ERROR: DEEPSEEK_TOKEN required'); exit(1); }

const api = new DeepSeekAPI(TOKEN);

async function classify(ocrText: string): Promise<string> {
  await api.init();
  const sessionId = await api.createSession();

  const gen = api.chatCompletion(sessionId,
    `You are classifying a LinkedIn Android screen from OCR text. Pick exactly ONE:

SCREEN = SENT_LIST (sent invites visible with Withdraw buttons)
        | RECEIVED_LIST (received invites with Accept/Ignore)
        | MANAGE (Manage heading + Sent/Received tabs)
        | CONFIRM (Withdraw confirmation dialog)
        | FEED (home feed)
        | EMPTY (no invites)
        | UNKNOWN

ACTION = TAP_WITHDRAW | TAP_SENT | TAP_CONFIRM | SCROLL_DOWN | SCROLL_UP | GO_BACK | DONE | WAIT

Reply ONLY these 3 lines, nothing else:
SCREEN: <one choice>
ACTION: <one choice>
REASON: <one line reason>

OCR text: """${ocrText.slice(0, 2000)}"""`,
    false, []
  );

  let result = '';
  let firstContent = 0;
  try {
    for await (const chunk of gen) {
      if (chunk.content) {
        if (!firstContent) firstContent = Date.now();
        result += chunk.content;
        if (Date.now() - firstContent > 3000) break;
      }
    }
  } finally {
    try { gen.return?.(); } catch {}
  }
  return result.trim() || 'SCREEN: UNKNOWN\nACTION: WAIT\nREASON: no AI response';
}

const ocrText = process.argv[2];
if (!ocrText) { console.error('Usage: analyze.ts <ocr-text>'); process.exit(1); }

classify(ocrText).then(r => console.log(r)).catch(e => { console.error(`ERROR: ${e?.message || e}`); process.exit(1); });
