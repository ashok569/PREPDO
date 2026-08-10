// PREPDO — presales-generate-background.js
// BUILD 11 | 2026-08-09
// New file this build. THE FILENAME SUFFIX "-background" IS REQUIRED —
// Netlify specifically recognizes this pattern and treats the function
// as a Background Function (up to 15 minutes execution, requires the
// Personal plan or above). Do not rename this file without keeping
// that suffix, or it silently becomes a normal 30s-limited function
// again with no error telling you why.
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
      return { statusCode: 401, body: 'Not authorized.' };
    }

    if (LMI_CONTEXT_LOAD_ERROR) {
      await supaPatch(`reports?id=eq.${report_id}`, {
        status: 'failed',
        error_message: 'lmi-context.md failed to load: ' + LMI_CONTEXT_LOAD_ERROR
      });
      return { statusCode: 200, body: 'done (failed - context load)' };
    }

    // No 30s ceiling here — these can take as long as they genuinely
    // need. Still run in parallel for speed, just without the pressure.
    const [factsResult, strategyResult, digestResult] = await Promise.allSettled([
      generateFacts(prospect, confirmed_facts),
      generateStrategy(prospect, confirmed_facts),
      generateDigest(prospect, confirmed_facts)
    ]);

    const results = [factsResult, strategyResult, digestResult].map((r) =>
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

    await supaPatch(`reports?id=eq.${report_id}`, {
      ai_output_detailed: detailed,
      ai_output_summary: allSections.SUMMARY || '',
      ai_output_extra: allSections.KEY_THINGS || '',
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
    } catch (e2) {
      // If even the failure-update fails, there's nothing more we can
      // do from here — the frontend's polling will eventually time out
      // its own wait and show a generic "still processing" message.
    }
    return { statusCode: 200, body: 'done (failed - exception)' };
  }
};
