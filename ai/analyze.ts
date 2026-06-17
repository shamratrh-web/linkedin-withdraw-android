import { DeepSeekAPI } from '/data/data/com.termux/files/home/resume-forge-ai/lib/ai/DeepSeek.ts';

const DEEPSEEK_TOKEN = process.env.DEEPSEEK_TOKEN || '';
if (!DEEPSEEK_TOKEN) {
  console.error('ERROR: DEEPSEEK_TOKEN environment variable required');
  process.exit(1);
}

const api = new DeepSeekAPI(DEEPSEEK_TOKEN);

async function classify(ocrText: string): Promise<string> {
  await api.init();
  const sessionId = await api.createSession();

  const prompt = `You are a LinkedIn UI automation assistant. Your job is to analyze the OCR text extracted from a screenshot of the LinkedIn Android app and determine what screen is shown and what action to take next.

The GOAL is to withdraw sent LinkedIn invitations.

OCR text from screenshot:
"""
${ocrText.slice(0, 2000)}
"""

Analyze and respond in EXACTLY this format (no other text):
SCREEN: <screen_type>
ACTION: <action>
REASON: <short_reason>

Screen types:
- SENT_LIST — "Invitations sent" heading visible, Withdraw buttons on cards
- RECEIVED_LIST — "Invitations received" heading visible, Accept/Ignore buttons
- MANAGE — "Manage" heading, "Sent" and "Received" tab buttons visible
- CONFIRM — withdraw confirmation dialog ("Are you sure", "Withdraw this invitation", Cancel)
- FEED — LinkedIn home feed ("Start a post", news articles)
- PROFILE — user profile ("Message", "Activity", "About")
- EMPTY — "No pending invitations" or similar empty state
- UNKNOWN — cannot determine from provided text

Actions:
- TAP_SENT — tap the Sent tab
- TAP_WITHDRAW — tap a Withdraw button on a sent invitation card
- TAP_CONFIRM — tap the confirm button in the dialog (COORDS: 780 2250)
- SCROLL_DOWN — scroll down to see more content
- SCROLL_UP — scroll up slightly
- GO_BACK — press Android back button
- TAP_MY_NETWORK — tap My Network icon to navigate
- TAP_MANAGE — tap Manage button
- WAIT — wait and retry
- DONE — no more invitations to withdraw, exit successfully
- ESCALATE — unexpected state, exit with error

If you see "Withdraw" text in a dialog context (near "Cancel" or "Are you sure"), classify as CONFIRM.`;

  const response = await api.chatCompletion(sessionId, prompt).next();
  return response.value?.content || '';
}

const ocrText = process.argv[2] || '';
if (!ocrText) {
  console.error('ERROR: Usage: analyze.ts <ocr-text>');
  console.error('       Provide OCR text from screenshot as single argument');
  process.exit(1);
}

classify(ocrText)
  .then((result) => console.log(result))
  .catch((err: any) => {
    console.error(`ERROR: ${err?.message || String(err)}`);
    process.exit(1);
  });
