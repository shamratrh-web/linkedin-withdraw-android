import { DeepSeekAPI } from '/data/data/com.termux/files/home/resume-forge-ai/lib/ai/DeepSeek.ts';

const TOKEN = process.env.DEEPSEEK_TOKEN || '';
if (!TOKEN) { console.error('ERROR: DEEPSEEK_TOKEN required'); process.exit(1); }

const api = new DeepSeekAPI(TOKEN);

async function classify(screenshotPath: string, ocrText: string): Promise<string> {
  await api.init();
  const sessionId = await api.createSession();

  // Upload screenshot so DeepSeek sees the actual post content
  let refFileIds: string[] = [];
  try {
    const fileInfo = await api.uploadReferenceFile(screenshotPath);
    await api.waitForFileReady(fileInfo.id);
    refFileIds = [fileInfo.id];
  } catch (e: any) {
    console.error('Upload failed, falling back to OCR: ' + (e?.message || e));
  }

  const prompt = `You are on LinkedIn. You can see the current screen in the attached screenshot.

Look at the feed posts VISIBLE on screen. For each post:
1. Read the actual post content (the text in the post body)
2. Only if you can clearly read post content (not just UI buttons): generate a thoughtful, specific, natural-language comment.
3. The comment MUST be relevant to THAT specific post's content — mention details from the post.
4. If you cannot read any post content clearly, say SCROLL.

Additional OCR text (may help): """${ocrText.slice(0, 1000)}"""

Reply exactly:
SCREEN: FEED|FEED_POST|COMMENT_BOX|OTHER
ACTION: ENGAGE|SCROLL|GO_BACK|DONE
LIKE: yes|no
COMMENT: <specific thoughtful comment referencing post content, or empty>
REASON: <brief>`;

  const gen = api.chatCompletion(sessionId, prompt, false, refFileIds);
  let result = '';
  let firstContent = 0;
  try {
    for await (const chunk of gen) {
      if (chunk.content) {
        if (!firstContent) firstContent = Date.now();
        result += chunk.content;
        if (Date.now() - firstContent > 6000) break;
      }
    }
  } finally {
    try { gen.return?.(); } catch {}
  }
  return result.trim() || 'SCREEN: OTHER\nACTION: SCROLL\nLIKE: no\nCOMMENT: \nREASON: no response';
}

const ssPath = process.argv[2] || '/sdcard/li_ss.png';
const ocrText = process.argv[3] || '';

classify(ssPath, ocrText)
  .then(r => console.log(r))
  .catch(e => { console.error(`ERROR: ${e?.message || e}`); process.exit(1); });
