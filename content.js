async function sendToBackground(data) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type: 'DM_EXTRACTED', data }, (response) => {
        if (chrome.runtime.lastError) {
          setTimeout(() => sendToBackground(data).then(resolve).catch(reject), 1000);
        } else {
          resolve(response);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

function extractHook(fullText) {
  const sentences = fullText.match(/[^.!?\n]+[.!?\n]*/g);
  if (!sentences) return fullText.slice(0, 100);
  return sentences.slice(0, 2).join(' ').trim();
}

function extractDMData() {
  // Confirmed via live DOM check: the open thread's contact name renders as
  // an <h2> (e.g. "Nethneil Narayan"), alongside other unrelated <h2>s like
  // "0 notifications total" and "Conversation List". We grab all h2s and
  // exclude the known generic labels, leaving the contact's name.
  const GENERIC_H2_LABELS = ['conversation list', 'notifications total', 'messaging'];
  const h2s = [...document.querySelectorAll('h2')]
    .map(el => el.innerText.trim())
    .filter(text => text && !GENERIC_H2_LABELS.some(label => text.toLowerCase().includes(label)));

  const name = h2s.length ? h2s[h2s.length - 1] : 'Unknown'; // contact name is reliably the last non-generic h2
  if (name === 'Unknown') return null;

  const bodyEls = document.querySelectorAll('.msg-s-event-listitem__body');
  if (!bodyEls.length) return null;

  // Stable per-conversation id, pulled from LinkedIn's own data-event-urn
  // (e.g. urn:li:msg_message:(urn:li:fsd_profile:XXXX,...)). This is far more
  // reliable for dedup than display name, since two different contacts can
  // share a first/last name and would otherwise overwrite each other's logs.
  let conversationId = null;
  const firstUrnEl = document.querySelector('[data-event-urn]');
  if (firstUrnEl) {
    const urn = firstUrnEl.getAttribute('data-event-urn') || '';
    const match = urn.match(/urn:li:(?:fsd_profile|member):([^,)]+)/);
    conversationId = match ? match[1] : urn; // fall back to full urn if pattern doesn't match
  }

  const threadMessages = [];
  bodyEls.forEach(bodyEl => {
    const text = bodyEl.innerText.trim();
    if (!text) return;
    const listitem = bodyEl.closest('.msg-s-event-listitem');
    const isTheirs = listitem && listitem.classList.contains('msg-s-event-listitem--other');
    threadMessages.push({ sender: isTheirs ? name : 'you', text });
  });

  if (!threadMessages.length) return null;

  const hook = extractHook(threadMessages.find(m => m.sender === 'you')?.text || '');
  const theirMessages = threadMessages.filter(m => m.sender !== 'you');
  const replyText = theirMessages.length
    ? theirMessages.map(m => m.text).join(' / ')
    : 'No reply yet';
  const fullText = threadMessages.map(m => m.text).join(' ').toLowerCase();

  const meetFlagged = ['hop on a call', 'quick call', 'zoom call', 'google meet', 'schedule a', 'book a call', "let's connect", 'calendly', 'coffee chat'].some(k => fullText.includes(k));
  const actionPending = ['discord', 'notion', 'doc', 'loom', 'check this', 'take a look', "here's", 'follow up', 'following up'].some(k => fullText.includes(k));

  return {
    name,
    conversationId,
    hook,
    replyText,
    meetFlagged,
    actionPending,
    threadMessages,
    messageCount: threadMessages.length,
    timestamp: new Date().toISOString(),
    replyReceived: replyText !== 'No reply yet'
  };
}

// --- run/track state ---
let lastSentKey = null; // name + messageCount, so we only send when something actually changed
let extractTimer = null;

function runExtraction() {
  if (!location.href.includes('/messaging/')) return;

  const data = extractDMData();
  if (!data) {
    console.warn('DM Logger: no data found');
    return;
  }

  const key = data.name + ':' + data.messageCount;
  if (key === lastSentKey) return; // nothing new since last send, skip

  lastSentKey = key;
  console.log('DM Logger: extracted', data);
  sendToBackground(data).catch(e => console.warn('DM Logger: send failed', e));
}

function scheduleExtraction(delay = 1200) {
  clearTimeout(extractTimer);
  extractTimer = setTimeout(runExtraction, delay);
}

// Fires on: URL changes (switching threads) AND new messages arriving in the
// currently open thread (which often does NOT change the URL at all).
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    lastSentKey = null; // reset dedup guard, new thread context
    scheduleExtraction(2000); // give the new thread time to render
  } else if (location.href.includes('/messaging/')) {
    scheduleExtraction(1200); // likely a new message arrived in-place
  }
}).observe(document.body, { childList: true, subtree: true });

// Initial run in case the extension loads directly into an open conversation.
scheduleExtraction(2000);