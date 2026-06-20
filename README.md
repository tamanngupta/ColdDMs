# Cold DMs

Chrome extension that tracks cold-DM conversations on LinkedIn into a single Google Sheet, with Groq-powered summaries (what the contact's building, their founder pain points, sentiment, next steps) updated live as the conversation continues.

## Setup

1. Clone this repo.
2. Copy `config.example.js` to `config.js`:
   ```
   cp config.example.js config.js
   ```
3. Open `config.js` and fill in:
   - `SHEET_ID` — the ID from your Google Sheet's URL (`https://docs.google.com/spreadsheets/d/THIS_PART/edit`)
   - `GROQ_API_KEY` — a free key from [console.groq.com/keys](https://console.groq.com/keys)
4. In Chrome, go to `chrome://extensions`, enable Developer mode, click "Load unpacked," and select this folder.
5. Open a LinkedIn conversation. Click the extension icon to open the side panel.

`config.js` is gitignored — your real Sheet ID and API key never get committed.

## Google Sheets OAuth

This project uses an OAuth client ID (in `manifest.json`) to authorize writing to your Sheet. OAuth client IDs are safe to keep public — they identify the app, not authenticate it. If you want to use your own Google Cloud project instead of the bundled one, replace `oauth2.client_id` in `manifest.json` with your own, set up via [Google Cloud Console](https://console.cloud.google.com/apis/credentials).

## Files

- `manifest.json` — extension config
- `content.js` — scrapes the open LinkedIn conversation
- `background.js` — summarizes via Groq, writes to your Sheet
- `sidepanel.html` / `sidepanel.js` — the live tracking panel UI
- `config.example.js` — template for your secrets (copy to `config.js`)
