// PREPDO — presales-generate.js
// BUILD 9 | 2026-08-09
// Fixed the real remaining issue: this function now loads lmi-context.md
// correctly (see BUILD 8 / netlify.toml), but generating all 7 report
// sections in ONE call was too slow — confirmed by a real 504 at
// ~30.4s in testing. Same fix as presales-research.js: split into
// parallel calls instead of one large sequential one, so total time is
// bounded by the slowest single call, not the sum.
//
// Split into 3 parallel calls:
//   1. "facts" — Confirmed Facts / Likely Dynamics / Assumptions.
//      Mostly organizing given facts + generic business inference, not
//      deep LMI-methodology reasoning — Haiku, no need for the full
//      lmi-context.md.
//   2. "strategy" — the Recommended Sales Strategy section alone. This
//      is the one place lmi-context.md needs to be applied heavily, so
//      it gets its own dedicated call, full context, Sonnet, generous
//      token budget.
//   3. "digest" — Summary / Key Things / Points to Ponder. Condensed
//      derivative content, generated independently (in parallel, not
//      sequentially from Strategy's actual output) — a deliberate
//      trade-off: slightly less perfectly cross-referenced with the
//      Strategy call's exact wording, in exchange for reliably beating
//      the 30s ceiling. Still grounded in the same facts + full LMI
//      context, so it stays broadly consistent even though it's an
//      independent generation, not a literal summary-of-the-output.
//
// If one of the 3 calls fails, the others still return — a partial
// report (with a clear note on what's missing) beats losing the whole
// step over one bad sub-call, same principle as the research fix.

// /netlify/functions/presales-generate.js
//
// Presales Prep, Step 2 of 2: takes the (possibly user-edited) Confirmed
// Facts plus the prospect details, reasons using lmi-context.md, and
// produces the four-part Detailed structure + Summary + Key Things to
// Keep in Mind + Points to Ponder. Saves the result as a row in `reports`.

const fs = require('fs');
const path = require('path');
const { getMemberFromSession, callClaude, extractText, supaPost, respond, handleOptions } = require('./_lib.js');

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
  if (!foundPath) {
    throw new Error(`Not found in any of: ${CANDIDATE_PATHS.join(', ')}`);
  }
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
Notes: ${prospect.notes || '(none)'}

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

Using the LMI sales context above, produce the Recommended Sales Strategy section of a presales prep report — the PBM hypotheses, opening/probing questions, and recommended approach for this specific meeting. Apply the LMI sales context heavily. Write genuine narrative analysis, not just a list of category labels. Respond with EXACTLY this header, nothing before it or after the content:

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

  const { session_token, prospect_id, prospect, confirmed_facts } = payload;

  try {
    if (LMI_CONTEXT_LOAD_ERROR) {
      return respond(500, { ok: false, message: 'lmi-context.md failed to load: ' + LMI_CONTEXT_LOAD_ERROR + ' — check it exists in netlify/functions/ on the deployed site, with the exact filename "lmi-context.md".' });
    }
    const member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }
    if (!prospect_id || !confirmed_facts || !prospect) {
      return respond(400, { ok: false, message: 'prospect_id, prospect, and confirmed_facts are all required.' });
    }

    // Fire all three in parallel — total time bounded by the slowest
    // one, not the sum. allSettled so one bad section doesn't kill the
    // whole report.
    const [factsResult, strategyResult, digestResult] = await Promise.allSettled([
      generateFacts(prospect, confirmed_facts),
      generateStrategy(prospect, confirmed_facts),
      generateDigest(prospect, confirmed_facts)
    ]);

    const results = [factsResult, strategyResult, digestResult].map((r) =>
      r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message || 'Unknown error' }
    );

    if (results.every((r) => !r.ok)) {
      return respond(200, { ok: false, message: 'Report generation failed on every section. Try again.' });
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
      ponder += (ponder ? '\n\n' : '') + `*(Note: generation of ${failedParts.join(', ')} didn't complete — you may want to retry.)*`;
    }

    const [report] = await supaPost('reports', {
      prospect_id,
      owner_id: member.id,
      report_type: 'presales_prep',
      confirmed_facts,
      ai_output_detailed: detailed,
      ai_output_summary: allSections.SUMMARY || '',
      ai_output_extra: allSections.KEY_THINGS || '',
      ai_output_ponder: ponder
    });

    return respond(200, { ok: true, report });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
