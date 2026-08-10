// PREPDO — presales-generate-background.js
// BUILD 14 | 2026-08-10
// Added a 4th parallel call: SPIN Questions (Situational/Problem/
// Implication/Need-Payoff/Closing), a literal question bank rather than
// narrative analysis — deliberately a departure from pure LMI-method
// reasoning. Includes a conditional instruction for HR-type contacts
// (detected from position/role keywords): Need-Payoff questions steer
// away from forcing a revenue framing that often doesn't fit what HR
// actually owns, toward succession planning / high-potential
// development / capacity building / training ROI / leadership
// effectiveness / productivity instead.
//
// This does the actual AI work — same 3-parallel-call approach as the
// old presales-generate.js (facts / strategy / digest), but now with
// no deadline pressure at all. Triggered by presales-generate-start.js,
// which already created the 'pending' report row this function updates
// when done. Nothing is returned to an HTTP caller in any meaningful
// way — the frontend finds out this function finished by polling
// check-report-status.js, not by waiting on this function's response.

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

function buildProspectBlock(prospect, confirmed_facts) {
  return `PROSPECT DETAILS
Company: ${prospect.company_name}
Website: ${prospect.company_website || '(not provided)'}
Contact: ${prospect.prospect_name || '(not provided)'}, role: ${prospect.position || '(unknown)'}
LinkedIn: ${prospect.linkedin_url || '(not provided)'}
Meeting objective: ${prospect.meeting_objective || '(not specified)'}
Notes: ${prospect.notes || '(none)'} (if this mentions a referral source, introduction, or how the meeting was arranged, treat that as important context and reflect it in Strategy/Assumptions — e.g. a warm introduction changes how Rapport/Credibility can be opened)

CONFIRMED FACTS (from research, reviewed and possibly edited by the salesperson — treat as ground truth):
${confirmed_facts}`;
}

async function generateFacts(prospect, confirmed_facts) {
  try {
    const prompt = `${buildProspectBlock(prospect, confirmed_facts)}

---

Produce three sections for a presales prep report. Respond with EXACTLY these markdown section headers, each on its own new line, nothing before the first or after the last:

### CONFIRMED_FACTS
(restate the confirmed facts, lightly organized — stay close to what was verified, don't add new claims)

### LIKELY_DYNAMICS
(reasonable inference about organizational dynamics from company size/industry/situation — label as inference, not fact; stay at the company/role level, do not speculate about the named individual contact's personality)

### ASSUMPTIONS
(open questions the confirmed facts can't answer — things worth validating early in the meeting)`;

    const res = await callClaude({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200
    });
    return { ok: true, sections: parseMarkers(extractText(res), ['CONFIRMED_FACTS', 'LIKELY_DYNAMICS', 'ASSUMPTIONS']) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function generateStrategy(prospect, confirmed_facts) {
  try {
    const prompt = `${buildProspectBlock(prospect, confirmed_facts)}

---

Using the LMI sales context above, produce the Recommended Sales Strategy section of a presales prep report — the PBM hypotheses, opening/probing questions, and recommended approach for this specific meeting. Apply the LMI sales context heavily. Write genuine narrative analysis, not just a list of category labels.

Structure this with sub-headings using #### (four hashes), each on its own line, followed by a blank line, then the paragraph — e.g.:

#### EDM and Success-Bar Calibration

Paragraph text here...

Do NOT use **bold** as a substitute for a sub-heading — it must be #### followed by a blank line.

Respond with EXACTLY this top-level header, nothing before it or after the content:

### STRATEGY`;

    const res = await callClaude({
      system: LMI_CONTEXT,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2200
    });
    return { ok: true, sections: parseMarkers(extractText(res), ['STRATEGY']) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function generateDigest(prospect, confirmed_facts) {
  try {
    const prompt = `${buildProspectBlock(prospect, confirmed_facts)}

---

Using the LMI sales context above, produce three condensed sections for a presales prep report. Respond with EXACTLY these markdown section headers, each on its own new line, nothing before the first or after the last:

### SUMMARY
(a condensed version of the recommended approach for this meeting — a few short paragraphs, readable in about two minutes right before walking in)

### KEY_THINGS
(a tight bullet list — 4 to 6 things not to forget in the room)

### POINTS_TO_PONDER
(a neutral reflection space for genuine ambiguity, a tentative hunch, or anything that doesn't cleanly fit elsewhere. This may be brief, or state plainly that nothing further needs flagging — never manufacture content just to fill this section.)`;

    const res = await callClaude({
      system: LMI_CONTEXT,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500
    });
    return { ok: true, sections: parseMarkers(extractText(res), ['SUMMARY', 'KEY_THINGS', 'POINTS_TO_PONDER']) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Rough keyword check for whether the contact sits in an HR/People
// function rather than a business-operations role — used to steer
// Need-Payoff questions away from forcing a revenue framing that often
// doesn't fit what HR actually owns.
function isHrRole(position) {
  if (!position) return false;
  const hrKeywords = /\b(HR|human resources?|people( ops| team| function)?|talent|L\s?&\s?D|learning\s*&?\s*development|CHRO|CPO|chief people)\b/i;
  return hrKeywords.test(position);
}

async function generateSpin(prospect, confirmed_facts) {
  try {
    const hrContact = isHrRole(prospect.position);
    const hrCaution = hrContact
      ? `\n\nIMPORTANT — this contact's role ("${prospect.position}") is an HR/People-function role, not a business-operations role. For Need-Payoff Questions specifically: business-revenue framing (asking what a result would be "worth" in revenue or cost-savings terms) often does not fit what HR actually owns or can answer. Frame Need-Payoff questions instead around outcomes HR genuinely owns — succession planning, high-potential development, capacity building, training ROI, leadership effectiveness, white-collar productivity — rather than forcing a business-results number where the real currency is people-development outcomes.`
      : '';

    const prompt = `${buildProspectBlock(prospect, confirmed_facts)}

---

This section is a
