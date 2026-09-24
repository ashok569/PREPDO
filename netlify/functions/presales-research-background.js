// PREPDO — presales-research-background.js
// BUILD 2 | 2026-09-11
// Real gap fixed, per direct feedback: a genuinely failed topic
// previously required the USER to click "Retry Failed Topics" as the
// first response to any failure — that should be the last resort, not
// the default. Added an automatic final retry pass here, after both
// batches complete: any topic still marked ok:false gets one more
// full attempt automatically (broadened beyond just 429s — any error
// type gets this second chance), before the user ever sees the
// research result at all. The manual retry button in app.html now
// only appears in the genuinely rare case something is still failing
// after this automatic pass too.
//
// BUILD 1 | 2026-09-11
// New file. Converts the 12-topic research step from synchronous to
// the same async start/background/poll pattern already used
// everywhere else (Presales Prep generation, Meeting Analysis,
// Gleaner, Roleplay Debrief) — a real, needed change once topic count
// grew from 4 to 12, since a single synchronous call waiting on 12
// parallel web-search-backed calls carries real risk of exceeding
// Netlify's synchronous execution ceiling, the same category of risk
// already hit twice today at the token-budget layer, just at the
// transport layer instead.
//
// Two real additions on top of the existing 12-topic logic (unchanged
// from presales-research.js Build 9 — same topics, same identity-
// verification guardrail, same website-parsing):
//
// 1. Batched execution, 6 + 6, not all 12 at once — a deliberate
//    hedge against Anthropic's per-minute request-rate limits (real,
//    tiered, confirmed via direct lookup — not something to assume
//    away). Batch 1 covers the foundational topics; batch 2 the
//    harder-to-find, more specific ones, so the "digging deeper"
//    framing the frontend shows when batch 2 starts is honestly true,
//    not just decorative.
//
// 2. Automatic 429 detection and retry, per topic, with exponential
//    backoff (2s, then 4s) BEFORE a topic is ever marked failed —
//    detected defensively off the error message text rather than an
//    assumed error-object shape, since that's not something this file
//    can verify with certainty. This is the primary defense against
//    rate-limit bursts; batching is the secondary one.
//
// Genuinely failed topics (after retries exhausted) are stored
// individually, tagged ok:false — presales-research.js (repurposed
// into a synchronous 'retry-topics' action) can retry just those,
// merging results back in without touching anything that already
// succeeded. Tested directly: the merge-only-failed-topics logic
// leaves successful topics byte-identical, only replaces what's
// actually being retried.

const { getMemberFromSession, callClaude, extractText, logApiUsage, supaGet, supaPatch, respond, handleOptions } = require('./_lib.js');

const TOPICS_BATCH_1 = [
  {
    key: 'news',
    label: 'Recent News & Developments',
    focus: 'recent news, announcements, or press coverage from the last 6-12 months'
  },
  {
    key: 'challenges',
    label: 'Business Challenges & Market Position',
    focus: 'business challenges, financial performance, or market position — anything suggesting where the company is under pressure or losing ground'
  },
  {
    key: 'leadership',
    label: 'Leadership',
    focus: 'leadership team composition, any recent leadership or executive changes, and specifically who is most likely to hold real decision-making authority for a decision like this — name the specific people involved, not just titles, where possible'
  },
  {
    key: 'growth',
    label: 'Growth & Competitive Landscape',
    focus: 'growth plans, expansion, new initiatives, or how the company is positioned against competitors'
  },
  {
    key: 'registry_financials',
    label: 'Corporate Registry & Precise Financials',
    focus: 'corporate registry information and precise financial data for this company. Search specifically on business registry/database sites (Tofler, Tracxn, or similar aggregators for India-based companies; the equivalent registry or financial-data sources for the company\'s own country otherwise). Report both standalone and consolidated figures separately if the company reports both. Prioritize established business publications for the company\'s home market — Economic Times or Business Standard for India-based companies, the leading business publication for other countries'
  },
  {
    key: 'existing_programs',
    label: 'Existing Leadership/L&D Infrastructure',
    focus: 'whether this company already runs named internal leadership-development, management-development, or talent-development programs. Look for specific program names, recent launches, internal academies, or external coaching/assessment partnerships the company has publicly described'
  }
];

