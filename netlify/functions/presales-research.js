// PREPDO — presales-research.js
// BUILD 5 | 2026-08-08
// Redesigned around parallel mini-sessions, one per research topic,
// instead of one call trying to cover everything with a shared,
// limited search budget. Benefits:
//   1. SPEED — mini-sessions run in parallel (Promise.allSettled), so
//      total time is bounded by the slowest single mini-session, not
//      the sum of all of them. Each is capped to 1 search, Haiku model,
//      small max_tokens — realistically ~5-12s each, run concurrently.
//      Comfortably under Netlify's 30s hard function-execution ceiling
//      (the actual cause of the earlier timeouts — see BUILD 4 notes).
//   2. QUALITY — each topic gets a dedicated, forced search rather than
//      competing for a shared budget the model has to allocate itself.
//      A single combined call might spend both its searches on "recent
//      news" and never touch leadership or competitive position; here
//      every topic is guaranteed at least one real look.
// If one topic's mini-session fails, the others still succeed — a
// partial result (with a note on what's missing) beats losing the
// whole research step over one bad sub-call.

// /netlify/functions/presales-research.js
//
// Presales Prep, Step 1 of 2: runs several small, focused, parallel
// web-search sessions on the target company (one per topic) and merges
// them into a single Confirmed Facts list for the user to review/edit
// before the full report is generated. Nothing is saved to the database
// at this step — that only happens once the user confirms and calls
// presales-generate.

const { getMemberFromSession, callClaude, extractText, respond, handleOptions } = require('./_lib.js');

// Each topic is its own mini-session: one focused search, one small,
// fast synthesis. Edit this list to change what gets researched —
// 3-5 topics is the sweet spot; more adds latency risk for diminishing
// returns, since Netlify's ceiling doesn't move even though each
// individual topic stays fast.
const TOPICS = [
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
    focus: 'leadership team composition and any recent leadership or executive changes'
  },
  {
    key: 'growth',
    label: 'Growth & Competitive Landscape',
    focus: 'growth plans, expansion, new initiatives, or how the company is positioned against competitors'
  }
];

async function researchTopic(topic, company_name, company_website) {
  try {
    const claudeRes = await callClaude({
      model: 'claude-haiku-4-5-20251001', // fast — one focused search each, not deep reasoning
      system: `You are doing one small, focused piece of research on a company, as part of a larger presales prep. Your ONLY job: use web search — exactly one search — to find information specifically about ${topic.focus}. Return 2-4 short bulleted markdown facts, only about this specific topic. If search turns up nothing relevant to this specific topic, say plainly "Nothing specific found on this topic" — do not pad with generic statements or drift into other topics. Keep it brief — this is one piece of a larger picture, not the whole report.`,
      messages: [{
        role: 'user',
        content: `Company: ${company_name}\nWebsite: ${company_website || '(not provided)'}\n\nFind information specifically about: ${topic.focus}`
      }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
      max_tokens: 400
    });
    const text = extractText(claudeRes);
    return { key: topic.key, label: topic.label, ok: true, text: text || 'Nothing specific found on this topic.' };
  } catch (err) {
    return { key: topic.key, label: topic.label, ok: false, error: err.message };
  }
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

  const { session_token, company_name, company_website } = payload;

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }
    if (!company_name) {
      return respond(400, { ok: false, message: 'Company name is required.' });
    }

    // Fire all mini-sessions in parallel — total time is bounded by the
    // slowest one, not the sum. allSettled (not all) so one bad topic
    // doesn't take down the whole research step.
    const results = await Promise.allSettled(
      TOPICS.map((topic) => researchTopic(topic, company_name, company_website))
    );

    const sections = results.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message || 'Unknown error' }));

    const succeeded = sections.filter((s) => s.ok);
    const failed = sections.filter((s) => !s.ok);

    if (succeeded.length === 0) {
      return respond(200, { ok: false, message: 'Research failed on every topic. Try again, or proceed by editing the facts box manually.' });
    }

    let confirmed_facts = succeeded
      .map((s) => `### ${s.label}\n${s.text}`)
      .join('\n\n');

    if (failed.length > 0) {
      confirmed_facts += `\n\n*(Note: research on ${failed.map((f) => f.label).join(', ')} didn't complete — worth checking manually.)*`;
    }

    return respond(200, { ok: true, confirmed_facts });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
