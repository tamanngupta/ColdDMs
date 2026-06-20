// config.js holds your real Sheet ID and Groq key — it's gitignored and
// never committed. Copy config.example.js to config.js and fill it in.
importScripts('config.js');

const SHEET_ID = CONFIG.SHEET_ID;
const SHEET_NAME = CONFIG.SHEET_NAME;
const GROQ_API_KEY = CONFIG.GROQ_API_KEY;

chrome.runtime.onStartup.addListener(() => {
  console.log('DM Logger: background started');
});

function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(token);
      }
    });
  });
}

async function summarizeThread(threadMessages, contactName) {
  // threadMessages: array of {sender: "you"|<contactName>, text: string}
  // Using the actual contact name (not a hardcoded "Founder" label) avoids the
  // model assuming a role for the other person — and avoids any mislabeling
  // bleeding into the summary if sender detection ever misfires.
  const transcript = threadMessages
    .map(m => `${m.sender === "you" ? "You (the outreach sender)" : contactName}: ${m.text}`)
    .join("\n");

  const systemPrompt = `You are reading an entire LinkedIn cold-outreach DM conversation, start to finish, the way a sharp human would read it before a sales call — not skimming, actually understanding the back-and-forth.

"You (the outreach sender)" is the person doing cold outreach. "${contactName}" is the founder being messaged.

Read the full thread below and focus specifically on: where is ${contactName} struggling as a founder? Look for anything about what's hard for them right now — hiring, traction, fundraising, building product, finding the right users, time/bandwidth, technical debt, growth, retention, anything they describe as a problem, frustration, or open question about their own company. Don't invent a struggle if none is mentioned — say so plainly instead.

Return ONLY a JSON object with these exact keys, no other text, no markdown fences:
{
  "detailed_summary": "3-5 sentences. Cover: (1) what ${contactName} is building, (2) the specific struggle/pain point they raised as a founder, in their own framing where possible, (3) how the conversation has progressed and where it stands now. Write it like a sharp CRM note, not a recap of message order.",
  "building": "what ${contactName} is building/working on, in <10 words, or 'unclear'",
  "pain_point": "the specific founder struggle they describe, in <12 words, or 'none mentioned'",
  "sentiment": "one of: interested / neutral / skeptical / declined / no_reply",
  "next_step": "the concrete next action, in <8 words, or 'none'",
  "meet_flagged": true or false — true only if there is genuine intent to meet, call, or hop on a call, not just the word 'meeting' used casually,
  "action_pending": true or false — true if there is a concrete pending action like a link or doc shared, or a follow-up explicitly promised
}`;

  if (!GROQ_API_KEY || GROQ_API_KEY.startsWith("YOUR_")) {
    console.error('DM Logger: GROQ_API_KEY is not set — copy config.example.js to config.js and add your key');
    return null;
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: transcript }
        ],
        temperature: 0.2,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      // 401 = bad/rotated key, 429 = rate limit, 400 = bad model name/payload — log status so it's obvious which
      console.error('DM Logger: Groq API error', response.status, errText);
      return null;
    }

    const data = await response.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    console.log('DM Logger: Groq summary received', parsed);
    return parsed;
  } catch (e) {
    console.error('DM Logger: summarizeThread failed', e);
    return null;
  }
}

async function appendToSheet(data) {
  try {
    const token = await getAuthToken();
    const values = [[
      data.name,
      data.hook,
      data.detailedSummary || data.replyText, // detailed Groq summary; raw text only as fallback if Groq hasn't run yet
      data.replyReceived ? 'Yes' : 'No',
      data.meetFlagged ? 'Yes' : 'No',
      data.actionPending ? 'Yes' : 'No',
      data.timestamp,
      data.building || '',
      data.painPoint || '',
      data.sentiment || '',
      data.nextStep || ''
    ]];

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A:K:append?valueInputOption=RAW`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values })
      }
    );

    if (!response.ok) {
      const err = await response.json();
      console.error('Sheets API error:', err);
    } else {
      console.log('DM Logger: row appended for', data.name);
    }
  } catch (e) {
    console.error('DM Logger: sheet append failed', e);
  }
}

// Dedup key: prefer the stable LinkedIn conversationId (pulled from
// data-event-urn in content.js) since two different contacts can share a
// display name and would otherwise silently overwrite each other's logs.
// Falls back to name only if conversationId wasn't extracted.
function threadKey(data) {
  return data.conversationId || data.name;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  sendResponse({ ok: true });

  if (message.type === 'DM_EXTRACTED') {
    const data = message.data;

    chrome.storage.local.get('dmLogs', async (result) => {
      const logs = result.dmLogs || [];
      const key = threadKey(data);
      const existingIndex = logs.findIndex(l => threadKey(l) === key);
      const isNewThread = existingIndex === -1;
      const existing = isNewThread ? null : logs[existingIndex];

      const hasNewMessages = data.threadMessages && data.threadMessages.length > 0 &&
        (isNewThread || data.messageCount > (existing.messageCount || 0));

      if (hasNewMessages) {
        const summary = await summarizeThread(data.threadMessages, data.name);
        if (summary) {
          data.detailedSummary = summary.detailed_summary;
          data.building = summary.building;
          data.painPoint = summary.pain_point;
          data.sentiment = summary.sentiment;
          data.nextStep = summary.next_step;
          // either signal is enough to flag — local keywords catch obvious
          // cases instantly, Groq catches subtler phrasing
          data.meetFlagged = data.meetFlagged || !!summary.meet_flagged;
          data.actionPending = data.actionPending || !!summary.action_pending;
        } else if (existing) {
          // Groq call failed — keep whatever summary we already had
          data.detailedSummary = existing.detailedSummary;
          data.building = existing.building;
          data.painPoint = existing.painPoint;
          data.sentiment = existing.sentiment;
          data.nextStep = existing.nextStep;
        }
      } else if (existing) {
        // no new messages since last time — reuse the existing summary, skip the API call
        data.detailedSummary = existing.detailedSummary;
        data.building = existing.building;
        data.painPoint = existing.painPoint;
        data.sentiment = existing.sentiment;
        data.nextStep = existing.nextStep;
      }

      if (isNewThread) {
        logs.push(data);
        console.log('DM Logger: new thread logged for', data.name);
      } else {
        logs[existingIndex] = data;
        console.log('DM Logger: thread updated for', data.name);
      }

      // Write to the Sheet on first sighting AND on every later update with
      // new messages, so the row keeps reflecting the live conversation
      // instead of freezing at whatever it looked like on first contact.
      if (isNewThread || hasNewMessages) {
        appendToSheet(data);
      }

      chrome.storage.local.set({ dmLogs: logs });
    });
  }

  return true; // keep channel open for async
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});