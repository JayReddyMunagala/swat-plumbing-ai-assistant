# S.W.A.T. Plumbing AI Call Assistant

An AI-powered phone answering system for S.W.A.T. Plumbing LLC. When a customer calls, the assistant greets them, collects their service request details (name, address, issue, urgency, etc.) via natural conversation, and saves a structured record to Google Sheets automatically when the call ends.

**Stack:** Node.js · Express · Twilio Voice · Claude API (Anthropic) · Google Sheets API

---

## Prerequisites

- Node.js 18 or higher (`node --version`)
- A [Twilio account](https://www.twilio.com) with a voice-capable phone number
- An [Anthropic API key](https://console.anthropic.com)
- A Google Cloud project with a service account (free tier is fine)
- [ngrok](https://ngrok.com) for local testing

---

## 1 — Clone and Install

```bash
git clone https://github.com/YOUR_USERNAME/swat-plumbing-ai-assistant.git
cd swat-plumbing-ai-assistant
npm install
cp .env.example .env
```

Open `.env` and fill in all variables (see sections below for each service).

---

## 2 — Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key
2. Paste the key as `ANTHROPIC_API_KEY` in `.env`

---

## 3 — Twilio Setup

### Get your credentials

1. Log in to [twilio.com/console](https://www.twilio.com/console)
2. Copy **Account SID** and **Auth Token** into `.env`
3. Set `TWILIO_PHONE_NUMBER` to your Twilio number in E.164 format (e.g. `+18665319438`)

### Configure webhook URLs

You need to point your Twilio phone number to your server. Do this **after** you have a public URL (ngrok for local, or your Railway/Render URL for production).

1. In Twilio Console → **Phone Numbers** → **Manage** → click your number
2. Under **Voice Configuration**:
   - **A call comes in** → Webhook → `https://YOUR_URL/voice/incoming` (POST)
   - **Call Status Changes** → `https://YOUR_URL/voice/status` (POST)
3. Click **Save**

---

## 4 — Google Sheets Setup

### Create the spreadsheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet
2. Name the first tab **Call Records** (or set `GOOGLE_SHEET_TAB` in `.env` to match)
3. Copy the sheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit
   ```
   Paste it as `GOOGLE_SHEETS_ID` in `.env`

### Create a service account

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → select or create a project
2. Navigate to **APIs & Services** → **Library** → search for **Google Sheets API** → Enable it
3. Go to **IAM & Admin** → **Service Accounts** → **Create Service Account**
   - Name: `swat-plumbing-sheets` (or anything)
   - Click **Create and Continue** → skip roles → **Done**
4. Click the new service account → **Keys** tab → **Add Key** → **Create new key** → **JSON**
5. A `.json` file downloads — keep it safe, never commit it

### Share the sheet with the service account

1. Open the JSON file, find the `"client_email"` value (looks like `something@project.iam.gserviceaccount.com`)
2. In your Google Sheet, click **Share** → paste that email → set role to **Editor** → Share

### Add credentials to .env

Convert the JSON key to a single-line string and paste it as `GOOGLE_SERVICE_ACCOUNT_JSON`:

```bash
cat your-key.json | jq -c .
```

Copy the output (it's one long line) and set it in `.env`:
```
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}
```

---

## 5 — Local Testing with ngrok

### Start the server

```bash
npm run dev
```

The server starts on port 3000 (or `PORT` from `.env`).

### Expose it with ngrok

In a separate terminal:

```bash
ngrok http 3000
```

ngrok prints a public URL like `https://abc123.ngrok.io`. Use this as `YOUR_URL` when configuring Twilio webhooks (Step 3 above).

### Make a test call

Call your Twilio number. The AI assistant will answer, collect your info, and — when you hang up — save a row to Google Sheets.

### Test the endpoints directly

```bash
# Health check
curl http://localhost:3000/health

# Simulate an incoming call
curl -X POST http://localhost:3000/voice/incoming \
  -d "CallSid=TEST123&From=+15551234567&To=+18665319438"

# Simulate a speech response
curl -X POST http://localhost:3000/voice/gather \
  -d "CallSid=TEST123&SpeechResult=My+name+is+John+Smith&From=+15551234567"
```

---

## 6 — Deploy to Railway

Railway offers a free tier that works well for this project.

1. Push your code to GitHub (see Step 8 below)
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. Select your `swat-plumbing-ai-assistant` repo
4. Go to your service → **Variables** tab → add every variable from `.env.example`
   - For `GOOGLE_SERVICE_ACCOUNT_JSON`, paste the one-line JSON string
   - Set `NODE_ENV=production`
   - Set `VALIDATE_TWILIO_SIGNATURE=true`
5. Railway auto-deploys on every push to `main`
6. Click **Settings** → copy the public domain (e.g. `your-app.up.railway.app`)
7. Update your Twilio webhook URLs to use this domain

**Alternative: Render**

Works identically — connect your GitHub repo, set env vars, deploy. Use `node src/server.js` as the start command.

---

## 7 — Accessing Call Records in Google Sheets

Every call that completes, fails, or ends with no answer is logged automatically. The sheet contains these columns:

| Column | Description |
|---|---|
| Timestamp | When the record was saved (ISO 8601) |
| Call SID | Twilio's unique call identifier |
| Caller Number | The number that called in |
| Name | Caller's name |
| Callback Phone | Phone number to call back |
| Service Address | Where the work needs to be done |
| Issue Description | What the plumbing problem is |
| When Started | When the issue started |
| Urgency | low / medium / high / emergency |
| Notes | Any extra details |
| Call Status | completed / busy / failed / no-answer |
| Duration (sec) | Call length in seconds |
| Call Start | When the call began |
| Call End | When the call ended |

Headers are written automatically on the first call. You can add conditional formatting to highlight `emergency` urgency rows in red.

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `CLAUDE_MODEL` | No | Claude model ID (default: `claude-sonnet-4-6`) |
| `TWILIO_ACCOUNT_SID` | Yes | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Yes | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Yes | Your Twilio number in E.164 format |
| `VALIDATE_TWILIO_SIGNATURE` | No | Set `true` in production to verify Twilio signatures |
| `FALLBACK_PHONE` | No | Number to dial if Claude fails (default: `8174386142`) |
| `GOOGLE_SHEETS_ID` | Yes | Google Sheet ID from its URL |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Yes | Service account JSON key as a single-line string |
| `GOOGLE_SHEET_TAB` | No | Sheet tab name (default: `Call Records`) |
| `PORT` | No | Server port (default: `3000`) |

---

## Architecture

```
Caller
  │
  ▼ rings Twilio number
Twilio
  │ POST /voice/incoming
  ▼
Express server ──► greets caller with <Gather input="speech">
  │
  │ caller speaks
  │ POST /voice/gather
  ▼
Claude API ──► reads conversation history + current data
            ──► returns: spoken response + updated JSON data fields
  │
  ▼
Twilio TTS plays response to caller
  │ (loop continues until complete=true or hangup)
  │
  │ call ends
  │ POST /voice/status
  ▼
Google Sheets ──► appends one row with all collected fields
```

---

## 8 — Push to GitHub

```bash
cd swat-plumbing-ai-assistant

# Create a new repo on GitHub (requires GitHub CLI)
gh repo create swat-plumbing-ai-assistant --public --source=. --push

# Or manually:
# 1. Create the repo at github.com/new
# 2. Then run:
git remote add origin https://github.com/YOUR_USERNAME/swat-plumbing-ai-assistant.git
git branch -M main
git push -u origin main
```

> **Never commit your `.env` file.** It's in `.gitignore` by default.
