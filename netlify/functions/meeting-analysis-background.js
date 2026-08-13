// PREPDO — meeting-analysis-background.js
// BUILD 31 | 2026-08-12
// Closed a real leak-risk found while reviewing: buildMeetingBlock()
// describes the raw structured-form data BACK to the AI in the user
// prompt itself — even with the correct system context loaded, seeing
// "RRR"/"PBM" terminology in the INPUT data risked the model mirroring
// that vocabulary in its own output regardless of instructions. Now
// segment-aware (isNonLmi passed through from the handler to all 4
// generate* functions and into buildMeetingBlock itself). Underlying
// JSON field names (meeting.pbm, meeting.rrr_established, etc.) stay
// identical either way — only how they're DESCRIBED in the prompt
// changes. Verified with a standalone test producing genuinely
// distinct output for both segments before shipping.
//
// BUILD 27 | 2026-08-12
// LMI/Non-LMI segmentation. Now loads BOTH lmi-context.md and the new
// spin-context.md independently, and picks per-request based on the
// requesting member's user_segment (migration_v7.sql). Real gap found
// and fixed here specifically: generateDetailed's prompt had LMI stage
// names (PBM, Needs=Motives, RRR) hardcoded directly into the prompt
// TEXT, not just relying on the system context — swapping only the
// context file would NOT have been enough on its own; a non-LMI user
// would still have been explicitly asked to reason in LMI terms. Added
// stageListForSegment() so the prompt itself asks for the right stage
// vocabulary per segment. Every other prompt's "the LMI sales context"
// changed to segment-neutral "the sales context".
//
// BUILD 26 | 2026-08-11
// Small real bug found reviewing an actual Role Play report (same
// bullet-parsing pattern used there): a standalone "---" line in the
// AI's output only had its first dash stripped by the old regex,
// leaving a stray, meaningless "--" bullet in Recommended Actions. Now
// strips all leading dashes/asterisks and drops any resulting line
// with no real letters or digits.
//
// BUILD 25 | 2026-08-11
// Real bug fix: Summary showed "(not generated)" with no error or
// failure note anywhere — confirmed root cause: parseMarkers()'s regex
// was case-SENSITIVE, so when the AI wrote "### Summary" instead of
// the exact "### SUMMARY" requested, it simply never matched — no
// exception, the section just silently vanished. OVERALL_SCORE
// survived in the same response because its format instruction is far
// more rigid than Summary's looser one, so the AI was less likely to
// drift on it. Now case-insensitive, with captured keys normalized to
// uppercase for reliable lookup regardless of actual AI casing.
// Reproduced and verified fixed against the exact failure before
// shipping. Same fix applied proactively to presales-generate-
// background.js too, since it shares the identical pattern.
//
// BUILD 24 | 2026-08-11
// Removed the "The above might matter, might not matter — you judge"
// caveat line from Points to Ponder — not needed here (kept as-is in
// Presales Prep's version, only removed for Meeting Analysis).
//
// BUILD 22 | 2026-08-10
// Real bug fix from reviewing the first successful real report: Summary
// and Overall Score both came back "(not generated)" — the "core" call
// asked for DETAILED + SUMMARY + OVERALL_SCORE in one response with
// max_tokens: 2600, and DETAILED alone (a genuinely thorough,
// stage-by-stage narrative) used up the entire budget, cutting off
// before SUMMARY/OVERALL_SCORE were ever generated. Split into two
// separate parallel calls: generateDetailed (its own generous 3500
// token budget, nothing competing with it) and generateSummaryScore
// (a small, protected budget that can no longer be starved by however
// long Detailed happens to run). Now 4 parallel calls total instead of
// 3 — no time-pressure concern, still a Background Function.
//
// Produces the 8 Meeting Analysis outputs, mapped onto `reports`
// columns like this (7 display tabs, since Score+Probability share one
// tab with their reasoning):
//   Detailed                -> ai_output_detailed
//   Summary                 -> ai_output_summary
//   Overall Score (/10)     -> overall_score (number) + reasoning in ai_output_extra
//   Probability of Close(%) -> probability_of_close (number) + reasoning in ai_output_extra
//   Recommended Actions     -> recommended_actions (jsonb array)
//   Missed Items            -> ai_output_missed
//   Emergent Opportunities  -> ai_output_opportunities
//   Points to Ponder        -> ai_output_ponder
//
// Split into 3 parallel calls (no time-pressure — Background Function,
// same pattern as presales-generate-background.js):
//   1. "core"    — Detailed, Summary, Overall Score
//   2. "scoring" — Probability of Close, Recommended Actions
//   3. "gaps"    — Missed Items, Emergent Opportunities, Points to Ponder
// All three get the full lmi-context.md — unlike Presales Prep, meeting
// scoring is methodology-dependent throughout (talk-ratio phase-
// awareness, the 4-stage concern model, verbalised-vs-asserted
// Need-Payoff, stakeholder calibration), not just in one section.
//
// The "asked for referrals = No -> auto-reminder action" rule is
// enforced in CODE, not left to the AI to remember — appended
// deterministically to recommended_actions after generation.

