// PREPDO — roleplay-start.js
// BUILD 27 | 2026-08-11
// New file. Creates the report row (report_type: 'role_play', status
// 'complete' from the start — unlike Presales Prep/Meeting Analysis,
// there's no long background job here; each turn is fast enough to be
// synchronous, so 'pending' status doesn't apply the same way. Only
// the DEBRIEF step gets the async treatment, in roleplay-debrief-
// start.js / roleplay-debrief-background.js).
//
// Two modes:
//   - standalone: scenario_description is a free-text prompt (e.g.
//     "SPIN roleplay with a 100cr manufacturing company in Gurgaon"),
//     same style as prior ChatGPT usage — the AI invents the specific
//     company/persona details itself, grounded only by that prompt.
//   - prospect_tied: pulls the prospect's real Confirmed Facts and
//     Strategy from their latest Presales Prep report (if one exists),
//     so the AI plays that actual contact using their real situation.
//
// Returns an opening "scene ready" message — NOT a full AI turn in
// character. The salesperson (the actual user) opens the conversation
// themselves, same pattern as both reference roleplay transcripts this
// was designed from.

const { getMemberFromSession, supaPost, supaGet, respond, handleOptions } = require('./_lib.js');

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

  const { session_token, prospect_id, scenario } = payload;
  // scenario: { mode, scenario_description, difficulty, personas: [{label, role_hint}] }

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }
    if (!scenario || !scenario.mode || !scenario.difficulty || !scenario.personas || !scenario.personas.length) {
      return respond(400, { ok: false, message: 'A complete scenario setup is required.' });
    }
    if (scenario.mode === 'standalone' && !scenario.scenario_description) {
      return respond(400, { ok: false, message: 'Describe the scenario (company type, size, situation) to start a standalone roleplay.' });
    }
    if (scenario.mode === 'prospect_tied' && !prospect_id) {
      return respond(400, { ok: false, message: 'prospect_id required for a prospect-tied roleplay.' });
    }

    let prospectContext = null;
    let presalesContext = null;

    if (scenario.mode === 'prospect_tied') {
      const prospects = await supaGet(`prospects?id=eq.${prospect_id}&select=*`);
      if (!prospects.length) {
        return respond(404, { ok: false, message: 'Prospect not found.' });
      }
      prospectContext = prospects[0];

      const latestPresales = await supaGet(
        `reports?prospect_id=eq.${prospect_id}&report_type=eq.presales_prep&status=eq.complete&select=confirmed_facts,ai_output_detailed&order=created_at.desc&limit=1`
      );
      if (latestPresales.length) {
        presalesContext = latestPresales[0];
      }
    }

    const [report] = await supaPost('reports', {
      prospect_id: prospect_id || null,
      owner_id: member.id,
      report_type: 'role_play',
      status: 'complete', // the conversation itself has no "generation" step to wait on
      structured_data: {
        scenario,
        prospect_snapshot: prospectContext ? {
          company_name: prospectContext.company_name,
          prospect_name: prospectContext.prospect_name,
          position: prospectContext.position
        } : null,
        had_presales_context: !!presalesContext
      },
      conversation: []
    });

    // A short, honest "scene ready" message — not an in-character line.
    // The salesperson opens the meeting themselves, matching how both
    // reference transcripts actually began.
    const personaNames = scenario.personas.map(p => p.label).join(' and ');
    const groundingNote = presalesContext
      ? ` This roleplay is grounded in ${prospectContext.company_name}'s real Presales Prep facts and Strategy — the AI will play ${prospectContext.prospect_name || 'the contact'} consistently with what's already been researched.`
      : scenario.mode === 'prospect_tied'
      ? ` No completed Presales Prep exists yet for ${prospectContext.company_name}, so the AI will improvise a plausible persona for ${prospectContext.prospect_name || 'the contact'} based only on what's in their prospect record.`
      : ' The AI will invent a plausible company and persona based on your scenario description.';

    const sceneReadyMessage = `Scene is set — you're meeting with ${personaNames}.${groundingNote} Open the conversation whenever you're ready (e.g. your opening Situation Question).`;

    return respond(200, {
      ok: true,
      report_id: report.id,
      scene_ready_message: sceneReadyMessage
    });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
