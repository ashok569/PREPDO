// PREPDO — roleplay-turn.js
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

const { getMemberFromSession, supaGet, supaPatch, callClaude, extractText, respond, handleOptions } = require('./_lib.js');

function buildPersonaSystemPrompt(scenario, prospectSnapshot, presalesContext) {
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

  const difficultyBlock = scenario.difficulty === 'tough'
    ? `DIFFICULTY: Tough. Raise real objections. Be genuinely skeptical of vague claims — push for specifics. Don't make this easy; a competent salesperson should have to work for genuine progress. Still realistic, not cartoonishly hostile.`
    : `DIFFICULTY: Supportive. Curious and generally open, but still a real, busy person — don't just agree with everything; ask reasonable questions, but don't manufacture resistance either.`;

  return `You are role-playing a live sales meeting for practice purposes. You play the PROSPECT side of the conversation — the salesperson practicing is a real person typing real messages to you.

${groundingBlock}

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
    if (member.key_type !== 'admin' && report.owner_id !== member.id) {
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

    const systemPrompt = buildPersonaSystemPrompt(scenario, report.structured_data?.prospect_snapshot, presalesContext);

    const existingConversation = report.conversation || [];
    const claudeMessages = existingConversation.map(turn => ({
      role: turn.speaker === 'user' ? 'user' : 'assistant',
      content: turn.content
    }));
    claudeMessages.push({ role: 'user', content: message });

    const res = await callClaude({
      system: systemPrompt,
      messages: claudeMessages,
      max_tokens: 800
    });
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
