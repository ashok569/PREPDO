// PREPDO — _lib.js
// BUILD 16 | 2026-08-10
// Added a 90s timeout to callClaude() — now that generation runs in a
// Background Function (no more 30s ceiling), a hung Anthropic API call
// had nothing to catch it, and could leave a report stuck at 'pending'
// indefinitely with zero explanation. Now fails visibly and quickly
// instead, letting the calling function's own error handling take over.

// /netlify/functions/_lib.js
//
// Shared helpers — auth/session validation, Supabase REST calls, and
// the Anthropic (Claude) API caller used by the Presales Prep functions.
// Not deployed as its own endpoint — required by the other functions.

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function supaHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

function checkEnvVars(...names) {
  const vals = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SUPABASE_KEY, ANTHROPIC_API_KEY };
  const missing = names.filter((n) => !vals[n]);
  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}. Check Netlify Site settings → Environment variables, and confirm a deploy has run since they were added.`);
  }
}

async function supaGet(path) {
  checkEnvVars('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: supaHeaders() });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase GET ${path} failed: ${res.status} ${detail}`);
  }
  return res.json();
}

async function supaPost(path, body) {
  checkEnvVars('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: supaHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase POST ${path} failed: ${res.status} ${detail}`);
  }
  return res.json();
}

async function supaPatch(path, body) {
  checkEnvVars('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: supaHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase PATCH ${path} failed: ${res.status} ${detail}`);
  }
  return res.json();
}

async function supaDelete(path) {
  checkEnvVars('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: supaHeaders({ Prefer: 'return=representation' })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase DELETE ${path} failed: ${res.status} ${detail}`);
  }
  return res.json();
}

function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify(body)
  };
}

function handleOptions() {
  return { statusCode: 204, headers: CORS_HEADERS, body: '' };
}

function computeSubscriptionFields(subscriptionType) {
  const now = new Date();
  const expiry = new Date(now);
  if (subscriptionType === 'paid') {
    expiry.setFullYear(expiry.getFullYear() + 1);
  } else {
    expiry.setMonth(expiry.getMonth() + 3);
  }
  return {
    first_login_at: now.toISOString(),
    subscription_start_date: now.toISOString().slice(0, 10),
    subscription_expiry_date: expiry.toISOString().slice(0, 10),
    subscription_status: 'active'
  };
}

// Looks up which team_members row a session token belongs to, checking
// expiry. Returns null (not an error) if the session isn't valid — every
// function that needs a logged-in user should check for null and respond
// with a clear "please log in again" message.
async function getMemberFromSession(session_token) {
  if (!session_token) return null;
  const token_hash = hashToken(session_token);
  const matches = await supaGet(`team_members?session_token_hash=eq.${token_hash}&select=*`);
  if (matches.length === 0) return null;
  const member = matches[0];
  if (new Date(member.session_expires_at) < new Date()) return null;
  return member;
}

// Calls the Anthropic API. `tools` is optional (used for web search in
// the Presales Prep research step). `model` defaults to Sonnet but can
// be overridden (e.g. Haiku for the fast research step, where search
// quality — not model reasoning depth — is what actually matters).
async function callClaude({ system, messages, tools, max_tokens = 4096, model = 'claude-sonnet-4-6', timeoutMs = 90000 }) {
  checkEnvVars('ANTHROPIC_API_KEY');
  const body = { model, max_tokens, messages };
  if (system) body.system = system;
  if (tools) body.tools = tools;

  // Now that generation happens in a Background Function (no more 30s
  // ceiling), a hung request to Anthropic's API had no safeguard at
  // all — it could sit unresolved for a very long time with nothing to
  // catch it, leaving a report stuck at 'pending' with no explanation.
  // This bounds any single call to a sane maximum so it fails visibly
  // instead (caught by the calling function's own try/catch, which
  // already marks that section as failed without losing the others).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Anthropic API call timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic API failed: ${res.status} ${detail}`);
  }
  return res.json();
}

// Pulls just the plain-text content out of a Claude API response,
// ignoring tool_use/tool_result/server_tool_use blocks (relevant when
// web search was used) — this is the actual generated text.
function extractText(claudeResponse) {
  return (claudeResponse.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

module.exports = {
  supaGet, supaPost, supaPatch, supaDelete,
  generateToken, hashToken,
  respond, handleOptions,
  computeSubscriptionFields,
  getMemberFromSession,
  callClaude, extractText
};
