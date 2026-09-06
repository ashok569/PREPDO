// PREPDO — gleaner.js
// BUILD 1 | 2026-09-06
// New file. Action-routed endpoint for the Gleaner admin UI: 'list'
// (history of past runs, for the list view), 'get' (one full run,
// including output_markdown — used both for the status-poll while a
// run is still 'pending' and for viewing/downloading a completed one),
// 'delete' (remove an old run). Admin-only across all three actions,
// same tier as gleaner-start.js.

const { getMemberFromSession, supaGet, supaDelete, respond, handleOptions } = require('./_lib.js');

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

  const { session_token, action, gleaner_report_id } = payload;

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }
    if (member.key_type !== 'admin') {
      return respond(403, { ok: false, message: 'The Gleaner is an admin-only tool.' });
    }

    if (action === 'list') {
      const rows = await supaGet(
        `gleaner_reports?select=id,created_at,status,reports_scanned_count,error_message&order=created_at.desc&limit=50`
      );
      return respond(200, { ok: true, gleaner_reports: rows });
    }

    if (action === 'get') {
      if (!gleaner_report_id) {
        return respond(400, { ok: false, message: 'gleaner_report_id is required.' });
      }
      const rows = await supaGet(`gleaner_reports?id=eq.${gleaner_report_id}&select=*`);
      if (!rows.length) {
        return respond(404, { ok: false, message: 'Gleaner report not found.' });
      }
      return respond(200, { ok: true, gleaner_report: rows[0] });
    }

    if (action === 'delete') {
      if (!gleaner_report_id) {
        return respond(400, { ok: false, message: 'gleaner_report_id is required.' });
      }
      await supaDelete(`gleaner_reports?id=eq.${gleaner_report_id}`);
      return respond(200, { ok: true });
    }

    return respond(400, { ok: false, message: `Unknown action: ${action}` });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
