// PREPDO — roleplay-turn.js
// BUILD 30 | 2026-09-11
// Real gap fix, found while scoping the KBR Doer-Seller industry
// document: industry_context_id's content previously only fed the
// debrief step (roleplay-debrief-background.js) — never the LIVE
// persona itself, meaning selecting an industry never actually
// changed how the roleplay character behaved during the conversation,
// only how it got scored afterward. Now fetched the same way
// presales-generate-background.js/meeting-analysis-background.js
// already do, and passed into the persona prompt as grounding for the
// PERSONA'S OWN world (realistic buyer types, business situations,
// problems for that industry) — deliberately never framed as
// methodology guidance the character is aware of, staying consistent
// with the existing rule that the persona must never reference or
// acknowledge any sales technique. Tested the conditional logic
// directly: LMI users and Non-LMI users with no industry selected are
// completely unaffected (empty block, byte-identical prompt to
// before); only a Non-LMI user with an industry selected sees the
// addition.
//
// BUILD 29 | 2026-09-11
// Replaced the admin-scope check with the new shared isInScope() from
// _lib.js — same tier-rework fix as prospects.js. select=* already
// includes organization_id once migration_v18.sql has run, so no
// query change needed here, just the check itself.
//
// BUILD 28 | 2026-09-06
// Added prompt caching and real usage tracking. Real, honest note on
// scope: this file deliberately does NOT load lmi-context.md (see the
// unchanged note below on why) — so this is NOT the ~21K-token caching
// win the cost discussion assumed for roleplay generally. What IS
// genuinely cacheable here: the full built system prompt (persona,
// scenario, grounding) stays byte-identical across every turn within
// one session, since it's built once from the same source data each
// time — a smaller-scale but real win across sequential turns, where
// (unlike parallel calls elsewhere) there's no cache-write-propagation
// race condition to worry about, since each turn only starts once the
// previous one's response has already been received.
//
// BUILD 27 | 2026-08-11
// New file. Handles one exchange in a live roleplay: takes the
// salesperson's message, generates the prospect persona's in-character
// response, and persists both to the conversation log immediately (not
// just at the end — a closed tab mid-conversation shouldn't lose the
// session).
//
// Deliberately does NOT load lmi-context.md as system context here —
// the persona is a business person who has no idea they're being
// engaged with a sales methodology, and giving the model that context
// risks it leaking methodology-awareness into how the character talks,
// breaking realism. lmi-context.md is only used in the separate debrief
// step (roleplay-debrief-background.js), which evaluates the
// salesperson's performance from the outside, after the fact.
//
// This stays a normal, fast synchronous function (one Claude call, no
// parallel sub-calls) — comfortably within Netlify's normal limits, no
// async start/background/poll pattern needed for a single turn.

const { getMemberFromSession, supaGet, supaPatch, callClaude, extractText, buildCacheableSystem, logApiUsage, respond, handleOptions, isInScope } = require('./_lib.js');

