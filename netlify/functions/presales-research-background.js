// PREPDO — presales-research-background.js
// CURRENT VERSION: BUILD 93.2 (28 Nov 2026). Newest entry first below.
// BUILD 93.2 | 2026-11-28: FIXES FROM THE SECOND BLOOM RUN (read in the PDF). (1) A bullet marker standing alone on a line is joined to the
// text on the next line, and bold marks are removed from research text: lines that began with bold text lost it in the PDF (the CEO's name,
// the 'Kedaara' heading, the CIN label). Headings inside a topic become a plain 'Label:' line. (2) Lines that were wrapped in italics
// (the 'Not found' list, 'Pages read', the 'Check these' note) vanished in the PDF; they are now plain text. (3) INTERPRETATION STRIPPER:
// sentences that only interpret ('Indicates supplier payment difficulties', 'Systemic cleanliness failures', 'signals exposure') are
// removed from research text; the sourced fact in front of them stays. (4) New evidence rules 10-13: no interpretation, one review is one
// review, nothing 'from the company's own website' unless the website profile says it, no filler such as 'range, exact figure proprietary'.
// (5) The 'Anything else' question must not repeat the other eleven. (6) The consistency check flags only two explicit conflicting values
// (and two different targets), says which is older, and writes plain text.
// BUILD 93.1 | 2026-11-28: FIXES FROM THE FIRST LIVE COMPARISON (Bloom). (1) The named-contact question is skipped when no contact
// name was given (it used to answer with a chat message that was counted as a finding); any reply that merely asks the user for
// information counts as 'nothing found'. (2) Tidier text: narration lines ('Based on my search...') and '---' marks are removed
// and citation line breaks are joined back into their bullet. (3) New evidence rules: a total or derived figure is reported
// only if a source states it (or shown as 'calculated' with its parts); the figure from the LATEST filing, not incorporation
// year, is the current one. (4) The specific-question step now has the same 'latest figure wins', 'no derived totals' and
// 'sources differ' rules. (5) Questions widened: subsidiaries and group companies, latest paid-up capital with its filing
// date, investor board nominees, target cities and customer segments, named corporate clients. (6) CONSISTENCY CHECK: one small
// extra AI call reads the finished facts and lists possible inconsistencies under 'Check these' (same item with two values,
// totals that do not match the rounds listed, a person with conflicting roles). It only quotes the facts, never adds or
// deletes any, and is stored in structured_data.consistency_check.
// BUILD 93 | 2026-11-28: THE 12 QUESTIONS REBUILT + COUNTRY SOURCES. (1) New 12 questions (recent developments, ownership
// and funding history, registry and financials, market position and where it is losing ground, leadership, management's own
// statements of gaps, operational pain points, people signals, existing solutions in the seller's area, named contact,
// customers and recognition, anything else). Facts only: every item dated and sourced. (2) Common evidence rules sent with
// every question: two searches with different purposes (the company's own statements, then an independent source), later
// figures supersede earlier ones and the date is stated, single-source claims are marked, every known name of the company
// is searched, nothing found is stated, identity is verified. (3) The country chosen for the prospect selects a source
// list (country-sources.json: newspapers, registry, regulator, trade press) that is given to the search as where to look
// first; a country with no list uses open search. (4) Question 9 uses the seller's own area from their organisation
// profile (nothing hard-wired to one seller). The country is stored with the research (structured_data.country).
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

