// PREPDO — presales-generate-background.js
// BUILD 18 | 2026-08-12
// LMI/Non-LMI segmentation. Now loads BOTH lmi-context.md and the new
// spin-context.md independently at module level, and picks which one
// to actually use per-request based on the requesting member's
// user_segment (from migration_v7.sql) — 'lmi' gets the existing full
// LMI-flavored reasoning, 'non_lmi' gets pure SPIN + generic
// consultative-selling reasoning with zero LMI-specific terminology.
// Every prompt that previously said "the LMI sales context" now says
// "the sales context" (segment-neutral phrasing), and the Strategy
// prompt's illustrative example header was changed from the LMI-
// specific "EDM and Success-Bar Calibration" to a generic
// "Key Considerations for This Meeting" — it's only there to
// demonstrate the #### formatting rule, the content was never load-
// bearing, so no reason for it to carry LMI branding either way.
//
// BUILD 17 | 2026-08-11
// Proactive fix — same bug confirmed and fixed in meeting-analysis-
// background.js: parseMarkers()'s regex was case-SENSITIVE, so a
// section whose AI-generated header casing drifted even slightly from
// exactly what was requested (e.g. "### Summary" instead of
// "### SUMMARY") would silently vanish with no error anywhere. Not
// yet reported as a symptom here, but it's the identical pattern, so
// fixed before it causes the same silent content loss. Now
// case-insensitive, with captured keys normalized to uppercase.
//
// BUILD 16 | 2026-08-10
// Real bug fix: if the session-auth check inside this function ever
// failed, it returned immediately WITHOUT ever updating the report row
// — leaving it stuck at 'pending' forever with zero explanation, even
// though report_id was fully known at that point. Now marks the report
// 'failed' with a clear reason before returning. Also see _lib.js
// BUILD 16 — the underlying Anthropic API calls now have a 90s timeout,
// closing a related gap where a hung call had nothing to catch it once
// generation moved off the old 30s-limited synchronous path.
//
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

// BUILD 30: LMI/Non-LMI segmentation. Non-LMI users get spin-context.md
// instead — same file-finding pattern, loaded independently so one
// missing file doesn't block the segment that doesn't need it.
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
    // BUILD 17 fix, applied proactively — same latent bug confirmed in
    // meeting-analysis-background.js: a case-sensitive regex silently
    // drops any section whose header casing drifts even slightly from
    // exactly what was requested (e.g. AI writes "### Summary" instead
    // of "### SUMMARY"), with no error anywhere — the section just
    // never appears. Normalizing to uppercase closes this regardless of
    // which section it might eventually hit here too.
    result[m[1].toUpperCase()] = m[2].trim();
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

