// PREPDO — roleplay-debrief-background.js
// BUILD 29 | 2026-08-11
// Small real bug fixed after reviewing the first actual Role Play
// report: Next Practice showed a stray, meaningless "--" bullet at the
// end of the list — caused by a standalone "---" divider line in the
// AI's output only having its first dash stripped by the old regex.
// Same fix applied to meeting-analysis-background.js, which has the
// identical pattern. Now strips all leading dashes/asterisks and drops
// any resulting line with no real letters or digits.
//
// BUILD 27 | 2026-08-11
// New file. THE FILENAME SUFFIX "-background" IS REQUIRED — same rule
// as the other background functions. Unlike roleplay-turn.js, this DOES
// load lmi-context.md — this step evaluates the salesperson's real
// performance from the outside, against the full LMI framework, same
// rigor as Meeting Analysis. One Sonnet call over the whole transcript;
// async because a full conversation can be long and this is a single
// substantial reasoning call, not something worth risking against the
// old 30s ceiling.
//
// Produces 5 outputs, mapped onto existing `reports` columns (reusing
// the same pattern established for Presales Prep / Meeting Analysis
// rather than adding new ones):
//   Detailed                -> ai_output_detailed
//   Summary                 -> ai_output_summary
//   Overall Score (/10)     -> overall_score (number) + reasoning folded into ai_output_detailed
//   What To Practice Next   -> recommended_actions (jsonb array)
//   Points to Ponder        -> ai_output_ponder
// No Probability of Close / Missed Items / Emergent Opportunities here
// — those are real-deal concepts, not applicable to a practice session.

const fs = require('fs');
const path = require('path');
const { callClaude, extractText, supaPatch, supaGet, getMemberFromSession } = require('./_lib.js');

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
    'gi'
  );
  let m;
  while ((m = pattern.exec(text)) !== null) {
    result[m[1].toUpperCase()] = m[2].trim();
  }
  return result;
}

function extractLeadingNumber(text, label) {
  if (!text) return { number: null, rest: text || '' };
  const re = new RegExp(`^\\s*${label}:\\s*([\\d.]+)\\s*\\n?`, 'i');
  const match = text.match(re);
  if (!match) return { number: null, rest: text };
  return { number: parseFloat(match[1]), rest: text.replace(re, '').trim() };
}

function formatTranscript(conversation) {
  return conversation.map(turn =>
    turn.speaker === 'user' ? `SALESPERSON: ${turn.content}` : `PROSPECT: ${turn.content}`
  ).join('\n\n');
}

exports.handler = async function (event) {
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid request.' };
  }

  const { report_id, session_token } = payload;
  if (!report_id) {
    return { statusCode: 400, body: 'report_id is required.' };
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

    const rows = await supaGet(`reports?id=eq.${report_id}&select=*`);
    if (!rows.length) {
      return { statusCode: 404, body: 'Report not found.' };
    }
    const report = rows[0];
    const scenario = report.structured_data?.scenario;
    const transcript = formatTranscript(report.conversation || []);

    const prompt = `A salesperson practiced a live sales roleplay conversation. Here is the scenario setup and the full transcript.

SCENARIO: ${scenario ? JSON.stringify(scenario) : '(not recorded)'}

TRANSCRIPT:
${transcript}

---

Using the LMI sales context above, evaluate the SALESPERSON's performance in this practice conversation (not the AI-played prospect — that side was just simulation for practice). Respond with EXACTLY these markdown section headers, nothing before the first or after the last:

### DETAILED
(genuine stage-by-stage analysis of how the conversation went, referencing the actual Sales Cycle stages and SPIN questioning where relevant — Rapport/Credibility, Probing/Situation-Problem-Implication, PBM, Need-Payoff, Urgency, handling any objections that came up, closing/next-step. Note specifically what was done well and what diverged from good practice, grounded in what was actually said, not generic advice.)

### SUMMARY
(a condensed version, readable in two minutes)

### OVERALL_SCORE
The FIRST line must be exactly: SCORE: X (a number 0-10, one decimal place allowed, e.g. SCORE: 7.5)
Then a blank line, then 2-3 sentences of reasoning grounded in specific, named moments from the transcript — never an impressionistic number.

### NEXT_PRACTICE
A bulleted list of 3-5 specific, concrete things to practice next — tied to what actually happened in THIS conversation (e.g. a specific objection that could have been handled better, a transition that was rushed, a Need-Payoff that never got verbalised) — not generic sales advice.

### POINTS_TO_PONDER
(a neutral reflection space for genuine ambiguity or a tentative hunch about this practice session. May be brief, or state plainly that nothing further needs flagging — never manufacture content just to fill this section.)`;

    const res = await callClaude({
      system: LMI_CONTEXT,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 3500
    });

    const sections = parseMarkers(extractText(res), ['DETAILED', 'SUMMARY', 'OVERALL_SCORE', 'NEXT_PRACTICE', 'POINTS_TO_PONDER']);
    const scoreParsed = extractLeadingNumber(sections.OVERALL_SCORE, 'SCORE');

    const detailed = (sections.DETAILED || '(not generated)') +
      (scoreParsed.rest ? '\n\n## Overall Score Reasoning\n' + scoreParsed.rest : '');

    const nextPracticeText = sections.NEXT_PRACTICE || '';
    const nextPracticeArray = nextPracticeText.split('\n')
      // Same fix as meeting-analysis-background.js: a standalone "---"
      // divider line only had its first dash stripped, leaving a stray
      // "--" bullet with no content. Confirmed via a real report.
      .map((l) => l.replace(/^[-*]+\s*/, '').trim())
      .filter((l) => l.length > 0 && /[a-zA-Z0-9]/.test(l));

    await supaPatch(`reports?id=eq.${report_id}`, {
      ai_output_detailed: detailed,
      ai_output_summary: sections.SUMMARY || '(not generated)',
      overall_score: scoreParsed.number,
      recommended_actions: nextPracticeArray,
      ai_output_ponder: sections.POINTS_TO_PONDER || '',
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