const fs = require('fs');
const path = require('path');
const { callClaude, extractText, supaPatch, getMemberFromSession } = require('./_lib.js');

const CANDIDATE_PATHS = [
  path.join(__dirname, 'lmi-context.md'),
  path.join(__dirname, 'netlify', 'functions', 'lmi-context.md'),
  path.join(process.cwd(), 'netlify', 'functions', 'lmi-context.md'),
  '/var/task/lmi-context.md',
  '/var/task/netlify/functions/lmi-context.md'
];

let LMI_CONTEXT;
let LMI_CONTEXT_LOAD_ERROR = null;
try {
  const foundPath = CANDIDATE_PATHS.find((p) => fs.existsSync(p));
  if (!foundPath) throw new Error(`Not found in any of: ${CANDIDATE_PATHS.join(', ')}`);
  LMI_CONTEXT = fs.readFileSync(foundPath, 'utf8');
} catch (err) {
  LMI_CONTEXT_LOAD_ERROR = err.message;
}

// BUILD 27: LMI/Non-LMI segmentation — see presales-generate-
// background.js for the full rationale, identical pattern here.
const SPIN_CANDIDATE_PATHS = [
  path.join(__dirname, 'spin-context.md'),
  path.join(__dirname, 'netlify', 'functions', 'spin-context.md'),
  path.join(process.cwd(), 'netlify', 'functions', 'spin-context.md'),
  '/var/task/spin-context.md',
  '/var/task/netlify/functions/spin-context.md'
];

let SPIN_CONTEXT;
let SPIN_CONTEXT_LOAD_ERROR = null;
try {
  const foundPath = SPIN_CANDIDATE_PATHS.find((p) => fs.existsSync(p));
  if (!foundPath) throw new Error(`Not found in any of: ${SPIN_CANDIDATE_PATHS.join(', ')}`);
  SPIN_CONTEXT = fs.readFileSync(foundPath, 'utf8');
} catch (err) {
  SPIN_CONTEXT_LOAD_ERROR = err.message;
}

function parseMarkers(text, markers) {
  const result = {};
  const pattern = new RegExp(
    `### (${markers.join('|')})\\s*\\n([\\s\\S]*?)(?=\\n### (?:${markers.join('|')})\\s*\\n|$)`,
    'gi'
  );
  let m;
  while ((m = pattern.exec(text)) !== null) {
    // Normalize to uppercase regardless of how the AI actually cased the
    // header (BUILD 25 fix — confirmed root cause of a silent, no-error
    // content loss: the AI wrote "### Summary" instead of the exact
    // "### SUMMARY" requested, and the old case-sensitive regex simply
    // never matched it at all. No exception was thrown — the section
    // just silently never made it into the result, which is why no
    // failure note appeared anywhere. OVERALL_SCORE survived in the
    // same response because its format instruction is far more rigid
    // ("the FIRST line must be exactly...") than Summary's looser one.
    result[m[1].toUpperCase()] = m[2].trim();
  }
  return result;
}

