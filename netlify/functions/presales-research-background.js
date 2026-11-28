// PREPDO — presales-research-background.js
// CURRENT VERSION: BUILD 92b (28 Nov 2026). Newest entry first below.
// BUILD 92b | 2026-11-28: THE 'SOMETHING SPECIFIC YOU NEED RESEARCHED' BOX NOW WORKS. It was stored and passed here but
// never read (the promised 13th topic was never built), so it was silently dropped. It now runs as its own research step
// after the 12 topics: answers exactly what was asked, about whoever is named (not forced onto the prospect company),
// confirms identity from at least two sources, keeps to professional/public business facts, checks the named party's link
// to the prospect, treats anything the salesperson typed as a lead to verify, and ALWAYS appears in the facts as
// "Your specific question: ...", with findings or "nothing found". It never counts toward the not-enough-data rule.
// BUILD 92 | 2026-11-27: FILING CHECK. When the company number (CIN) is known, the company is unlisted (CIN starts
// with U) and the registry topic did NOT return real filing or financial facts, the function opens the company's
// public summary page on Zauba Corp and Tofler (by CIN), checks the page really shows that CIN, and has the page text
// read into: status, last AGM, last balance sheet filed, paid-up capital. Three outcomes only: CURRENT (filings seen
// and up to date), CAUTION (the page itself shows non-compliant / struck off / balance sheet older than 20 months),
// UNCHECKED (could not be read or not shown; says so and never claims a default). A CAUTION is put first in the facts
// and is shown as a banner on the plan. Never run on a retry; it costs one small AI call only when it runs.
// BUILD 91c | 2026-11-27: first live test showed topics that said "Nothing specific found" but wrapped it in a
// long explanation were still shown as sections (and could name other companies such as Groww). Any topic containing
// that sentence is now classed as nothing found and goes into the one "Not found" line. Also tidies stray bullet
// and bracket line breaks left by citations.
// BUILD 91b | 2026-11-27: NOT-ENOUGH-DATA RULE. Each topic is classified: confirmed / nothing found / could not
// verify. The research counts as sufficient only if the company website was actually read OR at least 4 topics are
// confirmed. Otherwise NO report is produced: the run is closed with error_message INSUFFICIENT_DATA, the research
// credits are returned (first 2 such outcomes per prospect per 24 h), and the screen asks the user to re-check the
// website, paste text from it, or write their own facts. Never lists look-alike companies. The website is tried with
// an automatic second attempt (with/without www, https/http). A pasted site text (site_text) counts as the website.
// BUILD 91 | 2026-11-26: WEBSITE FIRST. Before the 12 topics run, the function now opens the company's own
// website itself (home page plus up to 3 About / Contact / policy pages, which is where the registration
// number (CIN) usually sits), reads the text, and writes a short verified company profile from it. That
// profile is the identity anchor for every topic: a search result now counts as this company if it matches
// the legal name, CIN, brand, place or domain read from the site. Each topic gets 2 searches (was 1), and is
// given the CIN found on the site or typed in Notes, plus the typed Notes. If the site cannot be read, the
// facts say so plainly instead of silently returning "could not verify" for everything.
// BUILD 90 | 2026-11-22: writes progress_done / progress_total (migration_v29.sql) as each topic finishes.
// BUILD 2 | 2026-09-11
// Real gap fixed, per direct feedback: a genuinely failed topic
// previously required the USER to click "Retry Failed Topics" as the
// first response to any failure — that should be the last resort, not
// the default. Added an automatic final retry pass here, after both
// batches complete: any topic still marked ok:false gets one more
// full attempt automatically (broadened beyond just 429s — any error
// type gets this second chance), before the user ever sees the
// research result at all. The manual retry button in app.html now
// only appears in the genuinely rare case something is still failing
// after this automatic pass too.
//
// BUILD 1 | 2026-09-11
// New file. Converts the 12-topic research step from synchronous to
// the same async start/background/poll pattern already used
// everywhere else (Presales Prep generation, Meeting Analysis,
// Gleaner, Roleplay Debrief) — a real, needed change once topic count
// grew from 4 to 12, since a single synchronous call waiting on 12
// parallel web-search-backed calls carries real risk of exceeding
// Netlify's synchronous execution ceiling, the same category of risk
// already hit twice today at the token-budget layer, just at the
// transport layer instead.
//
// Two real additions on top of the existing 12-topic logic (unchanged
// from presales-research.js Build 9 — same topics, same identity-
// verification guardrail, same website-parsing):
//
// 1. Batched execution, 6 + 6, not all 12 at once — a deliberate
//    hedge against Anthropic's per-minute request-rate limits (real,
//    tiered, confirmed via direct lookup — not something to assume
//    away). Batch 1 covers the foundational topics; batch 2 the
//    harder-to-find, more specific ones, so the "digging deeper"
//    framing the frontend shows when batch 2 starts is honestly true,
//    not just decorative.
//
// 2. Automatic 429 detection and retry, per topic, with exponential
//    backoff (2s, then 4s) BEFORE a topic is ever marked failed —
//    detected defensively off the error message text rather than an
//    assumed error-object shape, since that's not something this file
//    can verify with certainty. This is the primary defense against
//    rate-limit bursts; batching is the secondary one.
//
// Genuinely failed topics (after retries exhausted) are stored
// individually, tagged ok:false — presales-research.js (repurposed
// into a synchronous 'retry-topics' action) can retry just those,
// merging results back in without touching anything that already
// succeeded. Tested directly: the merge-only-failed-topics logic
// leaves successful topics byte-identical, only replaces what's
// actually being retried.

const { getMemberFromSession, callClaude, extractText, logApiUsage, supaGet, supaPatch, respond, handleOptions } = require('./_lib.js');
const { refund, PRICES } = require('./_access.js');

