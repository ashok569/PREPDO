// PREPDO — prospects.js
// BUILD 3 | 2026-08-07
// New file this build: list/create/get for Prospects, scoped to the
// logged-in owner (admins see everyone's). First feature built on top
// of the Build 2 auth system.

// /netlify/functions/prospects.js
//
// Handles Prospects: list (filtered to the logged-in user, or all for
// admins), create, and get-one (with its report history).
//
// Request body always includes { session_token, action, ...fields }

const { getMemberFromSession, supaGet, supaPost, respond, handleOptions } = require('./_lib.js');

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

  const { session_token, action } = payload;

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }

    if (action === 'list') {
      const scope = member.key_type === 'admin' ? '' : `&owner_id=eq.${member.id}`;
      const rows = await supaGet(`prospects?select=*${scope}&order=created_at.desc`);
      return respond(200, { ok: true, prospects: rows });
    }

    if (action === 'create') {
      const { company_name, company_website, prospect_name, linkedin_url, position, meeting_objective, notes } = payload;
      if (!company_name) {
        return respond(400, { ok: false, message: 'Company name is required.' });
      }
      const [row] = await supaPost('prospects', {
        owner_id: member.id,
        company_name,
        company_website: company_website || null,
        prospect_name: prospect_name || null,
        linkedin_url: linkedin_url || null,
        position: position || null,
        meeting_objective: meeting_objective || null,
        notes: notes || null
      });
      return respond(200, { ok: true, prospect: row });
    }

    if (action === 'get') {
      const { prospect_id } = payload;
      if (!prospect_id) return respond(400, { ok: false, message: 'prospect_id required.' });

      const rows = await supaGet(`prospects?id=eq.${prospect_id}&select=*`);
      if (!rows.length) return respond(404, { ok: false, message: 'Prospect not found.' });

      const reports = await supaGet(`reports?prospect_id=eq.${prospect_id}&select=*&order=created_at.desc`);
      return respond(200, { ok: true, prospect: rows[0], reports });
    }

    return respond(400, { ok: false, message: 'Unknown action: ' + action });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
