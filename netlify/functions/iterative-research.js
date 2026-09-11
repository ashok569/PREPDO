// PREPDO — iterative-research.js
// BUILD 2 | 2026-09-11
// Replaced the single 'open-ask' action with 'add-aspect' (capped at
// 2 per session, enforced server-side not just in the UI) and
// 'finish' — per explicit request, so a user can loop back and add a
// second aspect rather than the flow ending after one. Each new
// aspect is checked for redundancy FIRST, via a separate, cheap,
// no-search call — a genuine duplicate then costs almost nothing, and
// the real research call only fires when something's actually new.
// Real, honest risk worth flagging: the redundancy check is itself an
// AI judgment call, and a wrong "already covered" would silently
// discourage a genuinely useful follow-up with no visible failure —
// worth watching closely in real use, same as every other AI-judged
// piece in this app. Tested the dedup-parsing regex against 4
// realistic response variants (including lowercase and a trailing
// explanation on the same line) before shipping.
//
// BUILD 1 | 2026-09-11
// New file. The guided, multi-round presales research avenue —
// designed and refined over several prior sessions, built here as the
// deliberately FIXED-SHAPE first version: 4 standardized questions →
// one offered pathway pair (pick one, both, or neither) → one
// open-ask → done, always. No AI-judged "offer a further round if
// this seems important enough" branching in this version — that's a
// genuinely higher-risk piece (a judgment call about whether to keep
// going, not just answering a fixed question) deliberately deferred
// until this foundation is proven with real use, consistent with this
// project's own repeated experience that this kind of branching needs
// real testing to get right, not just reasoning through it.
//
// Both question sets are deliberately plain language — no PBM/RRR/EDM
// terminology — since this runs WITHOUT lmi-context.md loaded (see
// buildLmiQuestions below). Those concepts re-enter naturally once the
// final compiled output feeds into the actual Presales Prep
// generation downstream, which does have that context loaded.
//
// Architecture: a normal, synchronous, multi-action function (like
// prospects.js/settings.js/gleaner.js), not the async start/background/
// poll pattern — each individual step here is genuinely lightweight
// (Haiku, web search, no large context file), the same shape as
// presales-research.js's existing topic calls, comfortably within
// Netlify's normal execution window. Real cost estimate for a full
// session (worst case, every optional step taken): roughly 2 cents —
// meaningfully cheaper than a single Presales Prep report, precisely
// because it avoids loading the large methodology file that dominates
// cost everywhere else in the app.
//
// Four actions, one per stage:
//   'start'            — fires the 4 initial questions in parallel,
//                         creates the session row.
//   'get-pathways'      — a synthesis call (not research): given the 4
//                         initial findings, proposes exactly 2 deeper
//                         research directions. Bounded — always
//                         exactly 2, offered once.
//   'research-pathway'  — fires research for whichever pathway(s) the
//                         user selected (one, both, or neither).
//   'add-aspect'        — up to 2 per session, each checked for
//                         redundancy first.
//   'finish'            — compiles everything into final_compiled_facts.
//                         The output shape matches presales-research.js's
//                         own confirmed_facts format, so it can feed
//                         directly into the existing Presales Prep
//                         generation flow without a new integration
//                         point there.

const { getMemberFromSession, supaGet, supaPost, supaPatch, callClaude, extractText, logApiUsage, respond, handleOptions, isInScope } = require('./_lib.js');

// The 4 standardized questions — LMI set, deliberately plain language.
function buildLmiQuestions(companyName) {
  return [
    { key: 'imperatives', label: 'Imperatives', question: `What are ${companyName}'s stated business priorities, growth strategy, and organisational challenges over the next 2-3 years?` },
    { key: 'fit', label: 'Fit', question: `Based on those imperatives, what would we need to understand about ${companyName}'s leadership approach to identify a specific, quantifiable business problem we could credibly help solve — rather than a generic leadership-training pitch?` },
    { key: 'pain_points', label: 'Pain Points', question: `What leadership or management-capability gaps is ${companyName} likely facing that could be tied to a real, measurable cost or missed opportunity — not just a vague problem statement?` },
    { key: 'buying_system', label: 'Buying System', question: `Based on ${companyName}'s size and structure, who is most likely to hold real budget authority for a decision like this, and who else would need to be involved before it could move forward?` }
  ];
}

