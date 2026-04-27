'use strict';

const { google } = require('googleapis');

const SHEET_TAB = process.env.GOOGLE_SHEET_TAB || 'Call Records';

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

async function ensureHeaders(sheets, spreadsheetId) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_TAB}!A1:N1`,
    });

    const existingRow = res.data.values?.[0];
    if (!existingRow || existingRow.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_TAB}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [HEADERS] },
      });
    }
  } catch (err) {
    // Tab may not exist yet — log and continue; append will create it
    console.warn('[sheets] Header check skipped:', err.message);
  }
}

/**
 * Append one call record row to the Google Sheet.
 * @param {Object} data - Call record fields
 */
async function saveCallRecord(data) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_ID env var is missing');

  const auth = buildAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  await ensureHeaders(sheets, spreadsheetId);

  const row = [
    new Date().toISOString(),
    data.callSid || '',
    data.callerNumber || '',
    data.name || '',
    data.phone || '',
    data.address || '',
    data.issue || '',
    data.when_started || '',
    data.urgency || '',
    data.notes || '',
    data.callStatus || '',
    data.callDuration || '0',
    data.startTime || '',
    data.endTime || '',
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_TAB}!A:N`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  console.log(`[sheets] Saved record for call ${data.callSid}`);
}

module.exports = { saveCallRecord };
