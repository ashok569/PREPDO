// /netlify/functions/_lib.js
//
// Shared helpers for the invite/activation/session system.
// Not deployed as its own endpoint — required by the other functions.

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// CORS headers applied to every response, so this can be called from
// tools/pages hosted somewhere other than the main site (e.g. a local
// bootstrap/debug page opened as a file), not just same-origin requests.
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

// Fails loudly and clearly if the env vars themselves are missing, rather
// than letting every call fail with a confusing generic error later.
function checkEnvVars() {
  const missing = [];
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}. Check Netlify Site settings → Environment variables, and confirm a deploy has run since they were added.`);
  }
}

async function supaGet(path) {
  checkEnvVars();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: supaHeaders() });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase GET ${path} failed: ${res.status} ${detail}`);
  }
  return res.json();
}

async function supaPost(path, body) {
  checkEnvVars();
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
  checkEnvVars();
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

// Generates a random URL-safe token. Only its hash is ever stored.
function generateToken() {
  return crypto.randomBytes(32).toString('base64url'); // 43 chars, URL-safe
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

// A handler for CORS preflight OPTIONS requests — browsers send these
// automatically before certain cross-origin POST requests. Each function
// should return this immediately when it sees an OPTIONS request.
function handleOptions() {
  return { statusCode: 204, headers: CORS_HEADERS, body: '' };
}

// Computes subscription_start_date / subscription_expiry_date / status
// for a first activation, matching the trial=3mo / paid=1yr rule.
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

module.exports = {
  supaGet, supaPost, supaPatch,
  generateToken, hashToken,
  respond, handleOptions,
  computeSubscriptionFields
};
