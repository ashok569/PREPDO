// PREPDO — presales-generate-start.js
// BUILD 11 | 2026-08-09
// New file this build: the fast, synchronous half of the new async
// report-generation flow. Creates a 'pending' report row immediately
// (a single fast DB insert, nowhere near the 30s ceiling), kicks off
// presales-generate-background.js to do the actual AI work with no
// time pressure (Background Functions run up to 15 minutes on
// Netlify's Personal plan and above), and returns the report_id right
// away so the frontend can start polling for completion.
//
// This replaces relying on one synchronous call to finish everything
// within 30 seconds — which was failing intermittently in production
// (confirmed via Netlify logs: repeated 504s clustered right at the
// ~30s ceiling). Splitting into start + background + poll removes the
// ceiling entirely rather than trying to out-run it.

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

  const { session_token, prospect_id, prospect, confirmed_facts } = payload;

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }
    if (!prospect_id || !confirmed_facts || !prospect) {
      return respond(400, { ok: false, message: 'prospect_id, prospect, and confirmed_facts are all required.' });
    }

    // Create the placeholder row first — fast, no AI call involved yet.
    const [report] = await supaPost('reports', {
      prospect_id,
      owner_id: member.id,
      report_type: 'presales_prep',
      confirmed_facts,
      status: 'pending'
    });

    // Kick off the background worker. Netlify recognizes the
    // "-background" filename suffix and returns a fast 202 here
    // regardless of how long the actual work takes, so this await
    // itself stays fast — but we DO need to await it: a serverless
    // environment can freeze/terminate immediately after this function
    // returns, which could cut off a true fire-and-forget request
    // before it's actually sent. Awaiting the fast 202 avoids that.
    const bgUrl = `${process.env.URL || ''}/.netlify/functions/presales-generate-background`;
    try {
      await fetch(bgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_id: report.id,
          prospect,
          confirmed_facts,
          session_token
        })
      });
    } catch (triggerErr) {
      // If kicking off the background function fails outright (rare —
      // a network-level issue calling our own site), mark the row
      // failed now rather than leaving it 'pending' forever with no
      // explanation for the frontend's polling to find.
      await supaPatch(`reports?id=eq.${report.id}`, {
        status: 'failed',
        error_message: 'Could not start report generation: ' + triggerErr.message
      });
      return respond(200, { ok: true, report_id: report.id }); // still return the id so polling can see the failed status cleanly
    }

    return respond(200, { ok: true, report_id: report.id });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