async function generateStrategy(prospect, confirmed_facts, methodologyContext) {
  try {
    const prompt = `${buildProspectBlock(prospect, confirmed_facts)}

---

Using the sales context above, produce the Recommended Sales Strategy section of a presales prep report — the buying-motive hypotheses, opening/probing questions, and recommended approach for this specific meeting. Apply the sales context heavily. Write genuine narrative analysis, not just a list of category labels.

Structure this with sub-headings using #### (four hashes), each on its own line, followed by a blank line, then the paragraph — e.g.:

#### Key Considerations for This Meeting

Paragraph text here...

Do NOT use **bold** as a substitute for a sub-heading — it must be #### followed by a blank line.

Respond with EXACTLY this top-level header, nothing before it or after the content:

### STRATEGY`;

    const res = await callClaude({
      system: methodologyContext,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2200
    });
    return { ok: true, sections: parseMarkers(extractText(res), ['STRATEGY']) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function generateDigest(prospect, confirmed_facts, methodologyContext) {
  try {
    const prompt = `${buildProspectBlock(prospect, confirmed_facts)}

---

Using the sales context above, produce three condensed sections for a presales prep report. Respond with EXACTLY these markdown section headers, each on its own new line, nothing before the first or after the last:

### SUMMARY
(a condensed version of the recommended approach for this meeting — a few short paragraphs, readable in about two minutes right before walking in)

### KEY_THINGS
(a tight bullet list — 4 to 6 things not to forget in the room)

### POINTS_TO_PONDER
(a neutral reflection space for genuine ambiguity, a tentative hunch, or anything that doesn't cleanly fit elsewhere. This may be brief, or state plainly that nothing further needs flagging — never manufacture content just to fill this section.)`;

    const res = await callClaude({
      system: methodologyContext,
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

async function generateSpin(prospect, confirmed_facts, methodologyContext) {
  try {
    const hrContact = isHrRole(prospect.position);
    const hrCaution = hrContact
      ? `\n\nIMPORTANT — this contact's role ("${prospect.position}") is an HR/People-function role, not a business-operations role. For Need-Payoff Questions specifically: business-revenue framing (asking what a result would be "worth" in revenue or cost-savings terms) often does not fit what HR actually owns or can answer. Frame Need-Payoff questions instead around outcomes HR genuinely owns — succession planning, high-potential development, capacity building, training ROI, leadership effectiveness, white-collar productivity — rather than forcing a business-results number where the real currency is people-development outcomes.`
      : '';

    const prompt = `${buildProspectBlock(prospect, confirmed_facts)}

---

This section is a deliberate departure from narrative reasoning into a straightforward, literal question bank the salesperson can bring into the meeting — specific, tailored questions for THIS company and contact, not generic textbook examples.

Produce five sections, each a short bulleted list of 3-5 specific questions, following the standard SPIN structure. Respond with EXACTLY these markdown section headers, each on its own new line, nothing before the first or after the last:

### SITUATIONAL_QUESTIONS
(fact-finding questions to establish context — current setup, scale, process)

### PROBLEM_QUESTIONS
(surface difficulties, dissatisfactions, or friction points, grounded in the confirmed facts and likely dynamics above)

### IMPLICATION_QUESTIONS
(explore the consequences/cost of the problems staying unaddressed)

### NEED_PAYOFF_QUESTIONS
(get the prospect to state the value of solving the problem, in their own words)${hrCaution}

### CLOSING_QUESTIONS
(questions that move toward next steps — gauge interest, timeline, who else needs to be involved)`;

    const res = await callClaude({
      system: methodologyContext,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1400
    });
    return { ok: true, sections: parseMarkers(extractText(res), ['SITUATIONAL_QUESTIONS', 'PROBLEM_QUESTIONS', 'IMPLICATION_QUESTIONS', 'NEED_PAYOFF_QUESTIONS', 'CLOSING_QUESTIONS']) };
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

  const { report_id, prospect, confirmed_facts, session_token } = payload;

  if (!report_id || !prospect || !confirmed_facts) {
    return { statusCode: 400, body: 'report_id, prospect, and confirmed_facts are required.' };
  }

  try {
    // This function has no HTTP-facing auth otherwise (it's only meant
    // to be triggered by presales-generate-start.js, never called
    // directly by the browser) — still worth checking the session is a
    // real one, since the URL is technically guessable, and this
    // function spends real API cost per invocation.
    const member = await getMemberFromSession(session_token);
    if (!member) {
      // BUILD 16 FIX: this used to return here without ever updating
      // the report row — leaving it stuck at 'pending' forever with no
      // explanation, since report_id is fully known at this point.
      await supaPatch(`reports?id=eq.${report_id}`, {
        status: 'failed',
        error_message: 'Session check failed inside the background worker (not logged in, or session expired between starting and running the job).'
      });
      return { statusCode: 401, body: 'Not authorized.' };
    }

    // BUILD 30: LMI/Non-LMI segmentation — pick the methodology context
    // based on this specific member's segment, not a fixed module-level
    // constant, since different requests can come from different segments.
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

    // No 30s ceiling here — these can take as long as they genuinely
    // need. Still run in parallel for speed, just without the pressure.
    const [factsResult, strategyResult, digestResult, spinResult] = await Promise.allSettled([
      generateFacts(prospect, confirmed_facts),
      generateStrategy(prospect, confirmed_facts, METHODOLOGY_CONTEXT),
      generateDigest(prospect, confirmed_facts, METHODOLOGY_CONTEXT),
      generateSpin(prospect, confirmed_facts, METHODOLOGY_CONTEXT)
    ]);

    const results = [factsResult, strategyResult, digestResult, spinResult].map((r) =>
      r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message || 'Unknown error' }
    );

    if (results.every((r) => !r.ok)) {
      await supaPatch(`reports?id=eq.${report_id}`, {
        status: 'failed',
        error_message: 'Report generation failed on every section.'
      });
      return { statusCode: 200, body: 'done (failed - all sections)' };
    }

    const allSections = Object.assign({}, ...results.filter((r) => r.ok).map((r) => r.sections));
    const failedParts = [];
    if (!results[0].ok) failedParts.push('Confirmed Facts / Dynamics / Assumptions');
    if (!results[1].ok) failedParts.push('Recommended Sales Strategy');
    if (!results[2].ok) failedParts.push('Summary / Key Things / Points to Ponder');
    if (!results[3].ok) failedParts.push('SPIN Questions');

    const detailed = [
      '## Confirmed Facts', allSections.CONFIRMED_FACTS || '(not generated)',
      '', '## Likely Organizational Dynamics', allSections.LIKELY_DYNAMICS || '(not generated)',
      '', '## Assumptions to Validate', allSections.ASSUMPTIONS || '(not generated)',
      '', '## Recommended Sales Strategy', allSections.STRATEGY || '(not generated)'
    ].join('\n');

    let ponder = allSections.POINTS_TO_PONDER || '';
    if (ponder && !/nothing further to flag/i.test(ponder)) {
      ponder += '\n\n*The above might matter, might not matter — you judge.*';
    }
    if (failedParts.length > 0) {
      ponder += (ponder ? '\n\n' : '') + `*(Note: generation of ${failedParts.join(', ')} didn't complete — you may want to rerun.)*`;
    }

    const spinIntro = 'These could be possible question types to draw on for this meeting — not a script, a menu to pick from.\n\n';
    const spin = results[3].ok ? [
      spinIntro,
      '### Situational Questions', allSections.SITUATIONAL_QUESTIONS || '(not generated)',
      '', '### Problem Questions', allSections.PROBLEM_QUESTIONS || '(not generated)',
      '', '### Implication Questions', allSections.IMPLICATION_QUESTIONS || '(not generated)',
      '', '### Need-Payoff Questions', allSections.NEED_PAYOFF_QUESTIONS || '(not generated)',
      '', '### Closing Questions', allSections.CLOSING_QUESTIONS || '(not generated)'
    ].join('\n') : '';

    await supaPatch(`reports?id=eq.${report_id}`, {
      ai_output_detailed: detailed,
      ai_output_summary: allSections.SUMMARY || '',
      ai_output_extra: allSections.KEY_THINGS || '',
      ai_output_ponder: ponder,
      ai_output_spin: spin,
      status: 'complete'
    });

    return { statusCode: 200, body: 'done' };
  } catch (err) {
    try {
      await supaPatch(`reports?id=eq.${report_id}`, {
        status: 'failed',
        error_message: 'Server error: ' + err.message
      });
    } catch (e2) {
      // If even the failure-update fails, there's nothing more we can
      // do from here — the frontend's polling will eventually time out
      // its own wait and show a generic "still processing" message.
    }
    return { statusCode: 200, body: 'done (failed - exception)' };
  }
};