// Pulls a leading "SCORE: 7.5" / "PROBABILITY: 45" style number off the
// front of a section, returning { number, rest } — rest is the
// reasoning text with that line removed, so it doesn't repeat in the UI.
function extractLeadingNumber(text, label) {
  if (!text) return { number: null, rest: text || '' };
  const re = new RegExp(`^\\s*${label}:\\s*([\\d.]+)\\s*\\n?`, 'i');
  const match = text.match(re);
  if (!match) return { number: null, rest: text };
  return { number: parseFloat(match[1]), rest: text.replace(re, '').trim() };
}

function buildMeetingBlock(prospect, meeting, isNonLmi) {
  const parts = [`PROSPECT DETAILS
Company: ${prospect.company_name}
Contact: ${prospect.prospect_name || '(not provided)'}, role: ${prospect.position || '(unknown)'}
Meeting objective (from Presales Prep, if set): ${prospect.meeting_objective || '(not specified)'}
Meeting number: ${meeting.meeting_number || '(not specified)'}
Meeting date: ${meeting.meeting_date || '(not specified)'}
Attendees: ${meeting.attendees || '(not specified)'}`];

  if (meeting.transcript && meeting.transcript.trim()) {
    parts.push(`TRANSCRIPT:\n${meeting.transcript.trim()}`);
  }

  const hasStructured = meeting.rapport || (meeting.challenges && meeting.challenges.length) ||
    (meeting.pbm && meeting.pbm.length) || meeting.rrr_established;

  if (hasStructured) {
    const s = [];
    s.push(`Rapport: ${meeting.rapport || '(not recorded)'} | Credibility: ${meeting.credibility || '(not recorded)'} | Trust: ${meeting.trust || '(not recorded)'}`);

    if (meeting.challenges && meeting.challenges.length) {
      s.push('Challenges Mentioned:');
      meeting.challenges.forEach((c) => {
        if (c.description) s.push(`  - ${c.description} (${c.type || 'type not specified'}, explored: ${c.explored || 'not specified'})`);
      });
    }

    // BUILD 31 fix: this describes raw form data BACK to the AI in the
    // prompt itself — even with the correct system context loaded,
    // seeing "RRR"/"PBM" terminology in the INPUT data risked the model
    // mirroring that vocabulary in its own output regardless of
    // instructions. The underlying JSON field names (meeting.pbm,
    // meeting.rrr_established, etc.) stay the same either way — only
    // how they're DESCRIBED here changes.
    const pbmAll = [...(meeting.pbm || []), ...(meeting.pbm_specific || [])];
    if (pbmAll.length) s.push(`${isNonLmi ? 'Top Buying Motive' : 'PBM'}: ${pbmAll.join('; ')}`);
    if (meeting.quantified_opportunity) s.push(`Quantified Opportunity: ${meeting.quantified_opportunity}`);
    s.push(`Urgency Built: ${meeting.urgency || '(not recorded)'}`);
    s.push(`Sales Expectation Format Discussed: ${meeting.sales_expectation_format || '(not recorded)'}`);
    if (isNonLmi) {
      s.push(`Need-Payoff Established: ${meeting.rrr_established || 'no'} | Need-Payoff Value Verbalized by Prospect (not just asserted by salesperson): ${meeting.rrr_verbalised || 'no'} | Need-Payoff Notes: ${meeting.rrr_amount_notes || '(none)'}`);
    } else {
      s.push(`RRR Established: ${meeting.rrr_established || 'no'} | RRR Verbalised by Prospect (not just asserted by salesperson): ${meeting.rrr_verbalised || 'no'} | RRR Notes: ${meeting.rrr_amount_notes || '(none)'}`);
    }

    if (meeting.stalls_objections && meeting.stalls_objections.length) {
      s.push('Stalls/Objections:');
      meeting.stalls_objections.forEach((o) => {
        if (o.description) s.push(`  - [${o.type || 'unspecified'}] ${o.description} — overcome: ${o.overcome || 'not specified'}${o.notes ? ' — ' + o.notes : ''}`);
      });
    }

    const signalsAll = [...(meeting.ordinary_signals || []), ...(meeting.big_signals || []), ...(meeting.signal_specific || [])];
    if (signalsAll.length) s.push(`Buying Signals Noticed: ${signalsAll.join('; ')}`);

    s.push(`Asked for Referrals: ${meeting.asked_referrals || 'no'}`);
    if (meeting.other_comments) s.push(`Other Comments: ${meeting.other_comments}`);

    parts.push(`STRUCTURED MEETING READ (filled in by the salesperson):\n${s.join('\n')}`);
  }

  if (meeting.self_reflection) {
    const sr = meeting.self_reflection;
    const srParts = [];
    if (sr.what_went_well) srParts.push(`What went well: ${sr.what_went_well}`);
    if (sr.what_could_improve) srParts.push(`What could improve: ${sr.what_could_improve}`);
    if (sr.sales_cycle_adherence_percent) srParts.push(`Self-rated adherence to ${isNonLmi ? 'the set sales meeting process' : 'the sales cycle'}: ${sr.sales_cycle_adherence_percent}%`);
    if (sr.learnings) srParts.push(`Learnings: ${sr.learnings}`);
    if (srParts.length) parts.push(`SALESPERSON'S OWN REFLECTION (their subjective view — weigh against, don't just repeat, in your own analysis):\n${srParts.join('\n')}`);
  }

  return parts.join('\n\n');
}

