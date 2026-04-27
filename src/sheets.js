'use strict';

const { google } = require('googleapis');

const RAW_TAB = process.env.GOOGLE_SHEET_TAB || 'Call Records';
const SHEET_TAB = RAW_TAB.includes(' ') ? `'${RAW_TAB}'` : RAW_TAB;

const HEADERS = [
  'Timestamp',
  'Call SID',
  'Caller Number',
  'Name',
  'Callback Phone',
  'Service Address',
  'Issue Description',
  'When Started',
  'Urgency',
  'Notes',
  'Call Status',
  'Duration (sec)',
  'Call Start',
  'Call End',
  'Last Updated',
];

function buildAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is missing');
  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function buildRow(data, status = 'in-progress') {
  return [
    data.startTime || new Date().toISOString(),
    data.callSid || '',
    data.callerNumber || '',
    data.name || '',
    data.phone || '',
    data.address || '',
    data.issue || '',
    data.when_started || '',
    data.urgency || '',
    data.notes || '',
    data.callStatus || status,
    data.callDuration || '',
    data.startTime || '',
    data.endTime || '',
    new Date().toISOString(),
  ];
}

async function ensureHeaders(sheets, spreadsheetId) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_TAB}!A1:O1`,
    });
    const existing = res.data.values?.[0];
    if (!existing || existing.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_TAB}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [HEADERS] },
      });
    }
  } catch (err) {
    console.warn('[sheets] Header check skipped:', err.message);
  }
}

// Find the row number (1-based) for a given callSid, or null if not found
async function findRowBySid(sheets, spreadsheetId, callSid) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_TAB}!B:B`,
    });
    const rows = res.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === callSid) return i + 1; // 1-based row number
    }
  } catch {}
  return null;
}

/**
 * Upsert a call record: inserts on first call, updates in place on subsequent calls.
 * Call this after every conversation turn and on call end.
 */
async function saveCallRecord(data) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_ID env var is missing');

  const auth = buildAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  await ensureHeaders(sheets, spreadsheetId);

  const existingRow = await findRowBySid(sheets, spreadsheetId, data.callSid);
  const row = buildRow(data);

  if (existingRow) {
    // Update existing row in place
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_TAB}!A${existingRow}:O${existingRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [row] },
    });
    console.log(`[sheets] Updated row ${existingRow} for call ${data.callSid}`);
  } else {
    // Insert new row
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_TAB}!A:O`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
    console.log(`[sheets] Inserted new row for call ${data.callSid}`);
  }
}

module.exports = { saveCallRecord };
