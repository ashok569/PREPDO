// PREPDO — delete-report.js
// BUILD 23 | 2026-08-11
// New file. Deletes a single report (Presales Prep or Meeting Analysis)
// from Report History. The "don't delete the latest" rule is enforced
// on the FRONTEND (the delete control simply isn't shown for the most
// recent report of each type) — but this function also re-checks it
// server-side, since a delete action should never trust the client
// alone for something irreversible.

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
    const report = rows[0];

    if (member.key_type !== 'admin' && report.owner_id !== member.id) {
      return respond(403, { ok: false, message: 'Not authorized to delete this report.' });
    }

    // Re-check server-side: is this the most recent report of its type
    // for this prospect? If so, refuse — same rule the frontend already
    // enforces by not showing a delete control for it, but a delete
    // action shouldn't rely on the client alone for something
    // irreversible.
    const siblingReports = await supaGet(
      `reports?prospect_id=eq.${report.prospect_id}&report_type=eq.${report.report_type}&select=id,created_at&order=created_at.desc&limit=1`
    );
    if (siblingReports.length && siblingReports[0].id === report.id) {
      return respond(400, { ok: false, message: 'This is the most recent report of its type — it can\'t be deleted. Generate a newer one first, or delete an older report instead.' });
    }

    await supaDelete(`reports?id=eq.${report_id}`);
    return respond(200, { ok: true });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