// SPIN / Non-LMI set — generic by design, with the specific industry
// named explicitly in Q2/Q3 rather than left implicit.
function buildSpinQuestions(companyName, industryName) {
  const industry = industryName || 'their industry';
  return [
    { key: 'imperatives', label: 'Imperatives', question: `What are ${companyName}'s stated business priorities, growth strategy, and organisational challenges over the next 2-3 years?` },
    { key: 'fit', label: 'Fit', question: `Based on those imperatives, what would we need to understand about ${companyName}'s current situation to make a credible, non-generic case — specifically relevant to a ${industry} business, not a one-size-fits-all pitch?` },
    { key: 'pain_points', label: 'Pain Points', question: `What specific pain points is ${companyName} likely facing that are common in ${industry}, based on their scale and growth stage?` },
    { key: 'buying_system', label: 'Buying System', question: `Based on ${companyName}'s size and structure, who is likely involved in a decision like this, and what would each of them need to see to support it?` }
  ];
}

// One research question, one focused search — same shape as
// presales-research.js's researchTopic, deliberately reused rather
// than reinvented.
async function researchQuestion(companyName, companyWebsite, item) {
  try {
    const res = await callClaude({
      model: 'claude-haiku-4-5-20251001',
      system: `You are doing one small, focused piece of presales research on a company. Answer the specific question given, using web search to ground your answer in real, current information where possible. If search doesn't turn up enough to answer confidently, say plainly what's genuinely known versus what remains a reasonable hypothesis worth validating directly with the prospect — never present a guess as if it were a confirmed fact. Keep the answer to 3-5 short bulleted markdown points, focused specifically on the question asked.`,
      messages: [{
        role: 'user',
        content: `Company: ${companyName}\nWebsite: ${companyWebsite || '(not provided)'}\n\nQuestion: ${item.question}`
      }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
      max_tokens: 700
    });
    const text = extractText(res);
    return { key: item.key, label: item.label, question: item.question, ok: true, answer: text || 'Nothing specific found on this.', model: res.model, usage: res.usage };
  } catch (err) {
    return { key: item.key, label: item.label, question: item.question, ok: false, error: err.message };
  }
}

function formatFindingsBlock(findings) {
  return findings.map((f) => `### ${f.label}\nQ: ${f.question}\n${f.ok ? f.answer : '(research failed on this question)'}`).join('\n\n');
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

  const { session_token, action } = payload;

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }

    if (action === 'start') {
      const { prospect_id, industry_description_override } = payload;
      if (!prospect_id) return respond(400, { ok: false, message: 'prospect_id is required.' });

      const prospectRows = await supaGet(`prospects?id=eq.${prospect_id}&select=*`);
      if (!prospectRows.length) return respond(404, { ok: false, message: 'Prospect not found.' });
      const prospect = prospectRows[0];

      if (!isInScope(member, prospect)) {
        return respond(403, { ok: false, message: 'Not authorized.' });
      }

      const isNonLmi = member.user_segment === 'non_lmi';
      const methodology = isNonLmi ? 'spin' : 'lmi';

      let questions;
      if (isNonLmi) {
        // industry_description_override: the frontend collects this
        // directly from the user BEFORE calling 'start', specifically
        // when their selected industry is "Generic B2B Services" — a
        // one-time clarifying prompt, not something this backend needs
        // to pause mid-flow for. If provided, it takes precedence over
        // whatever industry name is on file.
        let industryName = industry_description_override || null;
        if (!industryName && member.industry_context_id) {
          const industryRows = await supaGet(`industry_contexts?id=eq.${member.industry_context_id}&select=industry_name`);
          if (industryRows.length) industryName = industryRows[0].industry_name;
        }
        questions = buildSpinQuestions(prospect.company_name, industryName);
      } else {
        questions = buildLmiQuestions(prospect.company_name);
      }

      const results = await Promise.allSettled(
        questions.map((q) => researchQuestion(prospect.company_name, prospect.company_website, q))
      );
      const findings = results.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message || 'Unknown error' }));

      await Promise.all(findings.map((f) =>
        f.usage
          ? logApiUsage({ member_id: member.id, report_id: null, function_name: 'iterative-research', action: 'initial_' + f.key, model: f.model, claudeResponse: { usage: f.usage } })
          : Promise.resolve()
      ));

      const created = await supaPost('iterative_research_sessions', {
        prospect_id,
        member_id: member.id,
        organization_id: prospect.organization_id || null,
        methodology,
        stage: 'initial',
        initial_findings: findings
      });

      return respond(200, { ok: true, session: created[0] });
    }

    if (action === 'get-pathways') {
      const { session_id } = payload;
      if (!session_id) return respond(400, { ok: false, message: 'session_id is required.' });

      const sessionRows = await supaGet(`iterative_research_sessions?id=eq.${session_id}&select=*`);
      if (!sessionRows.length) return respond(404, { ok: false, message: 'Session not found.' });
      const session = sessionRows[0];

      if (!isInScope(member, session, 'member_id')) {
        return respond(403, { ok: false, message: 'Not authorized.' });
      }
      if (!session.initial_findings) {
        return respond(400, { ok: false, message: 'Initial questions have not been answered yet.' });
      }

      const prospectRows = await supaGet(`prospects?id=eq.${session.prospect_id}&select=company_name`);
      const companyName = prospectRows.length ? prospectRows[0].company_name : 'this company';

      const prompt = `Based on this initial research into ${companyName}, propose exactly TWO distinct, genuinely useful directions for deeper research — each one a specific angle worth digging into further, not a restatement of what's already been found.

INITIAL FINDINGS:
${formatFindingsBlock(session.initial_findings)}

---

Respond with EXACTLY this structure, nothing before or after:

### PATHWAY_1
Label: (a short, specific name for this direction, a few words)
Description: (one sentence on what this would investigate and why it's worth exploring, grounded in something specific from the findings above)

### PATHWAY_2
Label: (a short, specific name for this direction, a few words)
Description: (one sentence on what this would investigate and why it's worth exploring, grounded in something specific from the findings above)

The two pathways should be genuinely different from each other — not two versions of the same angle.`;

      const res = await callClaude({
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500
      });
      await logApiUsage({ member_id: member.id, report_id: null, function_name: 'iterative-research', action: 'get_pathways', model: res.model, claudeResponse: res });

      const text = extractText(res);
      const pathway1Match = text.match(/### PATHWAY_1\s*\nLabel:\s*(.+)\nDescription:\s*(.+)/i);
      const pathway2Match = text.match(/### PATHWAY_2\s*\nLabel:\s*(.+)\nDescription:\s*(.+)/i);
      const pathways = [
        pathway1Match ? { label: pathway1Match[1].trim(), description: pathway1Match[2].trim() } : { label: 'Further research', description: '(could not parse a specific pathway — try again)' },
        pathway2Match ? { label: pathway2Match[1].trim(), description: pathway2Match[2].trim() } : { label: 'Further research', description: '(could not parse a specific pathway — try again)' }
      ];

      await supaPatch(`iterative_research_sessions?id=eq.${session_id}`, {
        stage: 'pathways_offered',
        proposed_pathways: pathways,
        updated_at: new Date().toISOString()
      });

      return respond(200, { ok: true, pathways });
    }

    if (action === 'research-pathway') {
      const { session_id, selected_indexes } = payload; // e.g. [], [0], [1], [0,1]
      if (!session_id) return respond(400, { ok: false, message: 'session_id is required.' });
      if (!Array.isArray(selected_indexes)) return respond(400, { ok: false, message: 'selected_indexes must be an array.' });

      const sessionRows = await supaGet(`iterative_research_sessions?id=eq.${session_id}&select=*`);
      if (!sessionRows.length) return respond(404, { ok: false, message: 'Session not found.' });
      const session = sessionRows[0];

      if (!isInScope(member, session, 'member_id')) {
        return respond(403, { ok: false, message: 'Not authorized.' });
      }
      if (!session.proposed_pathways) {
        return respond(400, { ok: false, message: 'Pathways have not been proposed yet.' });
      }

      const prospectRows = await supaGet(`prospects?id=eq.${session.prospect_id}&select=company_name,company_website`);
      const prospect = prospectRows[0];

      let pathwayFindings = [];
      if (selected_indexes.length > 0) {
        const chosen = selected_indexes.map((i) => session.proposed_pathways[i]).filter(Boolean);
        const results = await Promise.allSettled(
          chosen.map((pw) => researchQuestion(prospect.company_name, prospect.company_website, { key: 'pathway', label: pw.label, question: pw.description }))
        );
        pathwayFindings = results.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message || 'Unknown error' }));

        await Promise.all(pathwayFindings.map((f) =>
          f.usage
            ? logApiUsage({ member_id: member.id, report_id: null, function_name: 'iterative-research', action: 'pathway_research', model: f.model, claudeResponse: { usage: f.usage } })
            : Promise.resolve()
        ));
      }

      await supaPatch(`iterative_research_sessions?id=eq.${session_id}`, {
        stage: 'pathway_researched',
        selected_pathway_indexes: selected_indexes,
        pathway_findings: pathwayFindings,
        updated_at: new Date().toISOString()
      });

      return respond(200, { ok: true, pathway_findings: pathwayFindings });
    }

    if (action === 'add-aspect') {
      const { session_id, aspect_text } = payload;
      if (!session_id) return respond(400, { ok: false, message: 'session_id is required.' });
      if (!aspect_text || !aspect_text.trim()) return respond(400, { ok: false, message: 'aspect_text is required.' });

      const sessionRows = await supaGet(`iterative_research_sessions?id=eq.${session_id}&select=*`);
      if (!sessionRows.length) return respond(404, { ok: false, message: 'Session not found.' });
      const session = sessionRows[0];

      if (!isInScope(member, session, 'member_id')) {
        return respond(403, { ok: false, message: 'Not authorized.' });
      }

      const existingAspects = session.aspects || [];
      // Capped at 2, enforced here rather than only on the frontend —
      // a crafted request shouldn't be able to bypass the limit the
      // UI presents.
      if (existingAspects.length >= 2) {
        return respond(400, { ok: false, message: 'Maximum of 2 additional aspects reached for this session.' });
      }

      const trimmedAspect = aspect_text.trim();

      const prospectRows = await supaGet(`prospects?id=eq.${session.prospect_id}&select=company_name,company_website`);
      const prospect = prospectRows[0];

      // Redundancy check FIRST — a separate, cheap, no-search call,
      // deliberately not blended into the research call itself. A
      // genuine duplicate then costs almost nothing, and the (more
      // expensive) research call only fires when something's actually
      // new. Real, honest risk worth naming: this is itself an AI
      // judgment call, and a wrong "already covered" would silently
      // discourage a genuinely useful follow-up with no visible
      // failure — worth watching in real use, same as every other
      // AI-judged piece in this app.
      const allFindingsSoFar = [
        formatFindingsBlock(session.initial_findings || []),
        (session.pathway_findings || []).map((f) => `${f.label}: ${f.ok ? f.answer : '(failed)'}`).join('\n\n'),
        existingAspects.map((a) => `${a.aspect_text}: ${a.findings || '(not found)'}`).join('\n\n')
      ].filter(Boolean).join('\n\n');

      let dedupResult;
      try {
        const dedupRes = await callClaude({
          model: 'claude-haiku-4-5-20251001',
          system: `You are checking whether a new research question is already substantively answered by research already gathered. Respond with EXACTLY "DUPLICATE" or "NEW" on the first line, then one short sentence explaining why on the second line. Only say DUPLICATE if the existing research genuinely already addresses this — a related-but-distinct angle counts as NEW.`,
          messages: [{ role: 'user', content: `ALREADY GATHERED:\n${allFindingsSoFar}\n\n---\n\nNEW ASPECT TO CHECK:\n${trimmedAspect}` }],
          max_tokens: 150
        });
        await logApiUsage({ member_id: member.id, report_id: null, function_name: 'iterative-research', action: 'dedup_check', model: dedupRes.model, claudeResponse: dedupRes });
        const dedupText = extractText(dedupRes);
        dedupResult = { isDuplicate: /^DUPLICATE/i.test(dedupText.trim()), reason: dedupText.split('\n')[1] || '' };
      } catch (err) {
        // A failed dedup check shouldn't block the aspect — treat as
        // NEW and proceed to research rather than silently dropping
        // the user's input.
        dedupResult = { isDuplicate: false, reason: '' };
      }

      let newAspect;
      if (dedupResult.isDuplicate) {
        newAspect = { aspect_text: trimmedAspect, was_duplicate: true, findings: null, duplicate_reason: dedupResult.reason };
      } else {
        const result = await researchQuestion(prospect.company_name, prospect.company_website, { key: 'aspect', label: 'Additional Aspect', question: trimmedAspect });
        if (result.usage) {
          await logApiUsage({ member_id: member.id, report_id: null, function_name: 'iterative-research', action: 'aspect_research', model: result.model, claudeResponse: { usage: result.usage } });
        }
        newAspect = { aspect_text: trimmedAspect, was_duplicate: false, findings: result.ok ? result.answer : null };
      }

      const updatedAspects = [...existingAspects, newAspect];
      await supaPatch(`iterative_research_sessions?id=eq.${session_id}`, {
        aspects: updatedAspects,
        updated_at: new Date().toISOString()
      });

      return respond(200, { ok: true, aspect: newAspect, aspects_remaining: 2 - updatedAspects.length });
    }

    if (action === 'finish') {
      const { session_id } = payload;
      if (!session_id) return respond(400, { ok: false, message: 'session_id is required.' });

      const sessionRows = await supaGet(`iterative_research_sessions?id=eq.${session_id}&select=*`);
      if (!sessionRows.length) return respond(404, { ok: false, message: 'Session not found.' });
      const session = sessionRows[0];

      if (!isInScope(member, session, 'member_id')) {
        return respond(403, { ok: false, message: 'Not authorized.' });
      }

      // Compile everything into the same confirmed_facts shape
      // presales-research.js already produces, so this feeds directly
      // into the existing Presales Prep generation flow.
      let compiled = formatFindingsBlock(session.initial_findings || []);
      if (session.pathway_findings && session.pathway_findings.length) {
        compiled += '\n\n' + session.pathway_findings.map((f) => `### ${f.label} (deeper pathway)\n${f.ok ? f.answer : '(research failed on this pathway)'}`).join('\n\n');
      }
      (session.aspects || []).forEach((a) => {
        if (a.was_duplicate) return; // already covered — nothing new to add to the compiled output
        compiled += `\n\n### Additional Aspect: ${a.aspect_text}\n${a.findings || '(research failed on this aspect)'}`;
      });

      await supaPatch(`iterative_research_sessions?id=eq.${session_id}`, {
        stage: 'complete',
        final_compiled_facts: compiled,
        updated_at: new Date().toISOString()
      });

      return respond(200, { ok: true, final_compiled_facts: compiled });
    }

    return respond(400, { ok: false, message: `Unknown action: ${action}` });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