// BUILD 93: the 12 research questions, rebuilt. Facts only (what, when, source); no interpretation here - that is
// the analysis stage. {SELLER_AREA} is filled from the salesperson's own organisation (set by their MD), so nothing
// is hard-wired to one seller.
const TOPICS_BATCH_1 = [
  {
    key: 'recent',
    label: 'Recent Developments & Stated Plans',
    focus: 'what has happened at this company in the last 12 months (announcements, launches, expansions, closures, acquisitions, contracts won or lost, restructuring, leadership changes) AND what the company or its leaders have publicly said they plan next (targets, new sites, new products, target cities, segments or customer types, stated priorities). For every item give the date and the source'
  },
  {
    key: 'ownership',
    label: 'Ownership, Investors & Funding History',
    focus: 'who owns this company: promoters or founders, major shareholders and investors, each funding round or stake sale with its date, amount and percentage where published, and any later change (a later round usually supersedes an earlier percentage, so look for the latest figure and say which date it is as of). Also name any parent, holding or group company, and the board directors or observers each investor has nominated. Report only what a source states'
  },
  {
    key: 'registry_financials',
    label: 'Corporate Registry & Precise Financials',
    focus: 'corporate registry information and precise financial data for this company: legal name, registration number, incorporation date, registered address, directors, subsidiaries and group companies, the LATEST paid-up capital as per the most recent filing (with its date, not the figure at incorporation), and revenue, profit, net worth and borrowings by year as filed or reported. Search the official registry and regulator for the company\'s country first, then business-data sites and the business press. Report standalone and consolidated figures separately if both exist, and state the financial year for every figure'
  },
  {
    key: 'market',
    label: 'Market Position, Competition & Where It Is Losing Ground',
    focus: 'where this company stands against named competitors (size, share, rank, growth rate) and any evidence it is losing ground: falling share or sales, lost customers or contracts, margin pressure, a competitor overtaking it, negative analyst or press commentary. Name the competitors and give dates and sources'
  },
  {
    key: 'leadership',
    label: 'Leadership & Decision-Makers',
    focus: 'the people who lead this company: founders, CEO/MD, and the heads of the functions relevant to a purchase like this, with tenure, background and any recent changes. State which named person publicly owns or sponsors initiatives relevant to this meeting (for example a transformation, training, or technology programme). Do NOT guess who approves purchases; report only what is publicly stated'
  },
  {
    key: 'named_gaps',
    label: "Management's Own Statements About Internal Gaps",
    focus: 'where this company\'s own leaders have publicly acknowledged an internal gap or difficulty (execution, accountability, delegation, speed of decisions, capability, hiring, culture), in investor calls, annual reports, interviews, speeches or posts. Quote or closely paraphrase, naming the speaker, date and source. For a small or private company with no investor calls, use interviews, local press and trade-body statements instead'
  }
];

const TOPICS_BATCH_2 = [
  {
    key: 'operational_pain',
    label: 'Operational & Execution Pain Points',
    focus: 'specific, evidenced signs of operational or execution difficulty: project delays, cost or schedule overruns, quality or delivery problems, customer complaints, regulatory notices, labour or supply problems, or analyst commentary on execution risk. Search for this directly and specifically, not by inference from other topics. Each item needs a date and a source; a general characterisation without evidence does not count. Report each customer review as one review (platform, property, date or \'undated, single review\'), never as a pattern'
  },
  {
    key: 'people',
    label: 'People & Workforce Signals',
    focus: 'workforce facts: approximate headcount and its direction, current hiring (what roles, how many, which locations), layoffs, attrition or leadership exits, employer-review ratings and recurring themes, and any statements about skills or capability shortages. Give dates and sources'
  },
  {
    key: 'existing_solutions',
    label: 'Existing Solutions in the Seller\'s Area',
    focus: 'what this company already uses or runs in this area: {SELLER_AREA}. Look for named programmes, vendors, partners, platforms, academies or recent launches the company has publicly described, with dates and sources. Say plainly if nothing is public'
  },
  {
    key: 'named_contact',
    label: 'About the Named Contact',
    focus: 'the specific named contact for this meeting: professional background, current role and tenure, public profile, awards or recognition they personally received, and what their own public activity (talks, posts, articles) shows about their stated focus. If the person cannot be identified with confidence, say so and do not substitute anyone else'
  },
  {
    key: 'named_customers',
    label: 'Customers, Partners & Recognition',
    focus: 'customers, clients (including named corporate clients), partners and distributors this company publicly names, and awards, certifications, rankings or recognition the company has received in the last 2-3 years, each with date and source'
  },
  {
    key: 'catch_all',
    label: 'Anything Else Worth Knowing',
    focus: 'anything else a salesperson would genuinely want to know before this meeting that the other eleven areas do not cover and that is not a repeat of them: for example customer-facing technical or service teams, critical scarce skills, an unusual business model, pending litigation, regulatory exposure, or a recent crisis. Do NOT repeat any ownership, funding, financial, leadership, customer, workforce or plan fact that the other eleven areas already cover; report only what is new. Say plainly if there is nothing further'
  }
];

const ALL_TOPICS = [...TOPICS_BATCH_1, ...TOPICS_BATCH_2];

// ---------- BUILD 93: country source lists and the seller's own area ----------
let COUNTRY_SOURCES = {};
try { COUNTRY_SOURCES = require('./country-sources.json'); } catch (e) { COUNTRY_SOURCES = {}; }

