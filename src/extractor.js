'use strict';

const FIELDS = ['name', 'phone', 'address', 'issue', 'when_started', 'urgency', 'notes', 'complete'];

/**
 * Produce a clean, final call data object from accumulated per-turn data.
 * Falls back to scanning conversation history for embedded DATA blocks
 * in case the accumulator missed anything (e.g. server restart mid-call).
 */
function extractCallData(history, accumulatedData) {
  const data = { ...accumulatedData };

  // Scan assistant messages for the most recent ---DATA--- block as fallback
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== 'assistant') continue;

    const parsed = tryParseDataBlock(msg.content);
    if (!parsed) continue;

    for (const field of FIELDS) {
      if ((data[field] === null || data[field] === undefined) && parsed[field] != null) {
        data[field] = parsed[field];
      }
    }
    break;
  }

  return {
    name: data.name || null,
    phone: data.phone || null,
    address: data.address || null,
    issue: data.issue || null,
    when_started: data.when_started || null,
    urgency: data.urgency || null,
    notes: data.notes || null,
    complete: Boolean(data.complete),
  };
}

function tryParseDataBlock(text) {
  const SEP = '---DATA---';
  const idx = text.indexOf(SEP);
  if (idx === -1) return null;

  try {
    return JSON.parse(text.slice(idx + SEP.length).trim());
  } catch {
    return null;
  }
}

module.exports = { extractCallData };
