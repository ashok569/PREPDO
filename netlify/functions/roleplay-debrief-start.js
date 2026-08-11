// PREPDO — roleplay-debrief-start.js
// BUILD 27 | 2026-08-11
// New file. Fast trigger for the debrief — mirrors the established
// start/background/poll pattern (presales-generate-start.js,
// meeting-analysis-start.js). Marks the report 'pending', kicks off
// roleplay-debrief-background.js, returns immediately so the frontend
// can poll check-report-status.js (reused as-is — it's already generic
// across report types).

const { getMemberFromSession, supaGet, supaPatch, respond, handleOptions } = require('./_lib.js');

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
      return respond(404, { ok: false, message: 'Roleplay session not found.' });
    }
    const report = rows[0];
    if (member.key_type !== 'admin' && report.owner_id !== member.id) {
      return respond(403, { ok: false, message: 'Not authorized.' });
    }
    if (!report.conversation || report.conversation.length === 0) {
      return respond(400, { ok: false, message: 'Nothing to debrief yet — have at least one exchange first.' });
    }

    await supaPatch(`reports?id=eq.${report_id}`, { status: 'pending' });

    const bgUrl = `${process.env.URL || ''}/.netlify/functions/roleplay-debrief-background`;
    try {
      const triggerRes = await fetch(bgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_id, session_token })
      });
      if (!triggerRes.ok) {
        const detail = await triggerRes.text().catch(() => '');
        await supaPatch(`reports?id=eq.${report_id}`, {
          status: 'failed',
          error_message: `Could not start debrief: background function returned ${triggerRes.status}. ${detail}`.trim()
        });
        return respond(200, { ok: true, report_id });
      }
    } catch (triggerErr) {
      await supaPatch(`reports?id=eq.${report_id}`, {
        status: 'failed',
        error_message: 'Could not start debrief: ' + triggerErr.message
      });
      return respond(200, { ok: true, report_id });
    }

    return respond(200, { ok: true, report_id });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
