// PREPDO — presales-research-start.js
// BUILD 1 | 2026-09-11
// New file. Entry point for the now-async 12-topic research step —
// creates the 'pending' reports row (report_type: 'presales_research')
// that presales-research-background.js updates as it works, and that
// check-report-status.js already knows how to poll generically, same
// as every other async feature in the app. Fires the background
// function and returns immediately — does not wait for it.

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

  const { session_token, company_name, company_website, linkedin_paste, prospect_name, position, prospect_id } = payload;

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }
    if (!company_name) {
      return respond(400, { ok: false, message: 'Company name is required.' });
    }

    const created = await supaPost('reports', {
      owner_id: member.id,
      organization_id: member.organization_id || null,
      prospect_id: prospect_id || null,
      report_type: 'presales_research',
      status: 'pending'
    });
    const report = created[0];

    // Fire the background function and don't wait on it — Netlify
    // treats any function ending in -background specially (runs up to
    // 15 min, caller isn't held open). Deliberately not awaiting the
    // fetch's full resolution beyond confirming it was accepted.
    const siteUrl = process.env.URL || 'https://prepdo.netlify.app';
    fetch(`${siteUrl}/.netlify/functions/presales-research-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        report_id: report.id,
        company_name,
        company_website,
        linkedin_paste,
        prospect_name,
        position,
        session_token
      })
    }).catch(() => {
      // A failed fire-and-forget trigger shouldn't crash this
      // response — the report row stays 'pending' and the frontend's
      // poll will eventually show it as stalled, which is a more
      // honest failure state than throwing here.
    });

    return respond(200, { ok: true, report_id: report.id });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
