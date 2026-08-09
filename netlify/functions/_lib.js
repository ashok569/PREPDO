// PREPDO — _lib.js
// BUILD 3 | 2026-08-07
// Changed this build: added getMemberFromSession() auth helper; added
// callClaude()/extractText() for the Anthropic API; error messages now
// name the specific missing env var instead of failing silently.

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
// the Presales Prep research step). Returns the raw API response.
async function callClaude({ system, messages, tools, max_tokens = 4096 }) {
  checkEnvVars('ANTHROPIC_API_KEY');
  const body = { model: 'claude-sonnet-4-6', max_tokens, messages };
  if (system) body.system = system;
  if (tools) body.tools = tools;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

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
  supaGet, supaPost, supaPatch,
  generateToken, hashToken,
  respond, handleOptions,
  computeSubscriptionFields,
  getMemberFromSession,
  callClaude, extractText
};