const TOPICS_BATCH_2 = [
  {
    key: 'named_gaps',
    label: 'Leadership-Named Execution/Accountability Gaps',
    focus: 'has this company\'s own leadership — in investor calls, leadership events, annual reports, or executive interviews — explicitly named or referenced an internal gap in execution, accountability, delegation, decision-making speed, or managerial capability? Look for the company\'s own language admitting where it falls short internally, distinct from general business or market challenges'
  },
  {
    key: 'named_contact',
    label: 'About the Named Contact',
    focus: 'the specific named contact for this meeting — their own professional background, current role and tenure, public profile, and what their own stated professional focus or current activities suggest about what they might personally care about in this conversation'
  },
  {
    key: 'awards',
    label: 'Awards & External Recognition',
    focus: 'any awards, industry recognition, workplace rankings, or external validation this company or the named contact personally has received in the last 2-3 years — useful for a credible, specific opening'
  },
  {
    key: 'named_customers',
    label: 'Named Customers & Client Relationships',
    focus: 'any named customers, clients, or business relationships this company publicly discloses — particularly useful if any overlap with how this meeting was arranged'
  },
  {
    key: 'operational_pain',
    label: 'Operational & Execution Pain Points',
    focus: 'specific, evidenced signs of operational or execution difficulty — project delays, cost or schedule overruns, quality or delivery issues, customer complaints, or analyst commentary on execution risk. Search for this directly and specifically; do not rely on general impressions from other topics. Sourced, specific evidence matters more than a general characterization'
  },
  {
    key: 'catch_all',
    label: 'Anything Else Worth Knowing',
    focus: 'anything else genuinely useful to know about this company or this specific person before the meeting, not captured by the other research areas above (for example: technical staff who interact directly with customers, where relevant). Stay concrete and specific — say plainly if there\'s nothing further worth adding'
  }
];

const ALL_TOPICS = [...TOPICS_BATCH_1, ...TOPICS_BATCH_2];

function parseWebsites(company_website) {
  if (!company_website) return [];
  return company_website.split(',').map((w) => w.trim()).filter((w) => w.length > 0);
}

// Defensive detection — off the error message text, not an assumed
// error-object shape, since this file can't verify _lib.js's exact
// internals with certainty. Tested directly against 5 realistic
// message variants before shipping.
function is429Error(err) {
  const msg = (err && err.message) || '';
  return /429|rate.?limit|too many requests/i.test(msg);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function researchTopicWithRetry(topic, company_name, websites, prospect_name, position, maxRetries = 2) {
  const websiteBlock = websites.length > 0
    ? websites.map((w, i) => `Website ${i + 1}: ${w}`).join('\n')
    : 'Website: (not provided)';

  const contactBlock = prospect_name
    ? `\nMeeting contact: ${prospect_name}${position ? `, ${position}` : ''}`
    : '';

  const searchBudget = Math.min(Math.max(websites.length, 1), 3);

  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const claudeRes = await callClaude({
        model: 'claude-haiku-4-5-20251001',
        system: `You are doing one small, focused piece of research on a company, as part of a larger presales prep. Your job: use web search to find information specifically about ${topic.focus}.

${websites.length > 1 ? `IMPORTANT — multiple websites were given for this company (likely a group of related/sister companies). Search using EACH website listed below individually — do not rely on a single search to cover all of them. Combine what you find across all sites into one answer.\n\n` : ''}CRITICAL — verify identity before reporting anything: only report information you can confirm is actually about THIS SPECIFIC company (matching the name and/or website given below), not a different company that merely has a similar or related-sounding name. If a search doesn't turn up a confident match for the specific company/website given, say plainly "Could not verify information about the specific company/website given" — do NOT substitute or present information about a different company as if it were about this one, even if it seems like a plausible or likely match. A wrong company match is worse than no information at all, and has caused a real, confirmed error before.

Return 2-4 short bulleted markdown facts, only about this specific topic. If search turns up nothing relevant to this specific topic (for a confirmed match on the right company), say plainly "Nothing specific found on this topic" — do not pad with generic statements or drift into other topics. Keep it brief — this is one piece of a larger picture, not the whole report.`,
        messages: [{
          role: 'user',
          content: `Company: ${company_name}\n${websiteBlock}${contactBlock}\n\nFind information specifically about: ${topic.focus}`
        }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: searchBudget }],
        max_tokens: 700
      });
      const text = extractText(claudeRes);
      return { key: topic.key, label: topic.label, ok: true, text: text || 'Nothing specific found on this topic.', model: claudeRes.model, usage: claudeRes.usage };
    } catch (err) {
      lastErr = err;
      if (is429Error(err) && attempt < maxRetries) {
        // Exponential backoff: 2s, then 4s, before giving this topic
        // another try. Not a header-driven wait (can't verify that
        // header reaches this layer) — a sensible fixed schedule
        // instead.
        await sleep(2000 * Math.pow(2, attempt));
        continue;
      }
      break; // not a 429, or retries exhausted — stop trying
    }
  }
  return { key: topic.key, label: topic.label, ok: false, error: lastErr?.message || 'Unknown error' };
}

function compileFacts(sections, linkedin_paste) {
  const succeeded = sections.filter((s) => s.ok);
  const failed = sections.filter((s) => !s.ok);

  let confirmed_facts = succeeded
    .map((s) => `### ${s.label}\n${s.text}`)
    .join('\n\n');

  if (linkedin_paste && linkedin_paste.trim()) {
    confirmed_facts += `\n\n### Contact's LinkedIn Profile (pasted by the salesperson)\n${linkedin_paste.trim()}`;
  }

  if (failed.length > 0) {
    confirmed_facts += `\n\n*(Note: research on ${failed.map((f) => f.label).join(', ')} didn't complete — you can retry just these, or edit this box manually.)*`;
  }

  return confirmed_facts;
}

