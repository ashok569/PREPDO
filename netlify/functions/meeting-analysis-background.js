// PREPDO — meeting-analysis-background.js
// BUILD 21 | 2026-08-10
// New file. THE FILENAME SUFFIX "-background" IS REQUIRED — same rule
// as presales-generate-background.js. Do not rename without keeping it.
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

function parseMarkers(text, markers) {
  const result = {};
  const pattern = new RegExp(
    `### (${markers.join('|')})\\s*\\n([\\s\\S]*?)(?=\\n### (?:${markers.join('|')})\\s*\\n|$)`,
    'g'
  );
  let m;
  while ((m = pattern.exec(text)) !== null) {
    result[m[1]] = m[2].trim();
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

function buildMeetingBlock(prospect, meeting) {
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

    const pbmAll = [...(meeting.pbm || []), ...(meeting.pbm_specific || [])];
    if (pbmAll.length) s.push(`PBM: ${pbmAll.join('; ')}`);
    if (meeting.quantified_opportunity) s.push(`Quantified Opportunity: ${meeting.quantified_opportunity}`);
    s.push(`Urgency Built: ${meeting.urgency || '(not recorded)'}`);
    s.push(`Sales Expectation Format Discussed: ${meeting.sales_expectation_format || '(not recorded)'}`);
    s.push(`RRR Established: ${meeting.rrr_established || 'no'} | RRR Verbalised by Prospect (not just asserted by salesperson): ${meeting.rrr_verbalised || 'no'} | RRR Notes: ${meeting.rrr_amount_notes || '(none)'}`);

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
    if (sr.sales_cycle_adherence_percent) srParts.push(`Self-rated sales cycle adherence: ${sr.sales_cycle_adherence_percent}%`);
    if (sr.learnings) srParts.push(`Learnings: ${sr.learnings}`);
    if (srParts.length) parts.push(`SALESPERSON'S OWN REFLECTION (their subjective view — weigh against, don't just repeat, in your own analysis):\n${srParts.join('\n')}`);
  }

  return parts.join('\n\n');
}

async function generateCore(prospect, meeting) {
  try {
    const prompt = `${buildMeetingBlock(prospect, meeting)}

---

Using the LMI sales context above, analyze this meeting. Respond with EXACTLY these markdown section headers, nothing before the first or after the last:

### DETAILED
(genuine narrative analysis of how the meeting actually went, stage by stage through the Sales Cycle — Rapport/Credibility/Trust, Probing, PBM, Needs=Motives, RRR, Urgency, Stalls&Objections, Closing, Referrals. Note explicitly where the salesperson followed the cycle well and where they diverged. When assessing talk-ratio, remember the first 5-10 minutes (R-C-T opening) is intentionally salesperson-heavy — only judge the 20/80 ratio for what happens AFTER the permission-to-probe transition.)

### SUMMARY
(condensed version, a few short paragraphs, readable in two minutes)

### OVERALL_SCORE
The FIRST line must be exactly: SCORE: X (a number 0-10, one decimal place allowed, e.g. SCORE: 7.5)
Then a blank line, then 2-3 sentences of reasoning grounded in specific, named criteria from the meeting — never an impressionistic number.`;

    const res = await callClaude({
      system: LMI_CONTEXT,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2600
    });
    const sections = parseMarkers(extractText(res), ['DETAILED', 'SUMMARY', 'OVERALL_SCORE']);
    return { ok: true, sections };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function generateScoring(prospect, meeting) {
  try {
    const prompt = `${buildMeetingBlock(prospect, meeting)}

---

Using the LMI Probability-of-Close framework from the context above, analyze this meeting. Respond with EXACTLY these markdown section headers, nothing before the first or after the last:

### PROBABILITY_OF_CLOSE
The FIRST line must be exactly: PROBABILITY: X (a whole number percentage, e.g. PROBABILITY: 45)
Then a blank line, then reasoning that explicitly addresses: was Need-Payoff reached AND verbalised by the prospect themselves (not just asserted by the salesperson)? Where does this sit in the four-stage concern sequence (problem-solution match -> price -> risk -> ask to buy)? Were buying signals ordinary or "big"? Is the quantified value coming from someone with real authority (MD/Business Head), or only from an HR-level conversation? Ground the percentage in these specific, named criteria — never an impressionistic number.

### RECOMMENDED_ACTIONS
A bulleted list of specific, concrete next actions for the salesperson — tied to what actually happened in this specific meeting, not generic sales advice.`;

    const res = await callClaude({
      system: LMI_CONTEXT,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1800
    });
    const sections = parseMarkers(extractText(res), ['PROBABILITY_OF_CLOSE', 'RECOMMENDED_ACTIONS']);
    return { ok: true, sections };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function generateGaps(prospect, meeting) {
  try {
    const prompt = `${buildMeetingBlock(prospect, meeting)}

---

Using the LMI sales context above, analyze this meeting. Respond with EXACTLY these markdown section headers, nothing before the first or after the last:

### MISSED_ITEMS
(problem statements or challenges the prospect raised but the salesperson never actually probed further — use the "what else?" principle: what should have been explored but wasn't. Be specific about what was said and what the follow-up should have been. If genuinely nothing was missed, say so plainly rather than manufacturing a gap.)

### EMERGENT_OPPORTUNITIES
(signal that doesn't fit the standard rubric above — something worth noticing that a checklist-only analysis would miss. May be brief or state plainly that nothing further stood out — never manufacture content to fill this.)

### POINTS_TO_PONDER
(a neutral reflection space for genuine ambiguity or a tentative hunch. May be brief, or state plainly that nothing further needs flagging — never manufacture content just to fill this section.)`;

    const res = await callClaude({
      system: LMI_CONTEXT,
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

    if (LMI_CONTEXT_LOAD_ERROR) {
      await supaPatch(`reports?id=eq.${report_id}`, {
        status: 'failed',
        error_message: 'lmi-context.md failed to load: ' + LMI_CONTEXT_LOAD_ERROR
      });
      return { statusCode: 200, body: 'done (failed - context load)' };
    }

    const [coreResult, scoringResult, gapsResult] = await Promise.allSettled([
      generateCore(prospect, meeting),
      generateScoring(prospect, meeting),
      generateGaps(prospect, meeting)
    ]);

    const results = [coreResult, scoringResult, gapsResult].map((r) =>
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
    if (!results[0].ok) failedParts.push('Detailed / Summary / Score');
    if (!results[1].ok) failedParts.push('Probability of Close / Recommended Actions');
    if (!results[2].ok) failedParts.push('Missed Items / Opportunities / Points to Ponder');

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
      .map((l) => l.replace(/^[-*]\s*/, '').trim())
      .filter((l) => l.length > 0);

    // The "asked for referrals = No" auto-reminder — enforced in code,
    // not left to the AI to remember to include.
    if (meeting.asked_referrals === 'no') {
      actionsArray.push('Ask for referrals next time — this wasn\'t done in this meeting.');
    }

    let ponder = allSections.POINTS_TO_PONDER || '';
    if (ponder && !/nothing further to flag/i.test(ponder)) {
      ponder += '\n\n*The above might matter, might not matter — you judge.*';
    }
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
