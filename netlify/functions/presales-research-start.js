// PREPDO — presales-research-start.js
// BUILD 2 | 2026-09-24
// Real bug found via direct testing: a research run on a real prospect
// sat at 'pending' forever, structured_data null, no error anywhere —
// the background function had never actually been triggered. Root
// cause, found by direct comparison against the proven, working
// meeting-analysis-start.js: this file fired the trigger fetch()
// without awaiting it, then immediately returned — in a serverless
// function, execution can end the moment the handler returns,
// abandoning an un-awaited fetch before the outbound request even
// leaves. meeting-analysis-start.js's own header already documents
// this exact lesson being learned once before ("Includes the Build 15
// fix... checks the trigger response status, not just for a thrown
// exception") — this file was built from general assumptions instead
// of matching that already-proven pattern, and reintroduced the same
// bug. Rebuilt to match it exactly: awaits the trigger, checks
// response.ok, and marks the report 'failed' with a real, specific
// reason if the trigger itself didn't succeed — so a future failure
// here is visible, not silent.
//
// BUILD 1 | 2026-09-11
// New file. Entry point for the now-async 12-topic research step —
// creates the 'pending' reports row (report_type: 'presales_research')
// that presales-research-background.js updates as it works, and that
// check-report-status.js already knows how to poll generically, same
// as every other async feature in the app. Fires the background
// function and returns immediately — does not wait for it.

const { getMemberFromSession, supaPost, supaPatch, respond, handleOptions } = require('./_lib.js');

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

    // Fire the background function and WAIT for confirmation it
    // actually started — a real, previously-learned lesson in this
    // codebase (see meeting-analysis-start.js Build 21's own header:
    // "Includes the Build 15 fix... checks the trigger response
    // status, not just for a thrown exception"). An un-awaited,
    // fire-and-forget fetch() risks being abandoned when this
    // function's own execution ends, before the outbound request even
    // leaves — which is exactly what happened here: the trigger never
    // reached presales-research-background.js at all, and the report
    // row sat at 'pending' forever with no error anywhere to explain
    // why. Rebuilt to match the proven, working pattern exactly.
    const siteUrl = process.env.URL || '';
    try {
      const triggerRes = await fetch(`${siteUrl}/.netlify/functions/presales-research-background`, {
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
      });

      if (!triggerRes.ok) {
        const detail = await triggerRes.text().catch(() => '');
        await supaPatch(`reports?id=eq.${report.id}`, {
          status: 'failed',
          error_message: `Could not start research: background function returned ${triggerRes.status}. ${detail}`.trim()
        });
        return respond(200, { ok: true, report_id: report.id });
      }
    } catch (triggerErr) {
      await supaPatch(`reports?id=eq.${report.id}`, {
        status: 'failed',
        error_message: 'Could not start research: ' + triggerErr.message
      });
      return respond(200, { ok: true, report_id: report.id });
    }

    return respond(200, { ok: true, report_id: report.id });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
