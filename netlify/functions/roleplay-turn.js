// PREPDO — roleplay-turn.js
// BUILD 32 | 2026-09-28
// Each message exchanged now charges PRICES.roleplay_turn credits (0.1 for now)
// AFTER the reply has been generated. BETA RULE: allowNegative — a session that
// has started is always allowed to finish, so a turn may take the balance
// slightly below zero (a new roleplay is then refused until topped up). The
// charge is best-effort: a failed charge is logged but never breaks the turn.
// Difficulty / language / industry logic unchanged from Build 31.
//
// BUILD 31 | 2026-09-24
// Three difficulty levels and an English-only option.
//   supportive (shown as "Friendly")    — cooperative and open.
//   tough      (shown as "Challenging") — pushes back: objections AND stalls.
//   reserved   (NEW)                    — guarded; volunteers nothing, opens up
//                                         only to good discovery questions. It
//                                         resists disclosure, not the sale — no
//                                         stalls or objections — so it trains
//                                         one skill: drawing information out.
// Stored values are unchanged (supportive/tough), so existing sessions and
// history keep working; only the labels changed. The difficulty text
// explicitly OVERRIDES industry guidance about how forthcoming to be — the
// KBR entry tells the persona to volunteer things freely (trusted colleague),
// which would otherwise contradict Reserved.
// English-only (a standing Settings preference, team_members.english_only):
// ON  -> always standard business English whatever the salesperson types, no
//        regional/local-language words or honorifics.
// OFF -> follows the salesperson's own language (plain English in -> plain
//        English out; Swedish in -> Swedish out; a mix in -> a mix out).
// Also folds in Build 30 (industry grounding for the persona): industry_context_id
// content previously reached only the debrief, never the live persona.
//
// BUILD 30 | 2026-09-11
// Industry context (from industry_contexts) now grounds the live persona as
// the persona's OWN world (realistic buyer types/problems), never as
// methodology it is aware of.
//
// BUILD 29 | 2026-09-06
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

const { charge } = require('./_access.js');
const { getMemberFromSession, supaGet, supaPatch, callClaude, extractText, buildCacheableSystem, logApiUsage, respond, handleOptions, isInScope } = require('./_lib.js');

const DIFFICULTY_BLOCKS = {
  supportive: `DIFFICULTY: Friendly. You are cooperative and genuinely open — glad to talk, you answer questions willingly and volunteer relevant context. You are still a real, busy person: you don't just agree with everything, you ask reasonable questions, and you don't invent resistance either.`,
  tough: `DIFFICULTY: Challenging. You are willing to talk but you push back. Raise real objections and stalls the way busy decision-makers actually do — for example "send me something and I'll take a look", "we're not looking at this right now", "we already have something for that", "I'd need to run it by others", "call me next quarter". Don't accept vague claims; ask for specifics, examples and proof. Yield genuine ground only when the salesperson earns it with a specific, well-handled answer. Stay realistic, never cartoonishly hostile — you still share information when asked good questions; the resistance is to being pitched or pushed, not to conversation.`,
  reserved: `DIFFICULTY: Reserved. You are civil but guarded, and you do not volunteer information. Answer what is asked, briefly — usually one or two sentences — and stop. Do not add context, problems, numbers or names unprompted. Closed questions get short answers, generic or textbook questions get generic answers, and premature pitching gets a polite, non-committal reply. Information opens up gradually and only in response to good discovery: a specific open question that builds on what you just said earns a fuller, more useful answer, and a follow-up that probes consequences or numbers earns the real detail. You do not raise stalls or objections — your reserve is about disclosure, not about resisting a sale. If the salesperson asks weak questions throughout, they simply learn little; but you never become artificially unhelpful once genuinely good questions are asked.
This setting governs how forthcoming you are and takes precedence over any industry guidance suggesting you should volunteer things freely: even a trusted colleague can be guarded about a particular subject — busy, preoccupied, or wary of exposing a problem — until the conversation makes it safe to open up.`
};

function buildPersonaSystemPrompt(scenario, prospectSnapshot, presalesContext, industryContext, englishOnly) {
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

  // Industry grounding: the persona's OWN world (buyer types, situations,
  // problems for someone like this) — never methodology it is aware of.
  const industryBlock = industryContext
    ? `\n\nINDUSTRY GROUNDING (use this to make your character's business situation, priorities, and language authentic and specific to this world — this describes what's realistic for someone like you, not a script to follow. Never reference or acknowledge this information directly; simply BE a person whose business and concerns are genuinely shaped by it):\n${industryContext}`
    : '';

  const difficultyBlock = DIFFICULTY_BLOCKS[scenario.difficulty] || DIFFICULTY_BLOCKS.supportive;

  const languageRule = englishOnly
    ? `- LANGUAGE: Always reply in standard, professional business English, whatever language or mix of languages the salesperson writes in. Use no words or phrases from any other language — no regional or local-language words, greetings, honorifics or terms of address (such as "Bhai" or "ji"); address and refer to people by their names exactly as written.`
    : `- LANGUAGE: Follow the salesperson's own language and register. If they write in plain English, reply in plain English — do not add regional or local-language words, greetings or honorifics of your own. If they write in another language, or mix languages, reply the same way.`;

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
${languageRule}
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

    // Industry grounding — only for a B2B user with an industry set.
    let industryContext = null;
    if (member.user_segment === 'non_lmi' && member.industry_context_id) {
      try {
        const industryRows = await supaGet(`industry_contexts?id=eq.${member.industry_context_id}&select=context_content`);
        if (industryRows.length) industryContext = industryRows[0].context_content;
      } catch (e) {
        // A failed lookup shouldn't block the turn — proceed without grounding.
      }
    }

    const systemPrompt = buildPersonaSystemPrompt(scenario, report.structured_data?.prospect_snapshot, presalesContext, industryContext, !!member.english_only);

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
    try {
      await charge(member, 'roleplay_turn', { allowNegative: true, reportId: report_id });
    } catch (chargeErr) {
      console.error('roleplay-turn charge failed (non-fatal):', chargeErr.message);
    }
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