// Text telling the search where to look first for this country. '' when no country or no list (open search).
function countrySourceBlock(country) {
  const c = String(country || '').trim();
  if (!c) return '';
  const e = COUNTRY_SOURCES[c];
  if (!e) return `\n\nCountry of the prospect: ${c}. No source list is held for it: use open search, and prefer the official company registry and the leading local business press.`;
  const bits = [];
  if (e.registry) bits.push(`Official registry / regulator / exchange: ${e.registry}`);
  if (e.papers) bits.push(`Business press: ${e.papers}`);
  if (e.trade) bits.push(`Trade press: ${e.trade}`);
  return `\n\nCountry of the prospect: ${c}. WHERE TO LOOK FIRST (a starting list, not a limit; some entries may be out of date, so use what works and ignore what does not):\n${bits.join('\n')}${e.notes ? `\nAccess notes: ${String(e.notes).slice(0, 400)}` : ''}`;
}

const DEFAULT_SELLER_AREA = 'leadership, management and sales-effectiveness training, coaching and development programmes';
// What the seller sells, taken from their own organisation profile (supplied by their MD). Never hard-wired.
function sellerAreaFor(member) {
  try {
    const txt = member && member.org_context_research ? String(member.org_context_research).replace(/\s+/g, ' ').trim() : '';
    if (txt && member.selling_company_name) return `${member.selling_company_name} sells: ${txt.slice(0, 450)}`;
  } catch (e) { /* fall through */ }
  return DEFAULT_SELLER_AREA;
}

