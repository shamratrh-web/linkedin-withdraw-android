import { DeepSeekAPI } from '/data/data/com.termux/files/home/resume-forge-ai/lib/ai/DeepSeek.ts';

const TOKEN = process.env.DEEPSEEK_TOKEN || '';
if (!TOKEN) { console.error('ERROR: DEEPSEEK_TOKEN required'); process.exit(1); }

const api = new DeepSeekAPI(TOKEN);

async function classify(ocrText: string): Promise<string> {
  await api.init();
  const sessionId = await api.createSession();

  const gen = api.chatCompletion(sessionId,
    `You are a LinkedIn engagement assistant analyzing OCR text from the Android app.

FIRST, classify the screen:

SCREEN:
- FEED = LinkedIn home feed with posts (has "Start a post", news, posts with Like/Comment/Repost)
- FEED_POST = a single post expanded (has poster name, content, Like/Comment buttons visible)
- COMMENT_BOX = comment input field is open (text input area at bottom, "Post" button)
- PROFILE = a user profile page
- NOTIFICATIONS = notification panel
- MY_NETWORK = my network tab
- SENT_LIST = sent invitations with Withdraw buttons
- CONFIRM = confirmation dialog
- OTHER = something else

SECOND, decide action:

If on FEED with visible posts:
- Find the MOST INTERESTING post visible in the OCR text
- If a post is truly interesting/worthwhile: ACTION = ENGAGE, then output:
  LIKE: yes/no
  COMMENT: the actual comment text to post (2-3 sentences, thoughtful, professional)
  (The comment should be relevant to the post content)
- If no post is interesting: ACTION = SCROLL

If on COMMENT_BOX: ACTION = TYPE_COMMENT followed by the comment text, then POST

Other actions: SCROLL | LIKE | GO_BACK | DONE | WAIT

Reply exactly:
SCREEN: <one>
ACTION: <one>
LIKE: yes|no
COMMENT: <comment or empty>
REASON: <brief>`,
    false, []
  );

  let result = '';
  let firstContent = 0;
  try {
    for await (const chunk of gen) {
      if (chunk.content) {
        if (!firstContent) firstContent = Date.now();
        result += chunk.content;
        if (Date.now() - firstContent > 5000) break;
      }
    }
  } finally {
    try { gen.return?.(); } catch {}
  }
  return result.trim() || 'SCREEN: OTHER\nACTION: WAIT\nLIKE: no\nCOMMENT: \nREASON: no AI response';
}

const ocrText = process.argv[2];
if (!ocrText) { console.error('Usage: analyze.ts <ocr-text>'); process.exit(1); }

classify(ocrText).then(r => console.log(r)).catch(e => { console.error(`ERROR: ${e?.message || e}`); process.exit(1); });
