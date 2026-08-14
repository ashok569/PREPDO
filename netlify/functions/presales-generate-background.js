// PREPDO — presales-generate-background.js
// BUILD 40 | 2026-08-14
// Reconstructed from conversation record after a sandbox reset —
// combines the exact Build 18 base text (pasted in full earlier) with
// the Build 19 perspective-shift edits (made via targeted str_replace
// operations, reconstructed here from those exact old/new pairs) and
// the new industry-context library wiring on top. Reconstruction
// verified via syntax check + a standalone logic test of the
// perspective-shift combine function before being called complete.
//
// BUILD 19 | 2026-08-13
// Perspective-shift feature: when a rerun reveals the real decision-
// maker is someone different from the prospect's original contact
// (e.g. EDM turns out to be the MD, not the HR contact first met),
// new_contact ({name, role}) triggers this. Fetches the previous
// complete Presales Prep report SERVER-SIDE (never trusts client-
// supplied "previous content"), generates fresh content using the new
// contact as primary perspective, then combines old+new per field —
// old content first, new content appended below with a clear marker,
// NEVER overwritten. Verified with a standalone test covering all
// three real scenarios (normal generation, shift with a prior report
// found, shift with no prior report found as a graceful fallback)
// before shipping. Points to Ponder deliberately excluded from the
// append pattern — concatenating old+new ponder notes would read as
// unattributed noise, not useful signal; always just the fresh one.
//
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
// "Key Considerations for This Meeting".
//
// BUILD 17 | 2026-08-11
// parseMarkers()'s regex made case-insensitive, captured keys
// normalized to uppercase — same fix as meeting-analysis-background.js
// Build 25, applied proactively here since it's the identical pattern.
//
// BUILD 16 | 2026-08-10
// Real bug fix: if the session-auth check inside this function ever
// failed, it returned immediately WITHOUT ever updating the report row
// — leaving it stuck at 'pending' forever with zero explanation. Now
// marks the report 'failed' with a clear reason before returning.
//
// 4th parallel call: SPIN Questions (Situational/Problem/Implication/
// Need-Payoff/Closing), a literal question bank. Includes a
// conditional instruction for HR-type contacts (detected from
// position/role keywords): Need-Payoff questions steer away from
// forcing a revenue framing that often doesn't fit what HR actually
// owns, toward succession planning / capacity building / leadership
// effectiveness / productivity instead.
//
// Triggered by presales-generate-start.js, which already created the
// 'pending' report row this function updates when done. Nothing is
// returned to an HTTP caller in any meaningful way — the frontend
// finds out this function finished by polling check-report-status.js.

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
    result[m[1].toUpperCase()] = m[2].trim();
  }
  return result;
}