const EVIDENCE_RULES = `EVIDENCE RULES (apply to every fact you report):
1. FACTS ONLY. Say what, when and according to whom. Do not interpret, speculate, give opinions or sales advice.
2. Every item carries a date (month and year at least) and a source name. If a date is not shown, write "date not stated".
3. SEARCH TWICE WITH DIFFERENT PURPOSES: first the company's own statements and the official sources; then an independent source (business press, regulator, registry, trade press). Prefer the sources listed under the country when given.
4. If a later figure or event replaces an earlier one (a new funding round, a revised stake, a new CEO), report the LATEST and say it is as of its date. Do not report an older figure as current.
5. Mark a claim "(single source)" when only one source states it, and "(sources differ)" with both values when they disagree.
6. Search under EVERY name the company is known by (legal name, brand, former name, parent or group name) found on the website or in your searches.
7. TOTALS AND DERIVED FIGURES: report a total, percentage or conclusion (for example 'total raised', 'majority stake') only if a source states it. If you add figures yourself, show the parts and mark the result 'calculated'. Never present your own sum as a sourced fact.
8. CURRENT FIGURES: use the figure from the most recent filing or report and give its year or date. A figure from the year of incorporation is not the current one.
9. If nothing is found, say so plainly using the required sentence; never fill space with generic statements.
10. NO INTERPRETATION. After a fact and its source, stop. Do not add a sentence saying what it indicates, suggests, signals or means, and do not add a label such as 'systemic', 'critical' or 'a quality issue'. The salesperson draws the conclusions.
11. REVIEWS AND COMPLAINTS: report each as one review, with the platform, the property and the date (or 'undated, single review'). Never describe a few reviews as a pattern, a trend or 'systemic'.
12. Write '(from the company's own website)' only for something that appears in the VERIFIED FROM THE COMPANY'S OWN WEBSITE block. Anything else carries its real source.
13. If an exact figure is not available, leave the item out. Do not write ranges, 'exact figure proprietary', 'behind paywall' or similar filler.`;


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
// BUILD 93.1: a reply that only asks the user for information is not a finding.
const ASKING_RE = /(could you please provide|you haven'?t provided|please provide (the|their|a)|i need (to identify|more information|the (name|contact)))/i;
// BUILD 93.2: sentences that only interpret a fact (not a fact themselves) are removed; the sourced fact in front of them stays.
const INTERP_RE = /\b(indicat\w*|suggest\w*|signal\w*|impl(?:y|ies|ied)|systemic|critical (?:operational|failure)|potential (?:for|revenue)|may (?:indicate|flag|point|suggest)|could (?:indicate|signal|suggest)|likely|competitive differentiator|exposure|friction|complexity|dilution|trajectory|milestone|raises? (?:the )?question|execution problems?|quality[- ]control issue)\b/i;
function stripInterpretation(line) {
  if (!/\S/.test(line)) return line;
  const m = line.match(/^(\s*(?:[•\-*]\s+|\d+[.)]\s+)?)([\s\S]*)$/);
  const lead = m[1]; const body = m[2];
  const parts = body.split(/(?<=[.!?])\s+(?=[A-Z])/);
  if (parts.length < 2) return line;
  const kept = [parts[0]];
  for (let i = 1; i < parts.length; i++) {
    const sent = parts[i];
    const prev = parts[i - 1];
    const words = sent.trim().split(/\s+/).length;
    const afterCitation = /[)\]]\.?\s*$/.test(prev.trim()) || /\(\s*[^)]*\)\.?\s*$/.test(prev.trim());
    const hasDigit = /\d/.test(sent);
    const startsPronoun = /^(This|That|These|It|Note:)\b/.test(sent.trim());
    const interp = INTERP_RE.test(sent) && (!hasDigit || startsPronoun);
    const shortLabel = afterCitation && words <= 8 && !hasDigit && !/["“]/.test(sent) && !/\s[A-Z]/.test(sent.trim().replace(/^\S+\s/, ' '));
    if (interp || shortLabel) continue;
    kept.push(sent);
  }
  return lead + kept.join(' ');
}
function cleanTopicText(t) {
  // Drop the model's narration lines ("I'll search for ...", "Based on my search, here are...") that sit before the facts.
  let out = String(t || '').split('\n').filter((ln) => !/^\s*(I'll|I will|Let me)\s+(search|look|find|check|research)/i.test(ln) && !/^\s*(Based on (my|the) (search|research|verified)|Here (are|is) (the|my) (key |confirmed )?(findings|facts|results|information))\b/i.test(ln) && !/^\s*-{3,}\s*$/.test(ln)).join('\n');
  out = out.replace(/^(\s*)-{3,}\s*(?=[•\-*])/gm, '$1');
  // BUILD 93.2: bold marks removed (a line starting with bold text lost it in the PDF); headings inside a topic become plain 'Label:' lines.
  out = out.replace(/\*\*/g, '').replace(/^[ \t]*#{1,6}[ \t]+([^\n]*?)[ \t]*:?[ \t]*$/gm, '$1:');
  // BUILD 93.2: a bullet marker standing alone on its line belongs to the next non-empty line.
  out = out.replace(/^([ \t]*[•\-*])[ \t]*\n+(?=[ \t]*\S)/gm, '$1 ');
  // Citation markup splits a bullet over several lines: join a continuation line back onto its bullet.
  const lines = out.split('\n'); const joined = [];
  for (const ln of lines) {
    if (!ln.trim()) { joined.push(''); continue; }
    const prev = joined.length ? joined[joined.length - 1] : '';
    const startsNew = /^\s*([•\-*]\s|#{1,6}\s|\d+[.)]\s|\|)/.test(ln);
    if (prev && prev.trim() && /^\s*[;,.)]/.test(ln)) joined[joined.length - 1] = prev.replace(/\s+$/, '') + ln.trim();
    else if (!startsNew && prev && /^\s*([•\-*]\s)/.test(prev)) joined[joined.length - 1] = prev.replace(/\s+$/, '') + ' ' + ln.trim();
    else if (!startsNew && prev && !/^\s*#{1,6}\s/.test(prev) && prev.trim() && !/[.:!?)]\s*$/.test(prev)) joined[joined.length - 1] = prev.replace(/\s+$/, '') + ' ' + ln.trim();
    else joined.push(ln);
  }
  out = joined.map(stripInterpretation).join('\n').replace(/[ \t]+([,;.])/g, '$1');
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
  if (ASKING_RE.test(t)) return 'nothing';
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
6. If a later round, filing or report replaces an earlier figure (for example a second funding round raising a stake from 35% to 45%), report the LATEST figure first with its date, and mention the earlier one as earlier. If sources give different figures, show both with their dates and write (sources differ). Never report a total or conclusion that no source states; if you add figures yourself, show the parts and mark it 'calculated'.
7. Facts only: after a fact and its source, add no sentence about what it indicates, suggests or means, and add no 'Note:' of your own. Report a single review as one review, not a pattern.
8. Give 3-6 short bullets, each ending with the source name and month/year in brackets. If you find nothing reliable, reply with ONLY: "Nothing specific found on this question."`,
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
    ? (sq.found ? sq.text : 'No reliable public information was found to answer this question. If you know something about it, add it to this box.')
    : 'This question could not be researched this time (a technical problem). You can add what you know to this box.';
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

async function researchTopicWithRetry(topic, company_name, websites, prospect_name, position, maxRetries = 2, siteInfo = null, extraContext = '', ctx = {}) {
  const focusText = String(topic.focus).replace('{SELLER_AREA}', (ctx && ctx.sellerArea) || DEFAULT_SELLER_AREA);
  const countryBlock = countrySourceBlock(ctx && ctx.country);
  const websiteBlock = websites.length > 0
    ? websites.map((w, i) => `Website ${i + 1}: ${w}`).join('\n')
    : 'Website: (not provided)';

  const contactBlock = prospect_name
    ? `\nMeeting contact: ${prospect_name}${position ? `, ${position}` : ''}`
    : '';

  // BUILD 91: 2 searches per topic (was 1 in total), so one unlucky search no longer ends a topic.
  const searchBudget = Math.min(Math.max(websites.length, 1) + 2, 4); // BUILD 93: 3 for one site (own statements, then independent source)

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
        system: `You are doing one small, focused piece of research on a company, as part of a larger presales prep. Your job: use web search to find information specifically about ${focusText}.

${websites.length > 1 ? `IMPORTANT — multiple websites were given for this company (likely a group of related/sister companies). Search using EACH website listed below individually — do not rely on a single search to cover all of them. Combine what you find across all sites into one answer.\n\n` : ''}CRITICAL — verify identity before reporting anything: ${identityRule} Do not report a different company that merely has a similar or related-sounding name. If a search doesn't turn up a confident match for the specific company/website given, reply with ONLY this sentence: "Could not verify information about the specific company/website given." — never name, list or describe other companies, similar names, or what the searches returned instead, and never add suggestions of where to look. Do NOT substitute or present information about a different company as if it were about this one, even if it seems like a plausible or likely match. A wrong company match is worse than no information at all, and has caused a real, confirmed error before.

Return 3-6 short bulleted markdown facts, only about this specific topic. If search turns up nothing relevant to this specific topic (for a confirmed match on the right company), reply with ONLY "Nothing specific found on this topic." — do not pad with generic statements or drift into other topics. Keep it brief — this is one piece of a larger picture, not the whole report.

${EVIDENCE_RULES}`,
        messages: [{
          role: 'user',
          content: `Company: ${company_name}\n${websiteBlock}${contactBlock}${siteBlock}${typedBlock}\n\nFind information specifically about: ${focusText}${countryBlock}`
        }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: searchBudget }],
        max_tokens: 1000
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

// ---------- BUILD 93.1: consistency check over the finished facts ----------
// Returns { text, usage, model } where text is '' when nothing doubtful was found. Never throws. Never changes the facts.
async function checkConsistency(factsText) {
  try {
    const body = String(factsText || '').slice(0, 16000);
    if (body.length < 400) return { text: '' };
    const res = await callClaude({
      model: 'claude-haiku-4-5-20251001',
      system: `You proof-read a set of research facts about ONE company and list possible inconsistencies. Use ONLY what the text says; add no outside knowledge and no new facts. Flag an item ONLY when two explicit, different values for the same thing both appear in the text. Look for: (a) the same item given with different values in different places (revenue, stake percentage, capital, headcount, dates, number of rooms or hotels, targets); (b) a stated total that does not match the amounts listed (add up the amounts the text lists and say the sum you got); (c) a person or firm described in conflicting roles or founder lists; (d) two different targets or forecasts for the same thing (for example 12,000 rooms and 25,000 rooms). When one value is dated earlier than the other, say which is older and that the newer normally replaces it; do not call that a contradiction unless the text calls both current. Do NOT flag something merely because it is unusual, and do not flag a difference the text already explains. Write plain text only, with no bold or italics. Reply with at most 6 short bullets, each starting "- " and naming both values and where each appears. If you find nothing doubtful, reply with only: NONE`,
      messages: [{ role: 'user', content: body }],
      max_tokens: 600
    });
    const t = String(extractText(res) || '').trim();
    if (!t || /^none\b/i.test(t) || !/^\s*[-•*]/m.test(t)) return { text: '', usage: res.usage, model: res.model };
    return { text: t, usage: res.usage, model: res.model };
  } catch (e) {
    return { text: '' };
  }
}

function compileFacts(sections, linkedin_paste, siteInfo = null, siteNote = '', filing = null, specific = null, consistency = '') {
  const succeeded = sections.filter((s) => s.ok);
  const failed = sections.filter((s) => !s.ok);

  // BUILD 91b: only topics with real findings become sections; the rest are one short line.
  const confirmedSecs = succeeded.filter((s) => classifyTopic(s) === 'confirmed');
  const notFound = succeeded.filter((s) => classifyTopic(s) !== 'confirmed');
  let confirmed_facts = confirmedSecs
    .map((s) => `### ${s.label}\n${s.text}`)
    .join('\n\n');
  if (notFound.length > 0) {
    confirmed_facts += (confirmed_facts ? '\n\n' : '') + `### Not found on public sources\nNo confirmed public information was found on: ${notFound.map((s) => s.label).join('; ')}.`;
  }

  // BUILD 91: the company's own website, read directly, comes first.
  if (siteInfo && siteInfo.profile) {
    confirmed_facts = `### From the company's own website (read directly)\n${siteInfo.profile}\n\nPages read: ${siteInfo.pages.slice(0, 4).join(', ')}\n\n` + confirmed_facts;
  } else if (siteNote) {
    confirmed_facts = `### Company website\n${siteNote} Add what you know about the company to this box.\n\n` + confirmed_facts;
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

  if (consistency && String(consistency).trim()) {
    confirmed_facts += `\n\n### Check these (possible inconsistencies in the research)\n${String(consistency).trim()}\n\nThese are points where the research disagrees with itself. Confirm them before relying on either version.`;
  }

  if (failed.length > 0) {
    confirmed_facts += `\n\n(Note: research on ${failed.map((f) => f.label).join(', ')} didn't complete — you can retry just these, or edit this box manually.)`;
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

  const { report_id, company_name, company_website, linkedin_paste, prospect_name, position, session_token, notes_text, site_text, wildcard_query, country } = payload;

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
    const ctx = { country: country ? String(country).slice(0, 80) : '', sellerArea: sellerAreaFor(member) };

    // Batch 1 first, fully, before batch 2 starts — this is what the
    // frontend's "digging deeper" transition is actually watching for
    // (batch 1's results landing in structured_data).
    // BUILD 90: real progress. Each finished topic bumps progress_done (out of 12) on the report
    // row so the screen can show "7 of 12 done" and a bar. Never allowed to break the research.
    let doneCount = 0;
    const totalTopics = TOPICS_BATCH_1.length + TOPICS_BATCH_2.length;
    const runTopic = async (topic) => {
      const res = (topic.key === 'named_contact' && !String(prospect_name || '').trim())
        ? { key: topic.key, label: topic.label, ok: true, text: 'Nothing specific found on this topic.' } // BUILD 93.1: no contact named, so nothing to research
        : await researchTopicWithRetry(topic, company_name, websites, prospect_name, position, 2, siteInfo, typedNotes, ctx);
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
      structured_data: { research_topics: batch1Sections, batches_complete: 1, country: ctx.country || null }
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
        topicsToRetry.map((topic) => researchTopicWithRetry(topic, company_name, websites, prospect_name, position, 2, siteInfo, typedNotes, ctx))
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
        structured_data: { research_topics: finalSections, batches_complete: 2, country: ctx.country || null }
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
        structured_data: { research_topics: finalSections, batches_complete: 2, country: ctx.country || null, insufficient: true, confirmed_count: confirmedCount, site_note: siteNote || null, refunded }
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

    let confirmed_facts = compileFacts(finalSections, linkedin_paste, siteInfo, siteNote, filing, specific);
    // BUILD 93.1: one small consistency check over the finished facts; it only adds a 'Check these' list.
    let consistencyText = '';
    try {
      const cc = await checkConsistency(confirmed_facts);
      consistencyText = cc.text || '';
      if (cc.usage) {
        try { await logApiUsage({ member_id: member.id, report_id, function_name: 'presales-research-background', action: 'consistency_check', model: cc.model, claudeResponse: { usage: cc.usage } }); } catch (e) { /* cosmetic */ }
      }
      if (consistencyText) confirmed_facts = compileFacts(finalSections, linkedin_paste, siteInfo, siteNote, filing, specific, consistencyText);
    } catch (e) { consistencyText = ''; }

    await supaPatch(`reports?id=eq.${report_id}`, {
      status: 'complete',
      confirmed_facts,
      structured_data: { research_topics: finalSections, batches_complete: 2, country: ctx.country || null, site_profile: siteInfo ? { profile: siteInfo.profile, cins: siteInfo.cins, pages: siteInfo.pages } : null, site_note: siteNote || null, consistency_check: consistencyText || null, specific_question: specific ? { query: specific.query, ok: specific.ok, found: specific.found, text: specific.text } : null, filing_check: filing ? { outcome: filing.outcome, line: filing.line, source: filing.source, checked_at: filing.checked_at } : null }
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
exports.sellerAreaFor = sellerAreaFor;
exports.checkConsistency = checkConsistency;
exports.cleanTopicText = cleanTopicText;
