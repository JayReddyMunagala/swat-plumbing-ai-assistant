'use strict';

require('dotenv').config();

const express = require('express');
const twilio = require('twilio');
const { generateResponse } = require('./claude');
const { saveCallRecord } = require('./sheets');
const { extractCallData } = require('./extractor');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Validate Twilio signatures in production to block spoofed requests
if (process.env.VALIDATE_TWILIO_SIGNATURE === 'true') {
  app.use('/voice', twilio.webhook(process.env.TWILIO_AUTH_TOKEN));
}

// callSid -> { history, extractedData, startTime, callerNumber }
const activeCalls = new Map();

const VOICE = 'Polly.Joanna';
const FALLBACK_PHONE = process.env.FALLBACK_PHONE || '8174386142';
const TERMINAL_STATUSES = new Set(['completed', 'busy', 'failed', 'no-answer', 'canceled']);

const GREETING =
  "Thank you for calling S.W.A.T. Plumbing LLC! I'm your AI assistant. I'll help get your service request set up. May I start with your name?";

const CLOSING =
  "We've received your information and our team will be in touch with you shortly. Thank you for choosing S.W.A.T. Plumbing. Have a great day!";

function makeGather(twiml, text) {
  const gather = twiml.gather({
    input: 'speech',
    speechTimeout: 'auto',
    timeout: 10,
    action: '/voice/gather',
    method: 'POST',
    language: 'en-US',
    profanityFilter: false,
  });
  if (text) gather.say({ voice: VOICE }, text);
  return gather;
}

// ── POST /voice/incoming ─────────────────────────────────────────────────────
// Twilio calls this when a new call arrives. Greets the caller and starts listening.
app.post('/voice/incoming', (req, res) => {
  const { CallSid, From } = req.body;

  if (!activeCalls.has(CallSid)) {
    activeCalls.set(CallSid, {
      history: [],
      extractedData: {},
      startTime: new Date().toISOString(),
      callerNumber: From || 'Unknown',
    });
  }

  const twiml = new twilio.twiml.VoiceResponse();
  makeGather(twiml, GREETING);

  // Fallback if the caller never speaks
  twiml.say({ voice: VOICE }, "I didn't hear anything. Please call back or stay on the line.");
  twiml.hangup();

  res.type('text/xml').send(twiml.toString());
});

// ── POST /voice/gather ───────────────────────────────────────────────────────
// Twilio posts here after each speech input. Calls Claude and responds.
app.post('/voice/gather', async (req, res) => {
  const { CallSid, SpeechResult, From } = req.body;
  const twiml = new twilio.twiml.VoiceResponse();

  if (!SpeechResult || !SpeechResult.trim()) {
    makeGather(twiml, "I'm sorry, I didn't catch that. Could you please repeat?");
    return res.type('text/xml').send(twiml.toString());
  }

  // Recover state if /voice/incoming was missed (e.g. direct endpoint test)
  if (!activeCalls.has(CallSid)) {
    activeCalls.set(CallSid, {
      history: [],
      extractedData: {},
      startTime: new Date().toISOString(),
      callerNumber: From || 'Unknown',
    });
  }

  const callState = activeCalls.get(CallSid);

  try {
    const { responseText, updatedData } = await generateResponse(
      SpeechResult.trim(),
      callState.history,
      callState.extractedData
    );

    // Store only the spoken text in history so Claude sees a clean transcript
    callState.history.push(
      { role: 'user', content: SpeechResult.trim() },
      { role: 'assistant', content: responseText }
    );
    // Merge new fields into accumulated data (never overwrite with nulls)
    for (const [k, v] of Object.entries(updatedData)) {
      if (v !== null && v !== undefined) {
        callState.extractedData[k] = v;
      }
    }

    // Save partial data to Sheets after every turn so nothing is lost
    saveCallRecord({
      ...extractCallData(callState.history, callState.extractedData),
      callSid: CallSid,
      callerNumber: callState.callerNumber,
      callStatus: 'in-progress',
      callDuration: '',
      startTime: callState.startTime,
      endTime: '',
    }).catch((err) => console.error(`[${CallSid}] Mid-call Sheets save failed:`, err.message));

    if (updatedData.complete === true) {
      twiml.say({ voice: VOICE }, responseText);
      twiml.pause({ length: 1 });
      twiml.say({ voice: VOICE }, CLOSING);
      twiml.hangup();
    } else {
      makeGather(twiml, responseText);
    }
  } catch (err) {
    console.error(`[${CallSid}] Claude error:`, err.message);
    twiml.say(
      { voice: VOICE },
      "I apologize, I'm experiencing a technical issue. Please hold while I connect you to our team."
    );
    twiml.dial(FALLBACK_PHONE);
  }

  res.type('text/xml').send(twiml.toString());
});

// ── POST /voice/status ───────────────────────────────────────────────────────
// Twilio posts here when call status changes. On terminal status, saves to Sheets.
app.post('/voice/status', async (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body;

  if (!TERMINAL_STATUSES.has(CallStatus)) {
    return res.sendStatus(200);
  }

  const callState = activeCalls.get(CallSid);
  if (!callState) {
    return res.sendStatus(200);
  }

  try {
    const finalData = extractCallData(callState.history, callState.extractedData);
    await saveCallRecord({
      ...finalData,
      callSid: CallSid,
      callerNumber: callState.callerNumber,
      callStatus: CallStatus,
      callDuration: CallDuration || '0',
      startTime: callState.startTime,
      endTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[${CallSid}] Failed to save to Google Sheets:`, err.message);
  }

  activeCalls.delete(CallSid);
  res.sendStatus(200);
});

// ── GET /test-claude — temporary diagnostic endpoint ─────────────────────────
app.get('/test-claude', async (_req, res) => {
  try {
    const { generateResponse } = require('./claude');
    const result = await generateResponse('My name is John', [], {});
    res.json({ ok: true, responseText: result.responseText });
  } catch (err) {
    res.json({ ok: false, error: err.message, status: err.status, type: err.constructor.name });
  }
});

// ── GET /test-sheets — temporary diagnostic endpoint ──────────────────────────
app.get('/test-sheets', async (_req, res) => {
  try {
    await saveCallRecord({
      callSid: 'RAILWAY-TEST', callerNumber: '+10000000000',
      name: 'Railway Test', phone: null, address: null, issue: null,
      when_started: null, urgency: null, notes: null,
      callStatus: 'test', callDuration: '', startTime: new Date().toISOString(), endTime: '',
    });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── GET /health ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    activeCalls: activeCalls.size,
    timestamp: new Date().toISOString(),
    env: {
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      TWILIO_ACCOUNT_SID: !!process.env.TWILIO_ACCOUNT_SID,
      GOOGLE_SHEETS_ID: !!process.env.GOOGLE_SHEETS_ID,
      GOOGLE_SERVICE_ACCOUNT_JSON: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    },
  });
});

// Clean up calls older than 2 hours that never sent a status webhook
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [sid, state] of activeCalls) {
    if (new Date(state.startTime).getTime() < cutoff) {
      console.log(`[server] Purging stale call state: ${sid}`);
      activeCalls.delete(sid);
    }
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`S.W.A.T. Plumbing AI Assistant running on port ${PORT}`);
});
