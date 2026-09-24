// PREPDO — presales-research.js
// BUILD 10 | 2026-09-11
// Repurposed from the old synchronous 12-topic research function
// (Build 9) into a small, synchronous 'retry-topics' endpoint — the
// research step itself moved to presales-research-start.js +
// presales-research-background.js as part of the async conversion
// (12 parallel topics, up from the original 4, carries real risk of
// exceeding Netlify's synchronous execution ceiling).
//
// This file now does one thing: given a report_id, find whichever
// topics are currently marked ok:false in structured_data, re-run
// JUST those (reusing researchTopicWithRetry — the exact same 429-
// resilient logic the background function uses, imported rather than
// duplicated), merge the new results back in, and recompile
// confirmed_facts from the complete, merged set. Kept synchronous
// deliberately — retrying a small number of failed topics (rarely
// more than 2-3) is comparable in scale to the original 4-topic
// synchronous call that worked fine for months, so the async pattern
// isn't needed here.
//
// Tested directly before shipping: the merge-only-failed-topics logic
// leaves every successful topic byte-identical, replacing only the
// ones actually retried.

const { getMemberFromSession, supaGet, supaPatch, logApiUsage, respond, handleOptions, isInScope } = require('./_lib.js');
const { researchTopicWithRetry, compileFacts, ALL_TOPICS } = require('./presales-research-background.js');

function parseWebsites(company_website) {
  if (!company_website) return [];
  return company_website.split(',').map((w) => w.trim()).filter((w) => w.length > 0);
}

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

  const { session_token, report_id, company_name, company_website, linkedin_paste, prospect_name, position } = payload;

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }
    if (!report_id) {
      return respond(400, { ok: false, message: 'report_id is required.' });
    }

    const rows = await supaGet(`reports?id=eq.${report_id}&select=*`);
    if (!rows.length) {
      return respond(404, { ok: false, message: 'Research session not found.' });
    }
    const report = rows[0];
    if (!isInScope(member, report)) {
      return respond(403, { ok: false, message: 'Not authorized.' });
    }

    const existingTopics = report.structured_data?.research_topics || [];
    const failedTopics = existingTopics.filter((t) => !t.ok);

    if (failedTopics.length === 0) {
      return respond(200, { ok: true, message: 'Nothing to retry — every topic already succeeded.', confirmed_facts: report.confirmed_facts });
    }

    const websites = parseWebsites(company_website);
    const topicsToRetry = ALL_TOPICS.filter((t) => failedTopics.some((f) => f.key === t.key));

    const retriedResults = await Promise.allSettled(
      topicsToRetry.map((topic) => researchTopicWithRetry(topic, company_name, websites, prospect_name, position))
    );
    const retriedSections = retriedResults.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message || 'Unknown error' }));

    await Promise.all(retriedSections.map((s) =>
      s.usage
        ? logApiUsage({ member_id: member.id, report_id, function_name: 'presales-research', action: 'retry_' + s.key, model: s.model, claudeResponse: { usage: s.usage } })
        : Promise.resolve()
    ));

    // Merge — replace only the retried entries, leaving every
    // successful topic completely untouched. Tested directly before
    // shipping.
    const retriedByKey = Object.fromEntries(retriedSections.map((r) => [r.key, r]));
    const mergedTopics = existingTopics.map((t) => retriedByKey[t.key] || t);

    const confirmed_facts = compileFacts(mergedTopics, linkedin_paste);

    await supaPatch(`reports?id=eq.${report_id}`, {
      confirmed_facts,
      structured_data: { ...report.structured_data, research_topics: mergedTopics }
    });

    return respond(200, { ok: true, confirmed_facts, still_failed: mergedTopics.filter((t) => !t.ok).map((t) => t.label) });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
