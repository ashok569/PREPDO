// PREPDO — activate.js
// BUILD 3 | 2026-08-07 (carried over unchanged from Build 2)
// Build 2 added: proper try/catch error handling (was crashing with a
// silent 502 before), CORS headers, OPTIONS support.

// /netlify/functions/activate.js
//
// Called when someone clicks their activation link. Validates the token
// against the stored hash, checks expiry and single-use, creates the
// team_members row, starts the subscription clock, and issues a
// returning-visit session token.

const { supaGet, supaPost, supaPatch, generateToken, hashToken, respond, handleOptions, computeSubscriptionFields } = require('./_lib.js');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') {
    return respond(405, { ok: false, message: 'Method Not Allowed' });
  }

  let token;
  try {
    ({ token } = JSON.parse(event.body));
  } catch (e) {
    return respond(400, { ok: false, message: 'Invalid request.' });
  }

  if (!token) {
    return respond(400, { ok: false, message: 'Activation token required.' });
  }

  try {
    const token_hash = hashToken(token);

    const matches = await supaGet(`invites?token_hash=eq.${token_hash}&select=*`);
    if (matches.length === 0) {
      return respond(200, { ok: false, message: 'This activation link is not valid. Ask your admin to invite you again.' });
    }

    const invite = matches[0];

    if (invite.status === 'activated') {
      return respond(200, { ok: false, message: 'This link has already been used. Use "Email me a login link" instead.' });
    }

    if (invite.status === 'revoked') {
      return respond(200, { ok: false, message: 'This invite has been revoked. Contact your admin.' });
    }

    if (new Date(invite.expires_at) < new Date()) {
      await supaPatch(`invites?id=eq.${invite.id}`, { status: 'expired' });
      return respond(200, { ok: false, message: 'This activation link has expired. Ask your admin to invite you again.' });
    }

    const sessionToken = generateToken();
    const sessionExpiry = new Date();
    sessionExpiry.setDate(sessionExpiry.getDate() + 30);

    const subscriptionFields = computeSubscriptionFields('trial');

    const [member] = await supaPost('team_members', {
      invite_id: invite.id,
      email: invite.email,
      key_type: invite.key_type,
      name: invite.name,
      session_token_hash: hashToken(sessionToken),
      session_expires_at: sessionExpiry.toISOString(),
      last_login: new Date().toISOString(),
      ...subscriptionFields
    });

    await supaPatch(`invites?id=eq.${invite.id}`, {
      status: 'activated',
      activated_at: new Date().toISOString()
    });

    return respond(200, {
      ok: true,
      session_token: sessionToken,
      name: member.name,
      role: member.key_type
    });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