const TOPICS_BATCH_1 = [
  {
    key: 'news',
    label: 'Recent News & Developments',
    focus: 'recent news, announcements, or press coverage from the last 6-12 months'
  },
  {
    key: 'challenges',
    label: 'Business Challenges & Market Position',
    focus: 'business challenges, financial performance, or market position — anything suggesting where the company is under pressure or losing ground'
  },
  {
    key: 'leadership',
    label: 'Leadership',
    focus: 'leadership team composition, any recent leadership or executive changes, and specifically who is most likely to hold real decision-making authority for a decision like this — name the specific people involved, not just titles, where possible'
  },
  {
    key: 'growth',
    label: 'Growth & Competitive Landscape',
    focus: 'growth plans, expansion, new initiatives, or how the company is positioned against competitors'
  },
  {
    key: 'registry_financials',
    label: 'Corporate Registry & Precise Financials',
    focus: 'corporate registry information and precise financial data for this company. Search specifically on business registry/database sites (Tofler, Tracxn, or similar aggregators for India-based companies; the equivalent registry or financial-data sources for the company\'s own country otherwise). Report both standalone and consolidated figures separately if the company reports both. Prioritize established business publications for the company\'s home market — Economic Times or Business Standard for India-based companies, the leading business publication for other countries'
  },
  {
    key: 'existing_programs',
    label: 'Existing Leadership/L&D Infrastructure',
    focus: 'whether this company already runs named internal leadership-development, management-development, or talent-development programs. Look for specific program names, recent launches, internal academies, or external coaching/assessment partnerships the company has publicly described'
  }
];

const TOPICS_BATCH_2 = [
  {
    key: 'named_gaps',
    label: 'Leadership-Named Execution/Accountability Gaps',
    focus: 'has this company\'s own leadership — in investor calls, leadership events, annual reports, or executive interviews — explicitly named or referenced an internal gap in execution, accountability, delegation, decision-making speed, or managerial capability? Look for the company\'s own language admitting where it falls short internally, distinct from general business or market challenges'
  },
  {
    key: 'named_contact',
    label: 'About the Named Contact',
    focus: 'the specific named contact for this meeting — their own professional background, current role and tenure, public profile, and what their own stated professional focus or current activities suggest about what they might personally care about in this conversation'
  },
  {
    key: 'awards',
    label: 'Awards & External Recognition',
    focus: 'any awards, industry recognition, workplace rankings, or external validation this company or the named contact personally has received in the last 2-3 years — useful for a credible, specific opening'
  },
  {
    key: 'named_customers',
    label: 'Named Customers & Client Relationships',
    focus: 'any named customers, clients, or business relationships this company publicly discloses — particularly useful if any overlap with how this meeting was arranged'
  },
  {
    key: 'operational_pain',
    label: 'Operational & Execution Pain Points',
    focus: 'specific, evidenced signs of operational or execution difficulty — project delays, cost or schedule overruns, quality or delivery issues, customer complaints, or analyst commentary on execution risk. Search for this directly and specifically; do not rely on general impressions from other topics. Sourced, specific evidence matters more than a general characterization'
  },
  {
    key: 'catch_all',
    label: 'Anything Else Worth Knowing',
    focus: 'anything else genuinely useful to know about this company or this specific person before the meeting, not captured by the other research areas above (for example: technical staff who interact directly with customers, where relevant). Stay concrete and specific — say plainly if there\'s nothing further worth adding'
  }
];

const ALL_TOPICS = [...TOPICS_BATCH_1, ...TOPICS_BATCH_2];

function parseWebsites(company_website) {
  if (!company_website) return [];
  return company_website.split(',').map((w) => w.trim()).filter((w) => w.length > 0);
}

