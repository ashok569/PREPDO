// PREPDO — redeem-setup-token.js
// BUILD 1 | 2026-09-11
// New file. Real UX fix per direct feedback: admin-user-setup.js
// originally told a brand-new user to open DevTools Console and run a
// raw JS command — a genuinely bad first experience for someone who
// isn't a developer. This replaces that with two friendlier paths,
// both landing here:
//   1. A clickable URL (index.html?setup_token=<token>) — the new
//      user clicks it, confirms their email on a simple screen, done.
//   2. A manual fallback form (email + token typed in directly) — for
//      when the link doesn't come through cleanly (pasted via a
//      channel that mangles URLs, read aloud over a call, etc.).
// Both call this same endpoint. No session_token required to call
// this — that's the whole point, the person isn't logged in yet.
//
// Requiring the email as well as the token (not just the token alone)
// is a deliberate, real security improvement: a token, once known, is
// otherwise fully equivalent to an active session — binding it to a
// matching email means someone who merely intercepts the link (email
// forwarded to the wrong person, a shared screen, etc.) without also
// knowing who it was actually issued to can't complete redemption.
//
// Doesn't create a NEW token — the setup_token IS already the real
// session token issued by admin-user-setup.js (session_token_hash was
// set at creation time). This just validates the email/token pair
// actually match before handing the token back for the frontend to
// store — the validation is the value-add, not a new credential.

const { supaGet, hashToken, respond, handleOptions } = require('./_lib.js');

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

  const { email, token } = payload;
  if (!email || !email.trim() || !token) {
    return respond(400, { ok: false, message: 'Email and token are both required.' });
  }

  try {
    const tokenHash = hashToken(token);
    const rows = await supaGet(
      `team_members?email=eq.${encodeURIComponent(email.trim())}&session_token_hash=eq.${tokenHash}&select=id,email,is_active,session_expires_at`
    );

    if (!rows.length) {
      return respond(400, { ok: false, message: 'That email and token don\'t match. Double-check both, or ask whoever set up your account for a fresh link.' });
    }

    const account = rows[0];
    if (!account.is_active) {
      return respond(403, { ok: false, message: 'This account has been deactivated. Contact your admin.' });
    }
    if (new Date(account.session_expires_at) < new Date()) {
      return respond(400, { ok: false, message: 'This access token has expired. Ask your admin for a fresh one.' });
    }

    // The token itself is what the frontend should store — confirming
    // the match is the point, not minting something new.
    return respond(200, { ok: true, session_token: token });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
