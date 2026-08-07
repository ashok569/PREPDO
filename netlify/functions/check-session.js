// /netlify/functions/check-session.js
//
// Called on every app load to validate a stored session token (from
// localStorage) and confirm the person is still a valid, non-expired
// member. Also handles the "login-with-link" case (a freshly emailed
// session token being used for the first time on a new device).

const { supaGet, supaPatch, hashToken, respond, handleOptions } = require('./_lib.js');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') {
    return respond(405, { ok: false, message: 'Method Not Allowed' });
  }

  let session_token;
  try {
    ({ session_token } = JSON.parse(event.body));
  } catch (e) {
    return respond(400, { ok: false, message: 'Invalid request.' });
  }

  if (!session_token) {
    return respond(400, { ok: false, message: 'Session token required.' });
  }

  try {
    const token_hash = hashToken(session_token);
    const matches = await supaGet(`team_members?session_token_hash=eq.${token_hash}&select=*`);

    if (matches.length === 0) {
      return respond(200, { ok: false, message: 'Session not recognized. Please log in again.' });
    }

    const member = matches[0];

    if (new Date(member.session_expires_at) < new Date()) {
      return respond(200, { ok: false, message: 'Session expired. Please request a new login link.' });
    }

    await supaPatch(`team_members?id=eq.${member.id}`, { last_login: new Date().toISOString() });

    return respond(200, {
      ok: true,
      name: member.name,
      role: member.key_type,
      subscription_status: member.subscription_status
    });
  } catch (err) {
    // Surfaces the real error instead of letting the function crash with
    // an unhandled exception (which Netlify reports as an opaque 502).
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