// Defensive detection — off the error message text, not an assumed
// error-object shape, since this file can't verify _lib.js's exact
// internals with certainty. Tested directly against 5 realistic
// message variants before shipping.
function is429Error(err) {
  const msg = (err && err.message) || '';
  return /429|rate.?limit|too many requests/i.test(msg);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


// ---------- BUILD 91b: classify what a topic actually returned ----------
const UNVERIFIED_RE = /could not verify information about the specific company/i;
const NOTHING_RE = /nothing specific found on this topic/i;
function cleanTopicText(t) {
  // Drop the model's narration lines ("I'll search for ...") that sit before the facts.
  let out = String(t || '').split('\n').filter((ln) => !/^\s*(I'll|I will|Let me)\s+(search|look|find|check|research)/i.test(ln)).join('\n');
  // Citation markup leaves a bullet alone on its own line, or a bracket on a new line: join them back.
  out = out.replace(/([•\-*])[ \t]*\n+[ \t]*(?=\S)/g, '$1 ').replace(/\n+[ \t]*(?=\()/g, ' ');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
// 'confirmed' | 'nothing' | 'unverified' | 'failed'
function classifyTopic(sec) {
  if (!sec || !sec.ok) return 'failed';
  const t = String(sec.text || '');
  if (UNVERIFIED_RE.test(t)) return 'unverified';
  // The research is told to answer ONLY with that sentence; if it appears at all, the topic has no findings,
  // however much narration surrounds it (the narration is not a finding and may mention other companies).
  if (NOTHING_RE.test(t)) return 'nothing';
  if (t.replace(/\s+/g, ' ').trim().length < 25) return 'nothing';
  return 'confirmed';
}

// ---------- BUILD 91: read the company's own website ----------
const CIN_RE = /\b[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b/g;
const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;

// Only plain public http(s) sites; never localhost, private or internal addresses.
function isSafeSiteUrl(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const h = url.hostname.toLowerCase();
    if (!h.includes('.') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
    if (h.includes(':') || h.startsWith('[')) return false;
    return true;
  } catch (e) { return false; }
}

function normaliseSiteUrl(w) {
  let u = String(w || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return isSafeSiteUrl(u) ? u : null;
}

async function fetchPageHtml(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PREPDO-research/1.0; +https://prepdo.netlify.app)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    const ct = String(res.headers.get('content-type') || '');
    if (ct && !/html|text/i.test(ct)) return { ok: false, error: 'not a web page (' + ct.slice(0, 40) + ')' };
    const raw = await res.text();
    // The final address after redirects, and a safety re-check on it.
    const finalUrl = res.url || url;
    if (!isSafeSiteUrl(finalUrl)) return { ok: false, error: 'redirected to a non-public address' };
    return { ok: true, html: raw.slice(0, 700000), url: finalUrl };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timed out' : String(err.message || err).slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(t) {
  return t
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&copy;/gi, '©')
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(Number(n)); } catch (e) { return ' '; } });
}

function htmlToText(html) {
  let h = String(html || '');
  const title = (h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const desc = (h.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1] || '';
  h = h.replace(/<!--[\s\S]*?-->/g, ' ')
       .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
       .replace(/<\/(p|div|li|tr|h[1-6]|section|footer|header|br)>/gi, '\n')
       .replace(/<br\s*\/?>/gi, '\n')
       .replace(/<[^>]+>/g, ' ');
  h = decodeEntities(h).replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  const head = [title && 'Page title: ' + decodeEntities(title).trim(), desc && 'Description: ' + decodeEntities(desc).trim()].filter(Boolean).join('\n');
  return (head ? head + '\n' : '') + h;
}

function pickSubpages(html, baseUrl, max = 3) {
  let base;
  try { base = new URL(baseUrl); } catch (e) { return []; }
  const found = [];
  const seen = new Set([base.href.replace(/#.*$/, '')]);
  const re = /<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && found.length < 40) {
    const label = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 60);
    let u;
    try { u = new URL(m[1], base); } catch (e) { continue; }
    if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    if (!/^https?:$/.test(u.protocol)) continue;
    if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|css|js)(\?|$)/i.test(u.pathname)) continue;
    const key = u.href.replace(/#.*$/, '');
    if (seen.has(key)) continue;
    const hay = (u.pathname + ' ' + label).toLowerCase();
    // About / contact / who we are / team, and the policy pages where registration numbers often sit.
    const score = /about|story|who-we|our-company|company|team|leadership|director|contact|reach/.test(hay) ? 2
                : /privacy|terms|policy|legal|disclaimer|shipping|refund/.test(hay) ? 1 : 0;
    if (!score) continue;
    seen.add(key);
    found.push({ href: key, score });
  }
  found.sort((a, b) => b.score - a.score);
  return found.slice(0, max).map((f) => f.href);
}

// The address as given, then (automatic second try) with/without www and the other scheme.
function urlVariants(url) {
  const out = [url];
  try {
    const u = new URL(url);
    const bare = u.hostname.replace(/^www\./i, '');
    const alt = u.hostname.toLowerCase().startsWith('www.') ? bare : 'www.' + bare;
    const mk = (scheme, host) => scheme + '//' + host + (u.pathname === '/' ? '/' : u.pathname) + u.search;
    [mk(u.protocol, alt), mk(u.protocol === 'https:' ? 'http:' : 'https:', u.hostname), mk('http:', alt)].forEach((v) => { if (!out.includes(v)) out.push(v); });
  } catch (e) { /* keep the original only */ }
  return out;
}

// Reads one website: home page plus a few likely pages. Never throws.
async function readOneWebsite(rawUrl) {
  const url = normaliseSiteUrl(rawUrl);
  if (!url) return { url: rawUrl, ok: false, error: 'not a usable public web address' };
  let home = null; const errors = [];
  for (const v of urlVariants(url)) {
    if (!isSafeSiteUrl(v)) continue;
    const r = await fetchPageHtml(v, v === url ? 12000 : 8000);
    if (r.ok) { home = r; break; }
    errors.push(r.error);
  }
  if (!home) return { url, ok: false, error: errors[0] || 'could not be opened' };
  const subs = pickSubpages(home.html, home.url, 3);
  const subPages = await Promise.all(subs.map(async (u) => {
    const r = await fetchPageHtml(u, 9000);
    return r.ok ? { url: u, text: htmlToText(r.html) } : null;
  }));
  const pages = [{ url: home.url, text: htmlToText(home.html) }, ...subPages.filter(Boolean)];
  const combined = pages.map((p) => '--- PAGE: ' + p.url + ' ---\n' + p.text.slice(0, 8000)).join('\n\n').slice(0, 24000);
  const plain = pages.map((p) => p.text).join('\n');
  const cins = [...new Set(plain.toUpperCase().match(CIN_RE) || [])];
  const gsts = [...new Set(plain.toUpperCase().match(GSTIN_RE) || [])];
  const readable = plain.replace(/\s+/g, ' ').length;
  return { url, ok: true, pages: pages.map((p) => p.url), text: combined, cins, gsts, readable };
}

// Everything BUILD 91 adds in one call. Returns { siteInfo, usage, model } where siteInfo may be null.
async function buildSiteProfile(websites, company_name, extraText, pastedText) {
  const pasted = String(pastedText || '').trim().slice(0, 20000);
  const typedCins = [...new Set((String(extraText || '') + ' ' + pasted).toUpperCase().match(CIN_RE) || [])];
  if (!websites.length && pasted.length < 200) return { siteInfo: null, note: 'No website was given.', typedCins };
  const reads = await Promise.all(websites.slice(0, 3).map((w) => readOneWebsite(w)));
  const good = reads.filter((r) => r.ok && r.readable > 200);
  if (pasted.length >= 200) {
    // Text the salesperson copied from the website themselves: counts as the website having been read.
    good.push({ url: '(text pasted by the salesperson)', ok: true, pages: ['(text pasted by the salesperson)'], text: '--- PASTED FROM THE WEBSITE ---\n' + pasted, cins: [...new Set(pasted.toUpperCase().match(CIN_RE) || [])], gsts: [...new Set(pasted.toUpperCase().match(GSTIN_RE) || [])], readable: pasted.length });
  }
  if (!good.length) {
    const why = reads.map((r) => `${r.url}: ${r.ok ? 'opened, but almost no readable text (the page may build itself with scripts)' : r.error}`).join('; ');
    return { siteInfo: null, note: 'The website could not be read (' + why + ').', typedCins };
  }
  const cins = [...new Set([...good.flatMap((r) => r.cins), ...typedCins])];
  const sourceText = good.map((r) => r.text).join('\n\n').slice(0, 30000);
  let profile = '';
  let usage = null; let model = null;
  try {
    const res = await callClaude({
      model: 'claude-haiku-4-5-20251001',
      system: `You read the text of a company's own website pages and write a SHORT factual profile of that company, for a salesperson preparing to meet them. Use ONLY what the pages actually say. Never add anything from memory or guess. If something is not on the pages, write "not stated".

Return markdown with exactly these lines:
- **Legal / registered name:** ...
- **Brand / trading name:** ...
- **Registration numbers shown (CIN, GSTIN, etc.):** ...
- **Location / address:** ...
- **What they do / sell:** ... (1-2 sentences)
- **People named, with roles:** ...
- **Certifications, awards, customers or partners named:** ...
- **Contact details shown:** ...
- **Anything else notable on the site:** ... (1 short line)`,
      messages: [{ role: 'user', content: `Company name given by the salesperson: ${company_name}\n\nWebsite text:\n${sourceText}` }],
      max_tokens: 700
    });
    profile = extractText(res) || '';
    usage = res.usage; model = res.model;
  } catch (err) {
    return { siteInfo: null, note: 'The website was opened but its profile could not be written (' + String(err.message || err).slice(0, 80) + ').', typedCins };
  }
  return {
    siteInfo: { profile: profile.trim(), cins, gsts: [...new Set(good.flatMap((r) => r.gsts))], pages: good.flatMap((r) => r.pages) },
    usage, model, typedCins
  };
}


// ---------- BUILD 92b: the salesperson's own specific question ----------
const SPECIFIC_NOTHING_RE = /nothing specific found on this question/i;
async function researchSpecificQuestion(query, company_name, websites, siteInfo, typedNotes, prospect_name, maxRetries = 2) {
  const q = String(query || '').trim().slice(0, 600);
  if (!q) return null;
  const websiteBlock = websites && websites.length ? websites.map((w, i) => `Website ${i + 1}: ${w}`).join('\n') : 'Website: (not provided)';
  const siteBlock = siteInfo && siteInfo.profile ? `\n\nWhat the prospect company's own website says about itself:\n${siteInfo.profile.slice(0, 1500)}` : '';
  const notesBlock = typedNotes ? `\n\nNotes typed by the salesperson (claims to CHECK, not proven facts):\n${String(typedNotes).slice(0, 700)}` : '';
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await callClaude({
        model: 'claude-haiku-4-5-20251001',
        system: `You answer ONE specific question for a salesperson preparing for a meeting, using web search. The question may be about a person, firm or topic OTHER than the prospect company, and may ask how that party is linked to the prospect company.
Rules:
1. Answer exactly what was asked, nothing else.
2. For every named person or firm, confirm WHO they are using at least two independent sources (the firm's own site, a regulator or registry, established business press) before reporting. If several people or firms share the name and you cannot tell which is meant, say only: "Could not tell which <name> is meant - several share this name." Do not guess and do not describe the others.
3. Professional and public business facts only: role, firm, investments, board seats, public statements. Never private life, family, health or personal finances.
4. If the question concerns how the named party relates to the prospect company (shareholder, investor, lender, partner, board seat, funding rounds), check that link specifically. Give dates and amounts only if a source states them.
5. Anything the salesperson typed in their notes or in the question is a lead, not proof. If searches confirm it say "confirmed"; if not, say "The salesperson reports X; not confirmed in public sources."
6. Give 3-6 short bullets, each ending with the source name in brackets. If you find nothing reliable, reply with ONLY: "Nothing specific found on this question."`,
        messages: [{ role: 'user', content: `Prospect company: ${company_name}\n${websiteBlock}${prospect_name ? `\nMeeting contact: ${prospect_name}` : ''}${siteBlock}${notesBlock}\n\nQUESTION TO ANSWER: ${q}` }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        max_tokens: 900
      });
      const text = cleanTopicText(extractText(res));
      const found = !!text && !SPECIFIC_NOTHING_RE.test(text);
      return { query: q, ok: true, found, text: found ? text : '', model: res.model, usage: res.usage };
    } catch (err) {
      lastErr = err;
      if (is429Error(err) && attempt < maxRetries) { await sleep(2000 * Math.pow(2, attempt)); continue; }
      break;
    }
  }
  return { query: q, ok: false, found: false, text: '', error: (lastErr && lastErr.message) || 'Unknown error' };
}
function specificQuestionSection(sq) {
  if (!sq || !sq.query) return '';
  const body = sq.ok
    ? (sq.found ? sq.text : '*No reliable public information was found to answer this question. If you know something about it, add it to this box.*')
    : '*This question could not be researched this time (a technical problem). You can add what you know to this box.*';
  return `### Your specific question: ${sq.query}\n${body}`;
}

// ---------- BUILD 92: filing check from public registry summary pages (by CIN) ----------
const FILING_MARK = '⚠ CAUTION — COMPANY FILINGS';
function slugify(n) {
  return String(n || '').toUpperCase().replace(/\(P\)/g, 'PRIVATE').replace(/\bPVT\b\.?/g, 'PRIVATE').replace(/\bLTD\b\.?/g, 'LIMITED')
    .replace(/&/g, 'AND').replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function legalNameFromProfile(profile) {
  const m = String(profile || '').match(/Legal \/ registered name:\*\*\s*([^\n]+)/i);
  const v = m ? m[1].trim() : '';
  return /not stated/i.test(v) ? '' : v;
}
// Is there already a real filing / financial finding in the registry topic?
function registryHasFilingFacts(sections) {
  const r = (sections || []).find((x) => x.key === 'registry_financials');
  if (!r || classifyTopic(r) !== 'confirmed') return false;
  return /AGM|annual general|balance sheet|annual return|paid.?up|turnover|revenue|net worth|profit|AOC-4|MGT-7/i.test(r.text || '');
}
function parseLooseDate(v) {
  const t = String(v || '').trim();
  if (!t || /not stated|unknown|n\/a|^-+$/i.test(t)) return null;
  let m = t.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const d = new Date(t + ' UTC');
  return isNaN(d.getTime()) ? null : d;
}
function fmtDate(d) { return d ? d.toISOString().slice(0, 10) : 'not stated'; }

// Returns { outcome:'current'|'caution'|'unchecked', line, source, usage, model }. Never throws.
async function checkFilings(cin, legalName, brandName) {
  const checkedAt = new Date().toISOString().slice(0, 10);
  const unchecked = (why) => ({ outcome: 'unchecked', source: null, checked_at: checkedAt,
    line: `Filing status could not be checked from public sources (${why}). This does not mean the company is non-compliant; the filed documents sit on the Ministry of Corporate Affairs portal for a fee. Check there before relying on any financial claim.` });
  try {
    const slugs = [...new Set([slugify(legalName), slugify(brandName)].filter(Boolean))];
    if (!slugs.length) slugs.push('COMPANY');
    const urls = [];
    slugs.slice(0, 2).forEach((sl) => {
      urls.push(`https://www.zaubacorp.com/company/${sl}/${cin}`);
      urls.push(`https://www.tofler.in/${sl.toLowerCase()}/company/${cin}`);
    });
    let page = null; const errs = [];
    for (const u of urls) {
      const r = await fetchPageHtml(u, 12000);
      if (!r.ok) { errs.push(r.error); continue; }
      const text = htmlToText(r.html);
      // Identity check: the page must actually show this exact CIN.
      if (!text.toUpperCase().includes(cin)) { errs.push('page did not show this company number'); continue; }
      page = { url: r.url, text: text.slice(0, 14000) };
      break;
    }
    if (!page) return unchecked('the registry summary pages could not be opened: ' + (errs[0] || 'no response'));

    const res = await callClaude({
      model: 'claude-haiku-4-5-20251001',
      system: `You read the text of a public company-registry summary page and copy out facts. Use ONLY what the text says; never guess. Reply with ONE JSON object and nothing else, with exactly these keys, each a short string, or "not stated" if the page does not show it: "company_status", "active_compliance", "last_agm_date", "last_balance_sheet_date", "paid_up_capital", "authorized_capital", "date_of_incorporation". Dates as shown on the page.`,
      messages: [{ role: 'user', content: `Company number: ${cin}\n\nPage text:\n${page.text}` }],
      max_tokens: 400
    });
    const raw = extractText(res) || '';
    let j = null;
    try { j = JSON.parse((raw.match(/\{[\s\S]*\}/) || [''])[0]); } catch (e) { j = null; }
    if (!j) return { ...unchecked('the page could not be read into facts'), usage: res.usage, model: res.model };

    const status = String(j.company_status || '');
    const comp = String(j.active_compliance || '');
    const agm = parseLooseDate(j.last_agm_date);
    const bs = parseLooseDate(j.last_balance_sheet_date);
    const now = new Date();
    const monthsOld = (d) => (now.getUTCFullYear() - d.getUTCFullYear()) * 12 + (now.getUTCMonth() - d.getUTCMonth());
    const facts = `Status: ${status || 'not stated'}; compliance flag: ${comp || 'not stated'}; last AGM: ${fmtDate(agm)}; last balance sheet filed: ${fmtDate(bs)}; paid-up capital: ${j.paid_up_capital || 'not stated'} (source: ${page.url}, checked ${checkedAt}).`;
    const bad = /strike|struck|under process of striking|dissol|liquidat|amalgamat|non.?compliant|inactive|dormant/i;
    const good = /active/i;
    if (bad.test(status) || (bad.test(comp) && !/^\s*(active\s*)?compliant/i.test(comp))) {
      return { outcome: 'caution', source: page.url, checked_at: checkedAt, usage: res.usage, model: res.model,
        line: `The public registry page shows a compliance problem. ${facts} Verify on the Ministry of Corporate Affairs portal before relying on any financial claim.` };
    }
    if (bs && monthsOld(bs) > 20) {
      return { outcome: 'caution', source: page.url, checked_at: checkedAt, usage: res.usage, model: res.model,
        line: `The latest balance sheet on the public registry page is more than 20 months old, which suggests annual filings may be overdue. ${facts} This is what the page shows, not a finding of default; verify on the Ministry of Corporate Affairs portal.` };
    }
    if (bs && good.test(status + ' ' + comp)) {
      return { outcome: 'current', source: page.url, checked_at: checkedAt, usage: res.usage, model: res.model,
        line: `Filings appear up to date on the public registry page. ${facts} The figures themselves are on the Ministry of Corporate Affairs portal for a fee.` };
    }
    return { ...unchecked('the page did not show a last balance sheet date or status'), usage: res.usage, model: res.model };
  } catch (e) {
    return unchecked('the check failed: ' + String(e.message || e).slice(0, 60));
  }
}

async function researchTopicWithRetry(topic, company_name, websites, prospect_name, position, maxRetries = 2, siteInfo = null, extraContext = '') {
  const websiteBlock = websites.length > 0
    ? websites.map((w, i) => `Website ${i + 1}: ${w}`).join('\n')
    : 'Website: (not provided)';

  const contactBlock = prospect_name
    ? `\nMeeting contact: ${prospect_name}${position ? `, ${position}` : ''}`
    : '';

  // BUILD 91: 2 searches per topic (was 1 in total), so one unlucky search no longer ends a topic.
  const searchBudget = Math.min(Math.max(websites.length, 1) + 1, 4);

  // BUILD 91: what was read directly from the company's own website, and anything the salesperson typed.
  const siteBlock = siteInfo && siteInfo.profile
    ? `\n\nVERIFIED FROM THE COMPANY'S OWN WEBSITE (read directly, not searched):\n${siteInfo.profile.slice(0, 3500)}${siteInfo.cins && siteInfo.cins.length ? `\nRegistration number (CIN) found: ${siteInfo.cins.join(', ')}` : ''}`
    : '';
  const typedBlock = extraContext ? `\n\nExtra context typed by the salesperson (use it to identify the company):\n${String(extraContext).slice(0, 700)}` : '';
  const identityRule = siteInfo && siteInfo.profile
    ? `The block "VERIFIED FROM THE COMPANY'S OWN WEBSITE" below is the identity anchor. A search result counts as THIS company if it matches the legal name, brand name, registration number (CIN), address or website domain shown there. Use those exact identifiers in your searches (for example the legal name together with the CIN or the town, or the brand name together with the domain), not just the short company name. If the website profile itself answers this topic, you may report it, marked (from the company's own website).`
    : `Only report information you can confirm is actually about THIS SPECIFIC company (matching the name and/or website given below).`;

  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const claudeRes = await callClaude({
        model: 'claude-haiku-4-5-20251001',
        system: `You are doing one small, focused piece of research on a company, as part of a larger presales prep. Your job: use web search to find information specifically about ${topic.focus}.

${websites.length > 1 ? `IMPORTANT — multiple websites were given for this company (likely a group of related/sister companies). Search using EACH website listed below individually — do not rely on a single search to cover all of them. Combine what you find across all sites into one answer.\n\n` : ''}CRITICAL — verify identity before reporting anything: ${identityRule} Do not report a different company that merely has a similar or related-sounding name. If a search doesn't turn up a confident match for the specific company/website given, reply with ONLY this sentence: "Could not verify information about the specific company/website given." — never name, list or describe other companies, similar names, or what the searches returned instead, and never add suggestions of where to look. Do NOT substitute or present information about a different company as if it were about this one, even if it seems like a plausible or likely match. A wrong company match is worse than no information at all, and has caused a real, confirmed error before.

Return 2-4 short bulleted markdown facts, only about this specific topic. If search turns up nothing relevant to this specific topic (for a confirmed match on the right company), reply with ONLY "Nothing specific found on this topic." — do not pad with generic statements or drift into other topics. Keep it brief — this is one piece of a larger picture, not the whole report.`,
        messages: [{
          role: 'user',
          content: `Company: ${company_name}\n${websiteBlock}${contactBlock}${siteBlock}${typedBlock}\n\nFind information specifically about: ${topic.focus}`
        }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: searchBudget }],
        max_tokens: 700
      });
      const text = cleanTopicText(extractText(claudeRes));
      return { key: topic.key, label: topic.label, ok: true, text: text || 'Nothing specific found on this topic.', model: claudeRes.model, usage: claudeRes.usage };
    } catch (err) {
      lastErr = err;
      if (is429Error(err) && attempt < maxRetries) {
        // Exponential backoff: 2s, then 4s, before giving this topic
        // another try. Not a header-driven wait (can't verify that
        // header reaches this layer) — a sensible fixed schedule
        // instead.
        await sleep(2000 * Math.pow(2, attempt));
        continue;
      }
      break; // not a 429, or retries exhausted — stop trying
    }
  }
  return { key: topic.key, label: topic.label, ok: false, error: lastErr?.message || 'Unknown error' };
}

function compileFacts(sections, linkedin_paste, siteInfo = null, siteNote = '', filing = null, specific = null) {
  const succeeded = sections.filter((s) => s.ok);
  const failed = sections.filter((s) => !s.ok);

  // BUILD 91b: only topics with real findings become sections; the rest are one short line.
  const confirmedSecs = succeeded.filter((s) => classifyTopic(s) === 'confirmed');
  const notFound = succeeded.filter((s) => classifyTopic(s) !== 'confirmed');
  let confirmed_facts = confirmedSecs
    .map((s) => `### ${s.label}\n${s.text}`)
    .join('\n\n');
  if (notFound.length > 0) {
    confirmed_facts += (confirmed_facts ? '\n\n' : '') + `### Not found on public sources\n*No confirmed public information was found on: ${notFound.map((s) => s.label).join('; ')}.*`;
  }

  // BUILD 91: the company's own website, read directly, comes first.
  if (siteInfo && siteInfo.profile) {
    confirmed_facts = `### From the company's own website (read directly)\n${siteInfo.profile}\n*Pages read: ${siteInfo.pages.slice(0, 4).join(', ')}*\n\n` + confirmed_facts;
  } else if (siteNote) {
    confirmed_facts = `### Company website\n*${siteNote} Add what you know about the company to this box.*\n\n` + confirmed_facts;
  }

  // BUILD 92b: the salesperson's own question goes straight after the website section (before the 12 topics).
  const spSec = specificQuestionSection(specific);
  if (spSec) {
    const marker = /^### From the company's own website[\s\S]*?\n\n(?=### )/;
    if (marker.test(confirmed_facts)) confirmed_facts = confirmed_facts.replace(marker, (mm) => mm + spSec + '\n\n');
    else confirmed_facts = spSec + '\n\n' + confirmed_facts;
  }

  // BUILD 92: filing check result. A caution goes FIRST so it reaches the plan; the other outcomes sit after the website section.
  if (filing && filing.line) {
    if (filing.outcome === 'caution') {
      confirmed_facts = `### ${FILING_MARK}\n${filing.line}\n\n` + confirmed_facts;
    } else {
      confirmed_facts += `\n\n### Company filings (public registry summary)\n${filing.line}`;
    }
  }

  if (linkedin_paste && linkedin_paste.trim()) {
    confirmed_facts += `\n\n### Contact's LinkedIn Profile (pasted by the salesperson)\n${linkedin_paste.trim()}`;
  }

  if (failed.length > 0) {
    confirmed_facts += `\n\n*(Note: research on ${failed.map((f) => f.label).join(', ')} didn't complete — you can retry just these, or edit this box manually.)*`;
  }

  return confirmed_facts;
}

exports.handler = async function (event) {
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid request.' };
  }

  const { report_id, company_name, company_website, linkedin_paste, prospect_name, position, session_token, notes_text, site_text, wildcard_query } = payload;

  if (!report_id || !company_name) {
    return { statusCode: 400, body: 'report_id and company_name are required.' };
  }

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      await supaPatch(`reports?id=eq.${report_id}`, { status: 'failed', error_message: 'Session check failed inside the background worker.' });
      return { statusCode: 401, body: 'Not authorized.' };
    }

    const websites = parseWebsites(company_website);

    // BUILD 91: website first. Never allowed to stop the research: any problem is noted and the topics run anyway.
    let siteInfo = null; let siteNote = ''; let siteUsage = null; let siteModel = null;
    const extraContext = [notes_text, company_name].filter(Boolean).join(' | ');
    try {
      const built = await buildSiteProfile(websites, company_name, [notes_text, company_name, company_website].filter(Boolean).join(' '), site_text);
      siteInfo = built.siteInfo; siteNote = built.note || ''; siteUsage = built.usage; siteModel = built.model;
      if (siteInfo && built.typedCins && built.typedCins.length) {
        siteInfo.cins = [...new Set([...(siteInfo.cins || []), ...built.typedCins])];
      } else if (!siteInfo && built.typedCins && built.typedCins.length) {
        siteInfo = { profile: 'Registration number (CIN) typed by the salesperson: ' + built.typedCins.join(', '), cins: built.typedCins, gsts: [], pages: [] };
      }
    } catch (e) {
      siteNote = 'The website step failed (' + String(e.message || e).slice(0, 80) + ').';
    }
    if (siteUsage) {
      try { await logApiUsage({ member_id: member.id, report_id, function_name: 'presales-research-background', action: 'site_profile', model: siteModel, claudeResponse: { usage: siteUsage } }); } catch (e) { /* cosmetic */ }
    }
    const typedNotes = notes_text ? String(notes_text) : '';

    // Batch 1 first, fully, before batch 2 starts — this is what the
    // frontend's "digging deeper" transition is actually watching for
    // (batch 1's results landing in structured_data).
    // BUILD 90: real progress. Each finished topic bumps progress_done (out of 12) on the report
    // row so the screen can show "7 of 12 done" and a bar. Never allowed to break the research.
    let doneCount = 0;
    const totalTopics = TOPICS_BATCH_1.length + TOPICS_BATCH_2.length;
    const runTopic = async (topic) => {
      const res = await researchTopicWithRetry(topic, company_name, websites, prospect_name, position, 2, siteInfo, typedNotes);
      doneCount += 1;
      const mine = doneCount;
      try { await supaPatch(`reports?id=eq.${report_id}`, { progress_done: mine, progress_total: totalTopics }); } catch (e) { /* progress is cosmetic */ }
      return res;
    };
    try { await supaPatch(`reports?id=eq.${report_id}`, { progress_done: 0, progress_total: totalTopics }); } catch (e) { /* cosmetic */ }
    const batch1Results = await Promise.allSettled(
      TOPICS_BATCH_1.map((topic) => runTopic(topic))
    );
    const batch1Sections = batch1Results.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message || 'Unknown error' }));

    // Persist batch 1 immediately — if batch 2 somehow never
    // completes (a genuine crash, not just a slow topic), batch 1's
    // real results aren't silently lost.
    await supaPatch(`reports?id=eq.${report_id}`, {
      structured_data: { research_topics: batch1Sections, batches_complete: 1 }
    });

    const batch2Results = await Promise.allSettled(
      TOPICS_BATCH_2.map((topic) => runTopic(topic))
    );
    const batch2Sections = batch2Results.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message || 'Unknown error' }));

    const allSections = [...batch1Sections, ...batch2Sections];

    await Promise.all(allSections.map((s) =>
      s.usage
        ? logApiUsage({ member_id: member.id, report_id, function_name: 'presales-research-background', action: s.key, model: s.model, claudeResponse: { usage: s.usage } })
        : Promise.resolve()
    ));

    // Automatic final retry pass — per direct feedback, a failure
    // shouldn't require the user to click anything as the FIRST
    // response. researchTopicWithRetry already handles 429s
    // internally with backoff; this outer pass gives any STILL-failed
    // topic (429-exhausted, or any other error type — a network blip,
    // a malformed response) one more full attempt automatically,
    // before the user ever sees anything. The manual "Retry Failed
    // Topics" button becomes a true last-resort fallback for the rare
    // case something is still failing after this, not the routine
    // first response to any hiccup.
    const stillFailed = allSections.filter((s) => !s.ok);
    let finalSections = allSections;
    if (stillFailed.length > 0) {
      const topicsToRetry = ALL_TOPICS.filter((t) => stillFailed.some((f) => f.key === t.key));
      const retryResults = await Promise.allSettled(
        topicsToRetry.map((topic) => researchTopicWithRetry(topic, company_name, websites, prospect_name, position, 2, siteInfo, typedNotes))
      );
      const retriedSections = retryResults.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message || 'Unknown error' }));

      await Promise.all(retriedSections.map((s) =>
        s.usage
          ? logApiUsage({ member_id: member.id, report_id, function_name: 'presales-research-background', action: 'auto_retry_' + s.key, model: s.model, claudeResponse: { usage: s.usage } })
          : Promise.resolve()
      ));

      const retriedByKey = Object.fromEntries(retriedSections.map((r) => [r.key, r]));
      finalSections = allSections.map((s) => retriedByKey[s.key] || s);
    }

    const succeededCount = finalSections.filter((s) => s.ok).length;
    if (succeededCount === 0) {
      await supaPatch(`reports?id=eq.${report_id}`, {
        status: 'failed',
        error_message: 'Research failed on every topic.',
        structured_data: { research_topics: finalSections, batches_complete: 2 }
      });
      return { statusCode: 200, body: 'done (failed - all topics)' };
    }

    // BUILD 91b: is there enough to build a report on? The website was read (or pasted), or 4+ topics confirmed.
    const confirmedCount = finalSections.filter((s) => classifyTopic(s) === 'confirmed').length;
    const siteWasRead = !!(siteInfo && siteInfo.pages && siteInfo.pages.length > 0);
    if (!siteWasRead && confirmedCount < 4) {
      let refunded = false;
      try {
        const own = await supaGet(`reports?id=eq.${report_id}&select=prospect_id`);
        const pid = own.length ? own[0].prospect_id : null;
        let earlier = 0;
        if (pid) {
          const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
          const prior = await supaGet(`reports?prospect_id=eq.${pid}&report_type=eq.presales_research&error_message=eq.INSUFFICIENT_DATA&created_at=gte.${encodeURIComponent(since)}&select=id`);
          earlier = prior.filter((r) => r.id !== report_id).length;
        }
        if (earlier < 2) { await refund(member, PRICES.research, { reportId: report_id, note: 'research: not enough public data' }); refunded = true; }
      } catch (e) { /* the refund is best effort; the outcome below stands either way */ }
      await supaPatch(`reports?id=eq.${report_id}`, {
        status: 'failed',
        error_message: 'INSUFFICIENT_DATA',
        structured_data: { research_topics: finalSections, batches_complete: 2, insufficient: true, confirmed_count: confirmedCount, site_note: siteNote || null, refunded }
      });
      return { statusCode: 200, body: 'done (not enough public data)' };
    }

    // BUILD 92: filing check, only when a CIN is known, the company is unlisted, and the registry topic gave no real filing facts.
    let filing = null;
    try {
      const cin = (siteInfo && siteInfo.cins && siteInfo.cins[0]) || '';
      if (cin && /^U/i.test(cin) && !registryHasFilingFacts(finalSections)) {
        const legal = legalNameFromProfile(siteInfo && siteInfo.profile);
        filing = await checkFilings(cin.toUpperCase(), legal, company_name);
        if (filing.usage) {
          try { await logApiUsage({ member_id: member.id, report_id, function_name: 'presales-research-background', action: 'filing_check', model: filing.model, claudeResponse: { usage: filing.usage } }); } catch (e) { /* cosmetic */ }
        }
      }
    } catch (e) { filing = null; }

    // BUILD 92b: the salesperson's own specific question, if one was entered at setup.
    let specific = null;
    try {
      if (wildcard_query && String(wildcard_query).trim()) {
        specific = await researchSpecificQuestion(wildcard_query, company_name, websites, siteInfo, typedNotes, prospect_name);
        if (specific && specific.usage) {
          try { await logApiUsage({ member_id: member.id, report_id, function_name: 'presales-research-background', action: 'specific_question', model: specific.model, claudeResponse: { usage: specific.usage } }); } catch (e) { /* cosmetic */ }
        }
      }
    } catch (e) { specific = null; }

    const confirmed_facts = compileFacts(finalSections, linkedin_paste, siteInfo, siteNote, filing, specific);

    await supaPatch(`reports?id=eq.${report_id}`, {
      status: 'complete',
      confirmed_facts,
      structured_data: { research_topics: finalSections, batches_complete: 2, site_profile: siteInfo ? { profile: siteInfo.profile, cins: siteInfo.cins, pages: siteInfo.pages } : null, site_note: siteNote || null, specific_question: specific ? { query: specific.query, ok: specific.ok, found: specific.found, text: specific.text } : null, filing_check: filing ? { outcome: filing.outcome, line: filing.line, source: filing.source, checked_at: filing.checked_at } : null }
    });

    return { statusCode: 200, body: 'done' };
  } catch (err) {
    try {
      await supaPatch(`reports?id=eq.${report_id}`, { status: 'failed', error_message: 'Server error: ' + err.message });
    } catch (e2) {
      // nothing more to do if even the failure-update fails
    }
    return { statusCode: 200, body: 'done (failed - exception)' };
  }
};

// Exported so presales-research.js (the synchronous retry-only-
// failed-topics endpoint) can reuse the exact same topic definitions
// and retry logic, rather than maintaining a second, driftable copy.
exports.ALL_TOPICS = ALL_TOPICS;
exports.researchTopicWithRetry = researchTopicWithRetry;
exports.compileFacts = compileFacts;
exports.buildSiteProfile = buildSiteProfile;
exports.classifyTopic = classifyTopic;
exports.checkFilings = checkFilings;
exports.researchSpecificQuestion = researchSpecificQuestion;
exports.specificQuestionSection = specificQuestionSection;
exports.FILING_MARK = FILING_MARK;
