// PREPDO — check-report-status.js
// BUILD 11 | 2026-08-09
// New file this build: the frontend polls this every few seconds after
// calling presales-generate-start, until the report's status flips from
// 'pending' to 'complete' (or 'failed'). Fast, simple, single-row read.

const { getMemberFromSession, supaGet, respond, handleOptions } = require('./_lib.js');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') {
    return respond(405, { ok: false, message: 'Method Not Allowed' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return respond(400, { ok: false, message: 'Invalid request.' });
  }

  const { session_token, report_id } = payload;

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }
    if (!report_id) {
      return respond(400, { ok: false, message: 'report_id required.' });
    }

    const rows = await supaGet(`reports?id=eq.${report_id}&select=*`);
    if (!rows.length) {
      return respond(404, { ok: false, message: 'Report not found.' });
    }

    return respond(200, { ok: true, report: rows[0] });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
