// PREPDO — presales-generate.js
// BUILD 7 | 2026-08-09
// Fixed: fs.readFileSync(lmi-context.md) was crashing the whole module
// at load time if that file was missing/misnamed on the deployed site —
// this produces an instant, opaque 502 (visible in Netlify logs as a
// very short duration, ~1-2s, NOT a ~30s timeout — a different failure
// mode than the earlier research timeout, easy to tell apart by
// duration alone). Now wrapped in try/catch so a missing file returns
// a clear, diagnosable error message instead of crashing silently.

// /netlify/functions/presales-generate.js
//
// Presales Prep, Step 2 of 2: takes the (possibly user-edited) Confirmed
// Facts plus the prospect details, reasons using lmi-context.md, and
// produces the four-part Detailed structure + Summary + Key Things to
// Keep in Mind + Points to Ponder. Saves the result as a row in `reports`.

const fs = require('fs');
const path = require('path');
const { getMemberFromSession, callClaude, extractText, supaPost, respond, handleOptions } = require('./_lib.js');

let LMI_CONTEXT;
let LMI_CONTEXT_LOAD_ERROR = null;
try {
  LMI_CONTEXT = fs.readFileSync(path.join(__dirname, 'lmi-context.md'), 'utf8');
} catch (err) {
  // Module-level errors can't be caught by the handler's own try/catch
  // (they happen before the handler even exists), so we catch it here
  // and let the handler return a clean message instead of the whole
  // function silently failing to load.
  LMI_CONTEXT_LOAD_ERROR = err.message;
}

const SECTION_NAMES = ['CONFIRMED_FACTS', 'LIKELY_DYNAMICS', 'ASSUMPTIONS', 'STRATEGY', 'SUMMARY', 'KEY_THINGS', 'POINTS_TO_PONDER'];

function parseSections(text) {
  const result = {};
  const pattern = new RegExp(
    `### (${SECTION_NAMES.join('|')})\\s*\\n([\\s\\S]*?)(?=\\n### (?:${SECTION_NAMES.join('|')})\\s*\\n|$)`,
    'g'
  );
  let m;
  while ((m = pattern.exec(text)) !== null) {
    result[m[1]] = m[2].trim();
  }
  return result;
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

    const userPrompt = `PROSPECT DETAILS
Company: ${prospect.company_name}
Website: ${prospect.company_website || '(not provided)'}
Contact: ${prospect.prospect_name || '(not provided)'}, role: ${prospect.position || '(unknown)'}
LinkedIn: ${prospect.linkedin_url || '(not provided)'}
Meeting objective: ${prospect.meeting_objective || '(not specified)'}
Notes: ${prospect.notes || '(none)'}

CONFIRMED FACTS (from research, reviewed and possibly edited by the salesperson — treat as ground truth):
${confirmed_facts}

---

Using the LMI sales context above, produce a presales preparation report for this specific meeting. Respond with EXACTLY these markdown section headers, each starting on its own new line, in this exact order, with nothing before the first header and nothing after the last section's content:

### CONFIRMED_FACTS
(restate the confirmed facts, lightly organized — this section should stay close to what was verified, not add new claims)

### LIKELY_DYNAMICS
(reasonable inference about organizational dynamics from company size/industry/situation — label as inference, not fact; stay at the company/role level, do not speculate about the named individual contact's personality)

### ASSUMPTIONS
(open questions the confirmed facts can't answer — things worth validating early in the meeting)

### STRATEGY
(the actual PBM hypotheses, opening/probing questions, and recommended approach for this meeting — apply the LMI sales context heavily here. Write genuine narrative analysis, not just a list of category labels.)

### SUMMARY
(a condensed version of the above — a few short paragraphs, readable in about two minutes right before walking into the meeting)

### KEY_THINGS
(a tight bullet list — 4 to 6 things not to forget in the room)

### POINTS_TO_PONDER
(a neutral reflection space for genuine ambiguity, a tentative hunch, or anything that doesn't cleanly fit the sections above. This may be brief, or state plainly that nothing further needs flagging — never manufacture content just to fill this section.)`;

    const claudeRes = await callClaude({
      system: LMI_CONTEXT,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 6000
    });

    const fullText = extractText(claudeRes);
    const sections = parseSections(fullText);

    if (Object.keys(sections).length === 0) {
      // The model didn't follow the section-marker format — return the raw
      // text rather than silently saving an empty report.
      return respond(200, {
        ok: false,
        message: 'The report generated but not in the expected format. Raw output below — you can copy it manually, or try again.',
        raw_output: fullText
      });
    }

    const detailed = [
      '## Confirmed Facts', sections.CONFIRMED_FACTS || '(not generated)',
      '', '## Likely Organizational Dynamics', sections.LIKELY_DYNAMICS || '(not generated)',
      '', '## Assumptions to Validate', sections.ASSUMPTIONS || '(not generated)',
      '', '## Recommended Sales Strategy', sections.STRATEGY || '(not generated)'
    ].join('\n');

    let ponder = sections.POINTS_TO_PONDER || '';
    if (ponder && !/nothing further to flag/i.test(ponder)) {
      ponder += '\n\n*The above might matter, might not matter — you judge.*';
    }

    const [report] = await supaPost('reports', {
      prospect_id,
      owner_id: member.id,
      report_type: 'presales_prep',
      confirmed_facts,
      ai_output_detailed: detailed,
      ai_output_summary: sections.SUMMARY || '',
      ai_output_extra: sections.KEY_THINGS || '',
      ai_output_ponder: ponder
    });

    return respond(200, { ok: true, report });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