// The stage list itself was hardcoded with LMI terms directly in the
// prompt text (PBM/Needs=Motives/RRR) — swapping only the system
// context wouldn't have been enough, a non-LMI user would still have
// been asked to reason in LMI-specific terms. Segment-aware helper.
function stageListForSegment(isNonLmi) {
  return isNonLmi
    ? 'Situation, Problem, Implication, Need-Payoff, Objections/Stalls handling, Closing'
    : 'Rapport/Credibility/Trust, Probing, PBM, Needs=Motives, RRR, Urgency, Stalls&Objections, Closing, Referrals';
}

async function generateDetailed(prospect, meeting, methodologyContext, isNonLmi) {
  try {
    const prompt = `${buildMeetingBlock(prospect, meeting, isNonLmi)}

---

Using the sales context above, analyze this meeting. Respond with EXACTLY this markdown section header, nothing before it or after the content:

### DETAILED
(genuine narrative analysis of how the meeting actually went, stage by stage through: ${stageListForSegment(isNonLmi)}. Note explicitly where the salesperson followed good technique and where they diverged. When assessing talk-ratio, remember the first 5-10 minutes (the opening/rapport phase) is intentionally salesperson-heavy — only judge the 20/80 ratio for what happens AFTER the shift into real probing.)`;

    const res = await callClaude({
      system: methodologyContext,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 3500
    });
    const sections = parseMarkers(extractText(res), ['DETAILED']);
    return { ok: true, sections };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function generateSummaryScore(prospect, meeting, methodologyContext, isNonLmi) {
  try {
    const prompt = `${buildMeetingBlock(prospect, meeting, isNonLmi)}

---

Using the sales context above, analyze this meeting. Respond with EXACTLY these markdown section headers, nothing before the first or after the last:

### SUMMARY
(condensed version, a few short paragraphs, readable in two minutes)

### OVERALL_SCORE
The FIRST line must be exactly: SCORE: X (a number 0-10, one decimal place allowed, e.g. SCORE: 7.5)
Then a blank line, then 2-3 sentences of reasoning grounded in specific, named criteria from the meeting — never an impressionistic number.`;

    const res = await callClaude({
      system: methodologyContext,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000
    });
    const sections = parseMarkers(extractText(res), ['SUMMARY', 'OVERALL_SCORE']);
    return { ok: true, sections };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function generateScoring(prospect, meeting, methodologyContext, isNonLmi) {
  try {
    const prompt = `${buildMeetingBlock(prospect, meeting, isNonLmi)}

---

Using the Probability-of-Close reasoning framework from the sales context above, analyze this meeting. Respond with EXACTLY these markdown section headers, nothing before the first or after the last:

### PROBABILITY_OF_CLOSE
The FIRST line must be exactly: PROBABILITY: X (a whole number percentage, e.g. PROBABILITY: 45)
Then a blank line, then reasoning that explicitly addresses: was Need-Payoff reached AND verbalised by the prospect themselves (not just asserted by the salesperson)? Where does this sit in the natural progression toward a decision? Were buying signals ordinary or "big"? Is the quantified value coming from someone with real authority to act on it, or only from someone who owns the pain but not the budget? Ground the percentage in these specific, named criteria — never an impressionistic number.

### RECOMMENDED_ACTIONS
A bulleted list of specific, concrete next actions for the salesperson — tied to what actually happened in this specific meeting, not generic sales advice.`;

    const res = await callClaude({
      system: methodologyContext,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1800
    });
    const sections = parseMarkers(extractText(res), ['PROBABILITY_OF_CLOSE', 'RECOMMENDED_ACTIONS']);
    return { ok: true, sections };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function generateGaps(prospect, meeting, methodologyContext, isNonLmi) {
  try {
    const prompt = `${buildMeetingBlock(prospect, meeting, isNonLmi)}

---

Using the sales context above, analyze this meeting. Respond with EXACTLY these markdown section headers, nothing before the first or after the last:

### MISSED_ITEMS
(problem statements or challenges the prospect raised but the salesperson never actually probed further — use the "what else?" principle: what should have been explored but wasn't. Be specific about what was said and what the follow-up should have been. If genuinely nothing was missed, say so plainly rather than manufacturing a gap.)

### EMERGENT_OPPORTUNITIES
(signal that doesn't fit the standard rubric above — something worth noticing that a checklist-only analysis would miss. May be brief or state plainly that nothing further stood out — never manufacture content to fill this.)

### POINTS_TO_PONDER
(a neutral reflection space for genuine ambiguity or a tentative hunch. May be brief, or state plainly that nothing further needs flagging — never manufacture content just to fill this section.)`;

    const res = await callClaude({
      system: methodologyContext,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1600
    });
    const sections = parseMarkers(extractText(res), ['MISSED_ITEMS', 'EMERGENT_OPPORTUNITIES', 'POINTS_TO_PONDER']);
    return { ok: true, sections };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

exports.handler = async function (event) {
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid request.' };
  }

  const { report_id, prospect, meeting, session_token } = payload;

  if (!report_id || !prospect || !meeting) {
    return { statusCode: 400, body: 'report_id, prospect, and meeting are required.' };
  }

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      await supaPatch(`reports?id=eq.${report_id}`, {
        status: 'failed',
        error_message: 'Session check failed inside the background worker.'
      });
      return { statusCode: 401, body: 'Not authorized.' };
    }

    // BUILD 27: LMI/Non-LMI segmentation — see presales-generate-
    // background.js for the full rationale, identical pattern here.
    const isNonLmi = member.user_segment === 'non_lmi';
    const METHODOLOGY_CONTEXT = isNonLmi ? SPIN_CONTEXT : LMI_CONTEXT;
    const METHODOLOGY_LOAD_ERROR = isNonLmi ? SPIN_CONTEXT_LOAD_ERROR : LMI_CONTEXT_LOAD_ERROR;
    const METHODOLOGY_LABEL = isNonLmi ? 'spin-context.md' : 'lmi-context.md';

    if (METHODOLOGY_LOAD_ERROR) {
      await supaPatch(`reports?id=eq.${report_id}`, {
        status: 'failed',
        error_message: `${METHODOLOGY_LABEL} failed to load: ` + METHODOLOGY_LOAD_ERROR
      });
      return { statusCode: 200, body: 'done (failed - context load)' };
    }

    const [detailedResult, summaryScoreResult, scoringResult, gapsResult] = await Promise.allSettled([
      generateDetailed(prospect, meeting, METHODOLOGY_CONTEXT, isNonLmi),
      generateSummaryScore(prospect, meeting, METHODOLOGY_CONTEXT, isNonLmi),
      generateScoring(prospect, meeting, METHODOLOGY_CONTEXT, isNonLmi),
      generateGaps(prospect, meeting, METHODOLOGY_CONTEXT, isNonLmi)
    ]);

    const results = [detailedResult, summaryScoreResult, scoringResult, gapsResult].map((r) =>
      r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message || 'Unknown error' }
    );

    if (results.every((r) => !r.ok)) {
      await supaPatch(`reports?id=eq.${report_id}`, {
        status: 'failed',
        error_message: 'Meeting analysis failed on every section.'
      });
      return { statusCode: 200, body: 'done (failed - all sections)' };
    }

    const allSections = Object.assign({}, ...results.filter((r) => r.ok).map((r) => r.sections));
    const failedParts = [];
    if (!results[0].ok) failedParts.push('Detailed');
    if (!results[1].ok) failedParts.push('Summary / Score');
    if (!results[2].ok) failedParts.push('Probability of Close / Recommended Actions');
    if (!results[3].ok) failedParts.push('Missed Items / Opportunities / Points to Ponder');

    const scoreParsed = extractLeadingNumber(allSections.OVERALL_SCORE, 'SCORE');
    const probParsed = extractLeadingNumber(allSections.PROBABILITY_OF_CLOSE, 'PROBABILITY');

    // Score + Probability reasoning share one tab in the UI — combine
    // them into ai_output_extra with clear sub-headings.
    const scoreProbReasoning = [
      '## Overall Score', scoreParsed.rest || '(not generated)',
      '', '## Probability of Close', probParsed.rest || '(not generated)'
    ].join('\n');

    // Turn the bulleted Recommended Actions text into a simple array for
    // the jsonb column, one string per bullet line.
    const actionsText = allSections.RECOMMENDED_ACTIONS || '';
    const actionsArray = actionsText.split('\n')
      // BUILD 26 fix: a standalone "---" line (the AI sometimes adds
      // these as section dividers) only had its FIRST dash stripped by
      // the old regex, leaving a stray "--" as its own meaningless
      // bullet. Now strips ALL leading dashes/asterisks, and drops any
      // line left with no actual letters or digits.
      .map((l) => l.replace(/^[-*]+\s*/, '').trim())
      .filter((l) => l.length > 0 && /[a-zA-Z0-9]/.test(l));

    // The "asked for referrals = No" auto-reminder — enforced in code,
    // not left to the AI to remember to include.
    if (meeting.asked_referrals === 'no') {
      actionsArray.push('Ask for referrals next time — this wasn\'t done in this meeting.');
    }

    let ponder = allSections.POINTS_TO_PONDER || '';
    if (failedParts.length > 0) {
      ponder += (ponder ? '\n\n' : '') + `*(Note: generation of ${failedParts.join(', ')} didn't complete — you may want to rerun.)*`;
    }

    await supaPatch(`reports?id=eq.${report_id}`, {
      ai_output_detailed: allSections.DETAILED || '(not generated)',
      ai_output_summary: allSections.SUMMARY || '(not generated)',
      overall_score: scoreParsed.number,
      probability_of_close: probParsed.number,
      ai_output_extra: scoreProbReasoning,
      recommended_actions: actionsArray,
      ai_output_missed: allSections.MISSED_ITEMS || '(not generated)',
      ai_output_opportunities: allSections.EMERGENT_OPPORTUNITIES || '(not generated)',
      ai_output_ponder: ponder,
      status: 'complete'
    });

    return { statusCode: 200, body: 'done' };
  } catch (err) {
    try {
      await supaPatch(`reports?id=eq.${report_id}`, {
        status: 'failed',
        error_message: 'Server error: ' + err.message
      });
    } catch (e2) { /* nothing more we can do */ }
    return { statusCode: 200, body: 'done (failed - exception)' };
  }
};
