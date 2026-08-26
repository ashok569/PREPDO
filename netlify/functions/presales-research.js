// PREPDO — presales-research.js
// BUILD 7 | 2026-08-22
// Two real bugs fixed from actual testing with two comma-separated
// group-company websites:
// 1. Second website was never actually scanned — each topic only had
//    max_uses: 1 (a single search), so with two sites blended into one
//    string, the AI had no real way to check both. Now explicitly
//    parses company_website into a list, lists each site individually
//    in the prompt, and scales max_uses to the site count so there's
//    genuinely enough search budget to check each one.
// 2. When the specific company/website couldn't be verified, the AI
//    substituted a different, similarly-named company's information
//    and presented it as if it were about the requested one — a real,
//    serious hallucination risk, not a hypothetical one. There was
//    zero explicit instruction against this anywhere. Added a hard,
//    explicit guardrail: verify identity before reporting anything,
//    and if it can't be verified, say so plainly rather than guess.
//
// BUILD 6 | 2026-08-09
// Confirmed working: the Build 5 parallel-mini-session redesign fixed
// the timeout entirely — real research returned successfully on a real
// company (iENERGIZER), 4 topics, well under Netlify's 30s ceiling.
// This build: small fix — max_tokens bumped 400 → 700. Two topics were
// getting cut off mid-sentence because 400 tokens was occasionally too
// tight, not because of speed (this doesn't meaningfully affect timing,
// since generation of a few hundred extra tokens on Haiku is fast, and
// the topics still run in parallel).

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

// BUILD 7: explicit parsing — previously company_website was pasted
// as one raw string into the prompt and left entirely to the AI to
// interpret, which real testing showed doesn't reliably cover a
// second comma-separated site.
function parseWebsites(company_website) {
  if (!company_website) return [];
  return company_website.split(',').map((w) => w.trim()).filter((w) => w.length > 0);
}

async function researchTopic(topic, company_name, websites) {
  try {
    const websiteBlock = websites.length > 0
      ? websites.map((w, i) => `Website ${i + 1}: ${w}`).join('\n')
      : 'Website: (not provided)';

    // BUILD 7: max_uses scales with how many distinct sites were
    // given, so there's genuinely enough search budget to check each
    // one individually rather than one search trying to cover all of
    // them at once. Capped at 3 — beyond that, diminishing value for
    // the added latency risk within Netlify's ceiling.
    const searchBudget = Math.min(Math.max(websites.length, 1), 3);

    const claudeRes = await callClaude({
      model: 'claude-haiku-4-5-20251001', // fast — one focused search each, not deep reasoning
      system: `You are doing one small, focused piece of research on a company, as part of a larger presales prep. Your job: use web search to find information specifically about ${topic.focus}.

${websites.length > 1 ? `IMPORTANT — multiple websites were given for this company (likely a group of related/sister companies). Search using EACH website listed below individually — do not rely on a single search to cover all of them. Combine what you find across all sites into one answer.\n\n` : ''}CRITICAL — verify identity before reporting anything: only report information you can confirm is actually about THIS SPECIFIC company (matching the name and/or website given below), not a different company that merely has a similar or related-sounding name. If a search doesn't turn up a confident match for the specific company/website given, say plainly "Could not verify information about the specific company/website given" — do NOT substitute or present information about a different company as if it were about this one, even if it seems like a plausible or likely match. A wrong company match is worse than no information at all, and has caused a real, confirmed error before.

Return 2-4 short bulleted markdown facts, only about this specific topic. If search turns up nothing relevant to this specific topic (for a confirmed match on the right company), say plainly "Nothing specific found on this topic" — do not pad with generic statements or drift into other topics. Keep it brief — this is one piece of a larger picture, not the whole report.`,
      messages: [{
        role: 'user',
        content: `Company: ${company_name}\n${websiteBlock}\n\nFind information specifically about: ${topic.focus}`
      }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: searchBudget }],
      max_tokens: 700
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

  const { session_token, company_name, company_website, linkedin_paste } = payload;

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }
    if (!company_name) {
      return respond(400, { ok: false, message: 'Company name is required.' });
    }

    const websites = parseWebsites(company_website);

    // Fire all mini-sessions in parallel — total time is bounded by the
    // slowest one, not the sum. allSettled (not all) so one bad topic
    // doesn't take down the whole research step.
    const results = await Promise.allSettled(
      TOPICS.map((topic) => researchTopic(topic, company_name, websites))
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

    // Manually-pasted LinkedIn content (the AI can't browse LinkedIn
    // itself) — included directly, no AI call needed, since it's
    // already-provided text rather than something to research.
    if (linkedin_paste && linkedin_paste.trim()) {
      confirmed_facts += `\n\n### Contact's LinkedIn Profile (pasted by the salesperson)\n${linkedin_paste.trim()}`;
    }

    if (failed.length > 0) {
      confirmed_facts += `\n\n*(Note: research on ${failed.map((f) => f.label).join(', ')} didn't complete — worth checking manually.)*`;
    }

    return respond(200, { ok: true, confirmed_facts });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
