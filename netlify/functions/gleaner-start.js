// PREPDO — gleaner-start.js
// BUILD 2 | 2026-09-06
// Updated the admin check from 'admin' to 'platform_admin' — genuinely
// platform-wide, correctly staying exclusive to that one tier.
//
// BUILD 1 | 2026-09-06
// New file. Mirrors the established start/background/poll pattern
// (presales-generate-start.js, meeting-analysis-start.js, roleplay-
// debrief-start.js) — creates the gleaner_reports row as 'pending',
// kicks off gleaner-generate-background.js, returns immediately so the
// frontend can poll gleaner.js's 'get' action.
//
// Admin-only — the Gleaner reads across every user's reports (not just
// the triggering admin's own), so this is a platform-level tool, same
// access tier as the Industry Library editor and Full Data Backup, not
// something an ordinary member can trigger.

const { getMemberFromSession, supaPost, respond, handleOptions } = require('./_lib.js');

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

  const { session_token } = payload;

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }
    if (member.key_type !== 'platform_admin') {
      return respond(403, { ok: false, message: 'The Gleaner is an admin-only tool.' });
    }

    const created = await supaPost('gleaner_reports', {
      triggered_by: member.id,
      status: 'pending'
    });
    const gleanerReport = created[0];

    const bgUrl = `${process.env.URL || ''}/.netlify/functions/gleaner-generate-background`;
    try {
      const triggerRes = await fetch(bgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gleaner_report_id: gleanerReport.id, session_token })
      });
      if (!triggerRes.ok) {
        const detail = await triggerRes.text().catch(() => '');
        return respond(200, { ok: true, gleaner_report_id: gleanerReport.id, warning: `Background function returned ${triggerRes.status}. ${detail}`.trim() });
      }
    } catch (triggerErr) {
      return respond(200, { ok: true, gleaner_report_id: gleanerReport.id, warning: 'Could not start: ' + triggerErr.message });
    }

    return respond(200, { ok: true, gleaner_report_id: gleanerReport.id });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
