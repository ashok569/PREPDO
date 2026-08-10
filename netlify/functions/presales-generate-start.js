// PREPDO — presales-generate-start.js
// BUILD 15 | 2026-08-10
// Real bug fix: the trigger call to presales-generate-background only
// checked for a thrown network-level exception, never the actual HTTP
// response status. fetch() does NOT throw on a 404/500 — it just
// returns that response normally. So if the background function ever
// fails to trigger (confirmed cause once already: a missing .js
// extension on its filename after a re-upload), this function would
// silently treat that as success, leaving the report stuck at
// 'pending' forever — no error, no explanation, just endless polling.
// Confirmed via real logs: 3+ minutes of check-report-status calls,
// zero presales-generate-background entries anywhere. Now checks
// triggerRes.ok explicitly and marks the report 'failed' with the
// actual status code if the trigger didn't succeed.

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
      const triggerRes = await fetch(bgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_id: report.id,
          prospect,
          confirmed_facts,
          session_token
        })
      });

      // BUILD 15 FIX: fetch() only throws on network-level failures
      // (DNS, connection refused) — it does NOT throw on an HTTP error
      // status like 404 or 500. Without this check, a background
      // function that fails to trigger (e.g. a missing .js extension on
      // its filename — this exact thing has happened before) would look
      // like a success here, leaving the report stuck at 'pending'
      // forever with no error, no explanation, and endless silent
      // polling. Confirmed via real logs: dozens of check-report-status
      // calls, no presales-generate-background entry anywhere — the
      // trigger genuinely never started real work.
      if (!triggerRes.ok) {
        const detail = await triggerRes.text().catch(() => '');
        await supaPatch(`reports?id=eq.${report.id}`, {
          status: 'failed',
          error_message: `Could not start report generation: background function returned ${triggerRes.status}. ${detail}`.trim()
        });
        return respond(200, { ok: true, report_id: report.id });
      }
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