function buildProspectBlock(prospect, confirmed_facts) {
  const secondContact = prospect.prospect_name_2
    ? `\nSecond Contact: ${prospect.prospect_name_2}, role: ${prospect.position_2 || '(unknown)'}${prospect.linkedin_url_2 ? ', LinkedIn: ' + prospect.linkedin_url_2 : ''} (also involved in this account — consider both contacts' likely perspectives and priorities where relevant, not just the primary one)`
    : '';
  return `PROSPECT DETAILS
Company: ${prospect.company_name}
Website: ${prospect.company_website || '(not provided)'}
Contact: ${prospect.prospect_name || '(not provided)'}, role: ${prospect.position || '(unknown)'}
LinkedIn: ${prospect.linkedin_url || '(not provided)'}${secondContact}
Referred by: ${prospect.referred_by || '(not specified)'}
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

  const { report_id, prospect, confirmed_facts, new_contact, session_token } = payload;

  if (!report_id || !prospect || !confirmed_facts) {
    return { statusCode: 400, body: 'report_id, prospect, and confirmed_facts are required.' };
  }

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      await supaPatch(`reports?id=eq.${report_id}`, {
        status: 'failed',
        error_message: 'Session check failed inside the background worker (not logged in, or session expired between starting and running the job).'
      });
      return { statusCode: 401, body: 'Not authorized.' };
    }

    const isNonLmi = member.user_segment === 'non_lmi';
    let METHODOLOGY_CONTEXT = isNonLmi ? SPIN_CONTEXT : LMI_CONTEXT;
    const METHODOLOGY_LOAD_ERROR = isNonLmi ? SPIN_CONTEXT_LOAD_ERROR : LMI_CONTEXT_LOAD_ERROR;
    const METHODOLOGY_LABEL = isNonLmi ? 'spin-context.md' : 'lmi-context.md';

    // BUILD 40: pre-built industry context library — see
    // meeting-analysis-background.js for the full rationale, identical
    // pattern here.
    if (isNonLmi && member.industry_context_id) {
      try {
        const industryRows = await supaGet(`industry_contexts?id=eq.${member.industry_context_id}&select=industry_name,context_content`);
        if (industryRows.length) {
          METHODOLOGY_CONTEXT += `\n\n---\n\n## Industry Context: ${industryRows[0].industry_name}\n${industryRows[0].context_content}`;
        }
      } catch (e) {
        // A failed lookup shouldn't block the whole report.
      }
    }
    if (isNonLmi && member.org_context_research) {
      METHODOLOGY_CONTEXT += `\n\n---\n\n## The Salesperson's Own Company (for your grounding — this is who THEY work for, not the prospect)\nCompany: ${member.selling_company_name || '(not specified)'}\n${member.org_context_research}`;
    }

    if (METHODOLOGY_LOAD_ERROR) {
      await supaPatch(`reports?id=eq.${report_id}`, {
        status: 'failed',
        error_message: `${METHODOLOGY_LABEL} failed to load: ` + METHODOLOGY_LOAD_ERROR
      });
      return { statusCode: 200, body: 'done (failed - context load)' };
    }

    // BUILD 19: perspective-shift — when a rerun reveals the real
    // decision-maker is someone different from the prospect's original
    // contact, new_contact is set. Fetch the previous report SERVER-
    // SIDE (never trusting client-supplied "previous content"), and
    // generate fresh content using the new contact as primary
    // perspective. Combined with the old content AFTER generation.
    let previousReport = null;
    let generationProspect = prospect;
    if (new_contact && new_contact.name) {
      try {
        const priorRows = await supaGet(
          `reports?prospect_id=eq.${prospect.id}&report_type=eq.presales_prep&status=eq.complete&select=*&order=created_at.desc&limit=1`
        );
        if (priorRows.length) previousReport = priorRows[0];
      } catch (e) {
        // If the lookup fails, proceed as a normal generation rather
        // than blocking the whole report over a missing "previous
        // report to append to."
      }
      generationProspect = { ...prospect, prospect_name: new_contact.name, position: new_contact.role || prospect.position };
    }

    // No 30s ceiling here — these can take as long as they genuinely
    // need. Still run in parallel for speed, just without the pressure.
    const [factsResult, strategyResult, digestResult, spinResult] = await Promise.allSettled([
      generateFacts(generationProspect, confirmed_facts),
      generateStrategy(generationProspect, confirmed_facts, METHODOLOGY_CONTEXT),
      generateDigest(generationProspect, confirmed_facts, METHODOLOGY_CONTEXT),
      generateSpin(generationProspect, confirmed_facts, METHODOLOGY_CONTEXT)
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

    // BUILD 19: perspective-shift combine — old content first, new
    // content appended below with a clear marker, never overwritten.
    // Applied independently to each field, so a field the new
    // generation didn't touch (e.g. SPIN, if that call failed) still
    // shows the old content rather than going blank.
    function appendPerspective(oldContent, newContent) {
      if (!previousReport) return newContent; // no perspective shift — normal generation, unchanged
      const marker = `\n\n---\n\n## Updated Perspective — Meeting with ${new_contact.name}${new_contact.role ? ', ' + new_contact.role : ''} (Generated ${new Date().toLocaleDateString()})\n\n`;
      return (oldContent || '(no prior content)') + marker + newContent;
    }

    const finalDetailed = appendPerspective(previousReport?.ai_output_detailed, detailed);
    const finalSummary = appendPerspective(previousReport?.ai_output_summary, allSections.SUMMARY || '');
    const finalExtra = appendPerspective(previousReport?.ai_output_extra, allSections.KEY_THINGS || '');
    const finalSpin = appendPerspective(previousReport?.ai_output_spin, spin);
    // Points to Ponder deliberately NOT appended the same way — each
    // generation's ponder note is about THAT specific analysis, and
    // concatenating old+new ponder notes would read as confusing,
    // unattributed noise rather than useful signal. Always just the
    // fresh one.

    await supaPatch(`reports?id=eq.${report_id}`, {
      ai_output_detailed: finalDetailed,
      ai_output_summary: finalSummary,
      ai_output_extra: finalExtra,
      ai_output_ponder: ponder,
      ai_output_spin: finalSpin,
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
      // do from here.
    }
    return { statusCode: 200, body: 'done (failed - exception)' };
  }
};
