// /netlify/functions/request-login-link.js
//
// Self-serve re-entry for someone who's already activated but lost their
// session (cleared browser storage, new device, etc). Reuses the same
// token/hash mechanism as invites, but only for people who already have
// a team_members row — this is NOT how new people get in, only a "log
// me back in" path for existing members.

const { supaGet, supaPatch, generateToken, hashToken, respond } = require('./_lib.js');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return respond(405, { ok: false, message: 'Method Not Allowed' });
  }

  let email;
  try {
    ({ email } = JSON.parse(event.body));
  } catch (e) {
    return respond(400, { ok: false, message: 'Invalid request.' });
  }

  if (!email) {
    return respond(400, { ok: false, message: 'Email required.' });
  }

  const matches = await supaGet(`team_members?email=eq.${email.toLowerCase().trim()}&select=*`);

  // Deliberately vague response whether or not the email matches, so this
  // endpoint can't be used to check who is/isn't a PREPDO user.
  const genericMessage = 'If that email is registered, a login link has been sent.';

  if (matches.length === 0) {
    return respond(200, { ok: true, message: genericMessage });
  }

  const member = matches[0];
  const sessionToken = generateToken();
  const sessionExpiry = new Date();
  sessionExpiry.setDate(sessionExpiry.getDate() + 30);

  await supaPatch(`team_members?id=eq.${member.id}`, {
    session_token_hash: hashToken(sessionToken),
    session_expires_at: sessionExpiry.toISOString()
  });

  const loginLink = `${process.env.APP_BASE_URL}/?login=${sessionToken}`;

  // Same Brevo pattern as invite.js — send if configured, otherwise return
  // the link directly for manual testing.
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  let emailResult = { sent: false, reason: 'BREVO_API_KEY not configured', loginLink };

  if (BREVO_API_KEY) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'PREPDO Team', email: 'noreply@lmi-india.in' },
        to: [{ email: member.email, name: member.name }],
        subject: 'Your PREPDO login link',
        htmlContent: `<p>Hi ${member.name},</p><p>Click below to log in to PREPDO:</p><p><a href="${loginLink}">${loginLink}</a></p><p>This link expires in 30 days or your next login, whichever comes first.</p>`
      })
    });
    emailResult = { sent: res.ok };
  }

  return respond(200, { ok: true, message: genericMessage, _debug: emailResult });
};