function buildPersonaSystemPrompt(scenario, prospectSnapshot, presalesContext, industryContext) {
  const personaLines = scenario.personas.map(p => `- ${p.label}: ${p.role_hint}`).join('\n');
  const multiPersona = scenario.personas.length > 1;

  let groundingBlock;
  if (scenario.mode === 'prospect_tied' && presalesContext) {
    groundingBlock = `REAL CONTEXT (from actual research on this prospect):
Company: ${prospectSnapshot.company_name}
Contact: ${prospectSnapshot.prospect_name || '(unnamed)'}, ${prospectSnapshot.position || '(role unknown)'}

Confirmed Facts:
${presalesContext.confirmed_facts || '(none recorded)'}

Strategy notes (for your own grounding only — you, the persona, don't know this exists; it's context for how you'd realistically think and react):
${presalesContext.ai_output_detailed || '(none)'}`;
  } else if (scenario.mode === 'prospect_tied') {
    groundingBlock = `CONTEXT: Company: ${prospectSnapshot.company_name}. Contact: ${prospectSnapshot.prospect_name || '(unnamed)'}, ${prospectSnapshot.position || '(role unknown)'}. No detailed research exists yet — invent a plausible, specific, internally consistent persona and situation (industry specifics, rough size, likely pressures) consistent only with the company name and role given.`;
  } else {
    groundingBlock = `SCENARIO (as described by the salesperson practicing): ${scenario.scenario_description}

Invent a plausible, SPECIFIC company and persona consistent with this description — a real-sounding name, headcount, location detail, industry specifics, management structure. Stay consistent with whatever you invent for the rest of the conversation.`;
  }

  // Real gap fix: industry_context_id's content previously fed only
  // the debrief step, never the live persona itself — meaning
  // selecting an industry never actually changed how the roleplay
  // character behaved during the conversation, only how it got scored
  // afterward. This is deliberately framed as grounding for the
  // PERSONA'S OWN world (what problems, buyer types, and business
  // situations are realistic for someone like this), never as
  // methodology guidance — the character must never become aware it's
  // "supposed to" raise certain problems or represent a certain buyer
  // type; it should simply BE a realistic person from that world.
  const industryBlock = industryContext
    ? `\n\nINDUSTRY GROUNDING (use this to make your character's business situation, priorities, and language authentic and specific to this world — this describes what's realistic for someone like you, not a script to follow. Never reference or acknowledge this information directly; simply BE a person whose business and concerns are genuinely shaped by it):\n${industryContext}`
    : '';

  const difficultyBlock = scenario.difficulty === 'tough'
    ? `DIFFICULTY: Tough. Raise real objections. Be genuinely skeptical of vague claims — push for specifics. Don't make this easy; a competent salesperson should have to work for genuine progress. Still realistic, not cartoonishly hostile.`
    : `DIFFICULTY: Supportive. Curious and generally open, but still a real, busy person — don't just agree with everything; ask reasonable questions, but don't manufacture resistance either.`;

  return `You are role-playing a live sales meeting for practice purposes. You play the PROSPECT side of the conversation — the salesperson practicing is a real person typing real messages to you.

${groundingBlock}${industryBlock}

PERSONA(S) YOU ARE PLAYING:
${personaLines}

${difficultyBlock}

HOW TO RESPOND:
- Stay fully in character. Respond the way a real, busy business person in this role actually would — natural language, specific details, realistic hesitation or interest, not a scripted textbook answer.
${multiPersona ? `- Multiple personas are present. Label each persona's lines clearly, e.g. "(${scenario.personas[0].label}) ..." — they may have different priorities and can genuinely disagree with each other in the room.` : ''}
- You do not know anything about sales methodology, SPIN, or being "sold to" using a framework — you are just a person in a business conversation. Never reference or acknowledge any sales technique.
- Very occasionally — roughly once every 3-4 exchanges, or at a genuine turning point in the conversation, never every single turn — you may add ONE brief coaching aside in *italics inside parentheses*, e.g. "(You're approaching a Need-Payoff moment here — what would make the value concrete for them?)". Most turns should have NO such aside at all, just your in-character reply. Keep these rare and light so they don't overwhelm the roleplay.
- Never break character to evaluate or give feedback on the salesperson's performance mid-conversation — that only happens in a separate debrief afterward, not here.
- Keep responses a realistic length for spoken conversation — a paragraph or two, not an essay.`;
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

  const { session_token, report_id, message } = payload;

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }
    if (!report_id || !message || !message.trim()) {
      return respond(400, { ok: false, message: 'report_id and a non-empty message are required.' });
    }

    const rows = await supaGet(`reports?id=eq.${report_id}&select=*`);
    if (!rows.length) {
      return respond(404, { ok: false, message: 'Roleplay session not found.' });
    }
    const report = rows[0];
    if (!isInScope(member, report)) {
      return respond(403, { ok: false, message: 'Not authorized.' });
    }

    const scenario = report.structured_data?.scenario;
    if (!scenario) {
      return respond(400, { ok: false, message: 'This report has no scenario setup — cannot continue the conversation.' });
    }

    let presalesContext = null;
    if (scenario.mode === 'prospect_tied' && report.prospect_id) {
      const latestPresales = await supaGet(
        `reports?prospect_id=eq.${report.prospect_id}&report_type=eq.presales_prep&status=eq.complete&select=confirmed_facts,ai_output_detailed&order=created_at.desc&limit=1`
      );
      if (latestPresales.length) presalesContext = latestPresales[0];
    }

    // Real gap fix: industry_context_id previously never reached this
    // function at all — only the debrief step used it. Fetched the
    // same way presales-generate-background.js/meeting-analysis-
    // background.js already do, so a Non-LMI user with an industry
    // selected now gets a persona actually grounded in that industry's
    // real buyer types and business situations, not just scored
    // against them after the fact.
    let industryContext = null;
    if (member.user_segment === 'non_lmi' && member.industry_context_id) {
      try {
        const industryRows = await supaGet(`industry_contexts?id=eq.${member.industry_context_id}&select=context_content`);
        if (industryRows.length) industryContext = industryRows[0].context_content;
      } catch (e) {
        // A failed lookup shouldn't block the roleplay turn — proceed
        // without industry grounding rather than failing the whole call.
      }
    }

    const systemPrompt = buildPersonaSystemPrompt(scenario, report.structured_data?.prospect_snapshot, presalesContext, industryContext);

    const existingConversation = report.conversation || [];
    const claudeMessages = existingConversation.map(turn => ({
      role: turn.speaker === 'user' ? 'user' : 'assistant',
      content: turn.content
    }));
    claudeMessages.push({ role: 'user', content: message });

    const res = await callClaude({
      system: buildCacheableSystem(systemPrompt),
      messages: claudeMessages,
      max_tokens: 800
    });
    await logApiUsage({ member_id: member.id, report_id, function_name: 'roleplay-turn', action: 'live_turn', model: res.model, claudeResponse: res });
    const aiResponse = extractText(res);

    const now = new Date().toISOString();
    const updatedConversation = [
      ...existingConversation,
      { speaker: 'user', content: message, at: now },
      { speaker: 'ai', content: aiResponse, at: now }
    ];

    await supaPatch(`reports?id=eq.${report_id}`, { conversation: updatedConversation });

    return respond(200, { ok: true, response: aiResponse, conversation: updatedConversation });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
