// PREPDO — presales-research-start.js
// BUILD 4 | 2026-09-28
// Credits: the 12-topic research pass costs PRICES.research credits, charged
// here at the start (research is a real cost — 12 web-search calls). The balance
// must cover a WHOLE Presales Prep cycle (research + report) before research
// starts, so nobody can spend on research and then be unable to generate the
// report. The charge is linked to the research row in credit_ledger and refunded
// if the research never starts. Retrying failed topics (presales-research.js) and
// the automatic retry pass inside the background function are FREE.
// Roleplay-only, expired, deactivated accounts are refused; the prospect must be
// one the caller may access.
//
// BUILD 3 | 2026-09-24 (run-based; never released)
// BUILD 2 | 2026-09-24
// Real bug: the background trigger fetch() was fired without being awaited, so
// the run sat at 'pending' forever with no error. Now awaits the trigger,
// checks response.ok, and marks the report 'failed' with a real reason.
// (Mirrors meeting-analysis-start.js's Build 15 lesson.)
//
// BUILD 1 | 2026-09-11
// New file. Entry point for the async 12-topic research step — creates the
// 'pending' reports row (report_type: 'presales_research') that
// presales-research-background.js updates as it works.

const { getMemberFromSession, supaGet, supaPost, supaPatch, respond, handleOptions, isInScope } = require('./_lib.js');
const { checkAccess, charge, refund, linkLedger, PRICES, FULL_CYCLE } = require('./_access.js');

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

  let member = null;
  let charged = false;
  let reportCreated = false;

  try {
    member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }
    if (!company_name) {
      return respond(400, { ok: false, message: 'Company name is required.' });
    }

    const denied = checkAccess(member, { requireFull: true, needCredits: FULL_CYCLE });
    if (denied) return respond(denied.status, denied.body);

    if (prospect_id) {
      const prospectRows = await supaGet(`prospects?id=eq.${prospect_id}&select=*`);
      if (!prospectRows.length) {
        return respond(404, { ok: false, message: 'Prospect not found.' });
      }
      if (!isInScope(member, prospectRows[0])) {
        return respond(403, { ok: false, message: 'Not authorized.' });
      }
    }

    const paid = await charge(member, 'research');
    if (!paid.ok) return respond(403, { ok: false, code: paid.code, message: paid.message });
    charged = true;

    const created = await supaPost('reports', {
      owner_id: member.id,
      organization_id: member.organization_id || null,
      prospect_id: prospect_id || null,
      report_type: 'presales_research',
      status: 'pending'
    });
    const report = created[0];
    reportCreated = true;
    await linkLedger(paid.ledgerId, report.id);

    // Fire the background function and WAIT for confirmation it actually
    // started (see Build 2 note above).
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
        await refund(member, PRICES.research, { reportId: report.id, note: 'research did not start' });
        return respond(200, { ok: true, report_id: report.id });
      }
    } catch (triggerErr) {
      await supaPatch(`reports?id=eq.${report.id}`, {
        status: 'failed',
        error_message: 'Could not start research: ' + triggerErr.message
      });
      await refund(member, PRICES.research, { reportId: report.id, note: 'research did not start' });
      return respond(200, { ok: true, report_id: report.id });
    }

    return respond(200, { ok: true, report_id: report.id });
  } catch (err) {
    if (charged && !reportCreated && member) await refund(member, PRICES.research, { note: 'research row not created' });
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