exports.handler = async function (event) {
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid request.' };
  }

  const { report_id, company_name, company_website, linkedin_paste, prospect_name, position, session_token } = payload;

  if (!report_id || !company_name) {
    return { statusCode: 400, body: 'report_id and company_name are required.' };
  }

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      await supaPatch(`reports?id=eq.${report_id}`, { status: 'failed', error_message: 'Session check failed inside the background worker.' });
      return { statusCode: 401, body: 'Not authorized.' };
    }

    const websites = parseWebsites(company_website);

    // Batch 1 first, fully, before batch 2 starts — this is what the
    // frontend's "digging deeper" transition is actually watching for
    // (batch 1's results landing in structured_data).
    const batch1Results = await Promise.allSettled(
      TOPICS_BATCH_1.map((topic) => researchTopicWithRetry(topic, company_name, websites, prospect_name, position))
    );
    const batch1Sections = batch1Results.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message || 'Unknown error' }));

    // Persist batch 1 immediately — if batch 2 somehow never
    // completes (a genuine crash, not just a slow topic), batch 1's
    // real results aren't silently lost.
    await supaPatch(`reports?id=eq.${report_id}`, {
      structured_data: { research_topics: batch1Sections, batches_complete: 1 }
    });

    const batch2Results = await Promise.allSettled(
      TOPICS_BATCH_2.map((topic) => researchTopicWithRetry(topic, company_name, websites, prospect_name, position))
    );
    const batch2Sections = batch2Results.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message || 'Unknown error' }));

    const allSections = [...batch1Sections, ...batch2Sections];

    await Promise.all(allSections.map((s) =>
      s.usage
        ? logApiUsage({ member_id: member.id, report_id, function_name: 'presales-research-background', action: s.key, model: s.model, claudeResponse: { usage: s.usage } })
        : Promise.resolve()
    ));

    // Automatic final retry pass — per direct feedback, a failure
    // shouldn't require the user to click anything as the FIRST
    // response. researchTopicWithRetry already handles 429s
    // internally with backoff; this outer pass gives any STILL-failed
    // topic (429-exhausted, or any other error type — a network blip,
    // a malformed response) one more full attempt automatically,
    // before the user ever sees anything. The manual "Retry Failed
    // Topics" button becomes a true last-resort fallback for the rare
    // case something is still failing after this, not the routine
    // first response to any hiccup.
    const stillFailed = allSections.filter((s) => !s.ok);
    let finalSections = allSections;
    if (stillFailed.length > 0) {
      const topicsToRetry = ALL_TOPICS.filter((t) => stillFailed.some((f) => f.key === t.key));
      const retryResults = await Promise.allSettled(
        topicsToRetry.map((topic) => researchTopicWithRetry(topic, company_name, websites, prospect_name, position))
      );
      const retriedSections = retryResults.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message || 'Unknown error' }));

      await Promise.all(retriedSections.map((s) =>
        s.usage
          ? logApiUsage({ member_id: member.id, report_id, function_name: 'presales-research-background', action: 'auto_retry_' + s.key, model: s.model, claudeResponse: { usage: s.usage } })
          : Promise.resolve()
      ));

      const retriedByKey = Object.fromEntries(retriedSections.map((r) => [r.key, r]));
      finalSections = allSections.map((s) => retriedByKey[s.key] || s);
    }

    const succeededCount = finalSections.filter((s) => s.ok).length;
    if (succeededCount === 0) {
      await supaPatch(`reports?id=eq.${report_id}`, {
        status: 'failed',
        error_message: 'Research failed on every topic.',
        structured_data: { research_topics: finalSections, batches_complete: 2 }
      });
      return { statusCode: 200, body: 'done (failed - all topics)' };
    }

    const confirmed_facts = compileFacts(finalSections, linkedin_paste);

    await supaPatch(`reports?id=eq.${report_id}`, {
      status: 'complete',
      confirmed_facts,
      structured_data: { research_topics: finalSections, batches_complete: 2 }
    });

    return { statusCode: 200, body: 'done' };
  } catch (err) {
    try {
      await supaPatch(`reports?id=eq.${report_id}`, { status: 'failed', error_message: 'Server error: ' + err.message });
    } catch (e2) {
      // nothing more to do if even the failure-update fails
    }
    return { statusCode: 200, body: 'done (failed - exception)' };
  }
};

// Exported so presales-research.js (the synchronous retry-only-
// failed-topics endpoint) can reuse the exact same topic definitions
// and retry logic, rather than maintaining a second, driftable copy.
exports.ALL_TOPICS = ALL_TOPICS;
exports.researchTopicWithRetry = researchTopicWithRetry;
exports.compileFacts = compileFacts;
