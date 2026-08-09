// PREPDO — presales-research.js
// BUILD 3 | 2026-08-07
// New file this build: Presales Prep Step 1 — real web search via the
// Claude API, returns an editable Confirmed Facts list. Nothing is
// saved to the database at this step.

// /netlify/functions/presales-research.js
//
// Presales Prep, Step 1 of 2: web-searches the target company and returns
// a plain list of Confirmed Facts for the user to review/edit before the
// full report is generated. Nothing is saved to the database at this step
// — that only happens once the user confirms and calls presales-generate.

const { getMemberFromSession, callClaude, extractText, respond, handleOptions } = require('./_lib.js');

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

  const { session_token, company_name, company_website } = payload;

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }
    if (!company_name) {
      return respond(400, { ok: false, message: 'Company name is required.' });
    }

    const claudeRes = await callClaude({
      system: 'You are researching a company for a sales rep preparing for a first meeting. Use web search to find recent, verifiable public information — company news, business challenges, leadership changes, market position, recent developments. Return ONLY a bulleted markdown list of Confirmed Facts, each one a short factual statement. Do not speculate, infer, or pad with generic statements — if search turns up little, say so plainly rather than filling space. This list will be shown to the salesperson for review before anything else is generated, so accuracy matters more than length.',
      messages: [{
        role: 'user',
        content: `Company: ${company_name}\nWebsite: ${company_website || '(not provided)'}\n\nResearch this company and list confirmed facts relevant to preparing for a first B2B sales meeting with them.`
      }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      max_tokens: 2048
    });

    const confirmed_facts = extractText(claudeRes);

    if (!confirmed_facts) {
      return respond(200, { ok: false, message: 'Research returned no usable content. Try again, or proceed by editing the facts box manually.' });
    }

    return respond(200, { ok: true, confirmed_facts });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
