'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// Prompt cached — TTL 5 min, saves ~$0.003/call on cache hits
const SYSTEM_PROMPT = `You are a professional AI call assistant for S.W.A.T. Plumbing LLC, a family-owned plumbing company in Fort Worth and Aledo, TX. Phone: 817-438-6142. You offer 24/7 emergency service. Collect: caller name, callback number, service address, issue description, when it started, urgency level, and any extra notes. Be professional, warm, and efficient. For emergencies acknowledge urgency first. Services include leak detection, slab leaks, drain cleaning, hydro-jetting, sewer repair, water heaters, water filtration, gas lines, repiping. Financing available (12 months same as cash). 10% discount for military and public defenders. After collecting all info, summarize and confirm with the caller.

CRITICAL RESPONSE RULES:
1. Your spoken response must be under 150 words — it will be read aloud on a phone call.
2. Ask only ONE question per turn.
3. After your natural spoken response, add exactly "---DATA---" on its own line, then a JSON object tracking what has been collected. Update fields immediately when the caller mentions them.
4. Set "complete" to true only after you have confirmed all collected information with the caller and they have acknowledged it.
5. "urgency" must be one of: null, "low", "medium", "high", or "emergency".

Example format:

Thank you for calling! What is your name?

---DATA---
{"name": null, "phone": null, "address": null, "issue": null, "when_started": null, "urgency": null, "notes": null, "complete": false}`;

/**
 * Generate an AI response for the current turn of a phone call.
 * Returns { responseText, updatedData } where responseText is safe for TTS.
 */
async function generateResponse(userMessage, history, currentData) {
  const hasData = Object.values(currentData).some((v) => v !== null && v !== undefined);
  const contextNote = hasData
    ? `[Data collected so far: ${JSON.stringify(currentData)}]\n`
    : '';

  const messages = [
    ...history,
    { role: 'user', content: `${contextNote}${userMessage}` },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages,
  });

  const fullText = response.content[0].text;
  return parseClaudeResponse(fullText);
}

/**
 * Split Claude's response into the spoken part and the structured JSON data block.
 */
function parseClaudeResponse(fullText) {
  const SEP = '---DATA---';
  const idx = fullText.indexOf(SEP);

  if (idx === -1) {
    return { responseText: fullText.trim(), updatedData: {} };
  }

  const responseText = fullText.slice(0, idx).trim();
  const jsonStr = fullText.slice(idx + SEP.length).trim();

  let updatedData = {};
  try {
    updatedData = JSON.parse(jsonStr);
  } catch {
    console.warn('[claude] Failed to parse DATA JSON — using empty object');
  }

  return { responseText, updatedData };
}

module.exports = { generateResponse, parseClaudeResponse };
