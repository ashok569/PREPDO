// PREPDO — gleaner-generate-background.js
// BUILD 4 | 2026-09-06
// Real fix confirmed via an actual timeout on a live run: this call's
// prompt is genuinely larger than anything else in the app (both
// context files combined, plus up to 30 full reports stacked on top),
// so _lib.js's default 90s timeout was too tight for it specifically.
// Bumped to 240s on this one call — this runs as a background
// function precisely because it has room for a longer single call.
//
// BUILD 3 | 2026-09-06
// Real gap fix, raised directly: the previous version had no way to
// know which methodology (LMI vs SPIN) — or, for a Non-LMI report,
// which of the 30 industry variants — was actually active for each
// source report, so every finding was routed to only two possible
// destinations when there are genuinely three (lmi-context.md,
// spin-context.md, or one specific industry_contexts row). Now joins
// through to team_members for segment + industry_context_id, with a
// separate batched follow-up lookup for industry names — deliberately
// NOT a deeper nested embed, since presales-generate-background.js's
// own established pattern does a manual second query for this exact
// lookup rather than relying on automatic nested embedding, which is
// real evidence a deeper embed here would be a less proven choice.
// Verified the labeling logic directly against all three realistic
// cases (LMI, SPIN with an industry set, SPIN with none) before
// shipping. Each bullet's source citation now carries a real, stable
// short id, the exact methodology, and the generation date — not just
// a sequential position within one batch — so a verified finding
// stays traceable even in a separate future conversation.
//
// BUILD 2 | 2026-09-06
// Rewrote the output format per explicit agreement on the actual
// review workflow: a flat bulleted list ("New Assumptions by the
// Gleaner"), each a single, self-contained, independently-verdictable
// claim with its target file and source inline, ending in a
// consistent "Verdict: ______" placeholder — downloaded, annotated
// offline (TRUE/FALSE/CONDITIONAL, with a comment if CONDITIONAL),
// then handed back in a future conversation for the verified items to
// actually be integrated. No in-app upload/submit step exists or is
// needed — that verification and integration step happens in
// conversation, the same way every other real addition to
// lmi-context.md/spin-context.md has happened throughout this whole
// project. Replaces the previous structured "SUGGESTED ADDITION"
// block format, which grouped fields in a way that didn't suit
// per-item annotation. No parsing of the AI's output happens in this
// file either way (output_markdown stores the raw text as-is), so this
// was a safe, contained prompt change.
//
// BUILD 1 | 2026-09-06
// New file. THE FILENAME SUFFIX "-background" IS REQUIRED — same rule
// as every other background function in this app.
//
// Scans a batch of recent, completed real reports (Presales Prep,
// Meeting Analysis, Role Play debriefs) and asks Claude to identify
// genuinely new, specific, reusable patterns worth adding to
// lmi-context.md or spin-context.md — real language, real objection-
// handling, real case examples, real named techniques actually found
// in real reports, explicitly NOT already covered in the current
// context files, and explicitly NOT manufactured if nothing new
// turns up. This mirrors exactly how the context files themselves were
// originally built (per lmi-context.md's own Purpose note: "built up
// progressively from scoping conversations, a real sales roleplay, and
// five real recorded calls") — just done as an ongoing, repeatable
// process instead of a one-time effort.
//
// One Sonnet call over the sampled batch — same reasoning as roleplay-
// debrief-background.js: a single substantial reasoning pass, not
// something naturally splittable into independent parallel sections
// the way Presales Prep's Strategy/Digest/SPIN are.
//
// Capped at the 30 most recent completed reports with real detailed
// content, across all three report types — keeps the prompt bounded
// and the cost predictable for a "temporary feature." Worth revisiting
// (e.g. chunking into multiple passes) if usage grows well past that.

const fs = require('fs');
const path = require('path');
const { callClaude, extractText, buildCacheableSystem, logApiUsage, supaGet, supaPatch, getMemberFromSession } = require('./_lib.js');

const REPORT_SAMPLE_CAP = 30;

const LMI_CANDIDATE_PATHS = [
  path.join(__dirname, 'lmi-context.md'),
  path.join(__dirname, 'netlify', 'functions', 'lmi-context.md'),
  path.join(process.cwd(), 'netlify', 'functions', 'lmi-context.md'),
  '/var/task/lmi-context.md',
  '/var/task/netlify/functions/lmi-context.md'
];
let LMI_CONTEXT;
let LMI_CONTEXT_LOAD_ERROR = null;
try {
  const foundPath = LMI_CANDIDATE_PATHS.find((p) => fs.existsSync(p));
  if (!foundPath) throw new Error(`Not found in any of: ${LMI_CANDIDATE_PATHS.join(', ')}`);
  LMI_CONTEXT = fs.readFileSync(foundPath, 'utf8');
} catch (err) {
  LMI_CONTEXT_LOAD_ERROR = err.message;
}

const SPIN_CANDIDATE_PATHS = [
  path.join(__dirname, 'spin-context.md'),
  path.join(__dirname, 'netlify', 'functions', 'spin-context.md'),
  path.join(process.cwd(), 'netlify', 'functions', 'spin-context.md'),
  '/var/task/spin-context.md',
  '/var/task/netlify/functions/spin-context.md'
];
let SPIN_CONTEXT;
let SPIN_CONTEXT_LOAD_ERROR = null;
try {
  const foundPath = SPIN_CANDIDATE_PATHS.find((p) => fs.existsSync(p));
  if (!foundPath) throw new Error(`Not found in any of: ${SPIN_CANDIDATE_PATHS.join(', ')}`);
  SPIN_CONTEXT = fs.readFileSync(foundPath, 'utf8');
} catch (err) {
  SPIN_CONTEXT_LOAD_ERROR = err.message;
}

exports.handler = async function (event) {
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid request.' };
  }

  const { gleaner_report_id, session_token } = payload;
  if (!gleaner_report_id) {
    return { statusCode: 400, body: 'gleaner_report_id is required.' };
  }

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      await supaPatch(`gleaner_reports?id=eq.${gleaner_report_id}`, {
        status: 'failed',
        error_message: 'Session check failed inside the background worker.'
      });
      return { statusCode: 401, body: 'Not authorized.' };
    }

    if (LMI_CONTEXT_LOAD_ERROR || SPIN_CONTEXT_LOAD_ERROR) {
      await supaPatch(`gleaner_reports?id=eq.${gleaner_report_id}`, {
        status: 'failed',
        error_message: `Context file failed to load: ${LMI_CONTEXT_LOAD_ERROR || SPIN_CONTEXT_LOAD_ERROR}`
      });
      return { statusCode: 200, body: 'done (failed - context load)' };
    }

    // Pull the most recent completed reports across all three types with
    // real detailed content. Deliberately just ai_output_detailed plus
    // identifying fields — the richest single field, not every column —
    // to keep the prompt bounded. company_name comes through the
    // embedded prospects relation (PostgREST embed), null for standalone
    // Role Play sessions, which is fine — the report_type label alone is
    // enough context for the Gleaner's purpose.
    // BUILD 3 real gap fix: the previous query had no way to know
    // which methodology (LMI vs SPIN) — or for a Non-LMI report, which
    // SPECIFIC industry variant (there are 30 in the library) — was
    // actually active for each source report. This matters directly:
    // a genuinely industry-specific finding belongs in that one
    // industry_contexts row, not the generic spin-context.md — a
    // third real destination the original design missed entirely.
    //
    // Deliberately using a single-level embed (team_members!owner_id)
    // plus a SEPARATE follow-up lookup for industry names, rather than
    // a deeper nested embed — presales-generate-background.js's own
    // established pattern does a manual second query for industry
    // context rather than relying on automatic nested embedding,
    // which is real evidence that betting on a deeper nested embed
    // here would be a less proven, less safe choice than matching
    // what's already confirmed to work elsewhere in this codebase.
    const reports = await supaGet(
      `reports?status=eq.complete&ai_output_detailed=not.is.null&select=id,report_type,created_at,ai_output_detailed,prospects(company_name),team_members!owner_id(user_segment,industry_context_id)&order=created_at.desc&limit=${REPORT_SAMPLE_CAP}`
    );

    // One batched follow-up query for industry names, keyed by id —
    // matches the established pattern, avoids one lookup call per report.
    const industryIds = [...new Set(reports.map((r) => r.team_members?.industry_context_id).filter(Boolean))];
    let industryNameById = {};
    if (industryIds.length) {
      const industryRows = await supaGet(`industry_contexts?id=in.(${industryIds.join(',')})&select=id,industry_name`);
      industryNameById = Object.fromEntries(industryRows.map((row) => [row.id, row.industry_name]));
    }

    if (!reports.length) {
      await supaPatch(`gleaner_reports?id=eq.${gleaner_report_id}`, {
        status: 'complete',
        reports_scanned_count: 0,
        reports_scanned_ids: [],
        output_markdown: 'No completed reports with detailed content exist yet to scan. Nothing to glean.'
      });
      return { statusCode: 200, body: 'done (nothing to scan)' };
    }

    // Real, stable identifiers per report — the short id prefix (not
    // just a sequential "Report #3" position within this one batch) so
    // a source citation stays traceable even if this exact batch is
    // never re-scanned together again, plus the actual methodology
    // (and, for Non-LMI, the specific industry variant) that was live
    // when that report was generated — this is what lets a verified
    // finding be routed to the right one of three real destinations:
    // lmi-context.md, spin-context.md, or one specific industry_contexts row.
    const reportBlock = reports.map((r, i) => {
      const typeLabel = r.report_type === 'presales_prep' ? 'Presales Prep'
        : r.report_type === 'meeting_analysis' ? 'Meeting Analysis'
        : 'Role Play Debrief';
      const company = r.prospects?.company_name ? ` — ${r.prospects.company_name}` : ' — standalone';
      const isNonLmi = r.team_members?.user_segment === 'non_lmi';
      const industryName = r.team_members?.industry_context_id ? industryNameById[r.team_members.industry_context_id] : null;
      const methodologyLabel = isNonLmi
        ? `SPIN${industryName ? ' / ' + industryName : ' / industry not set'}`
        : 'LMI';
      const shortId = r.id.slice(0, 8);
      return `### Report ${i + 1} [id: ${shortId}] — ${typeLabel}${company} — Methodology: ${methodologyLabel} — Generated: ${r.created_at.slice(0, 10)}\n${r.ai_output_detailed}`;
    }).join('\n\n---\n\n');

    const prompt = `You are reviewing a batch of ${reports.length} real, actual reports generated by a sales-coaching tool (Presales Prep, Meeting Analysis, and Role Play debriefs), looking for genuinely NEW, specific, reusable sales patterns that are worth adding to the tool's own reference material. There are THREE possible destinations for any finding, and picking the right one matters:
- lmi-context.md — for anything specific to the LMI methodology itself
- spin-context.md — for a genuinely generic SPIN-craft pattern, applicable regardless of industry
- a specific entry in the industry context library — for a finding that is genuinely specific to ONE industry, not generic SPIN craft and not LMI-specific. Each report below is labeled with the exact methodology (and, for Non-LMI reports, the exact industry variant) that was actually active when it was generated — use that label, not a guess, to decide which of the three destinations fits, and to know which industry a finding belongs to if it's destination 3.

Both lmi-context.md and spin-context.md are provided in full above as system context, for comparison — this is the exact same kind of real-transcript-derived material that built those files in the first place.

REPORTS TO REVIEW:

${reportBlock}

---

Your task: identify things actually present in these real reports — real language patterns, real objection-handling examples, real case study mentions, real named techniques, real recurring struggles worth coaching against — that are GENUINELY NOT already covered in the provided context files. Do not suggest anything already present there, even in slightly different words. Do not manufacture generic sales advice that isn't specifically grounded in something that actually appears in the reports above.

A human will review this output offline: download it, write a verdict (TRUE / FALSE / CONDITIONAL, with a brief comment if CONDITIONAL) at the end of each item, then hand the annotated file back for the verified items to actually be added. Format accordingly — one clear, self-contained bullet per finding, not grouped blocks — so each item can be independently verdicted without needing the others for context.

Respond with EXACTLY this structure:

### NEW ASSUMPTIONS BY THE GLEANER

- [LMI-CONTEXT or SPIN-CONTEXT or INDUSTRY: <exact industry name>] <the specific finding, written as a single, complete, standalone claim — concrete enough that a human can verify it's genuinely accurate and genuinely new just by reading this one line, not requiring the source report to understand it> (Source: Report [id: <the 8-character id shown for that report>], <company name or "standalone">, <methodology label exactly as shown for that report>, <its Generated date>) — Verdict: ______

Repeat one bullet per genuine finding, in exactly that format — the target tag, the claim itself, the full source citation (id, company, methodology, date — all four, not a shortened version), and the "Verdict: ______" placeholder must all be present on every bullet, in that order, so the annotated version can be read back reliably afterward, and so a verified finding can be traced back to its exact source report even in a future, separate conversation.

If you genuinely find nothing new and specific enough to be worth adding — which is a legitimate, expected outcome, especially on a small batch — say so plainly under the same header: "No new patterns found worth adding in this batch." Do not force bullets to fill space. Quality and genuine novelty matter far more than quantity here.`;

    // BUILD 4 real fix: confirmed via an actual timeout on a live run
    // — this call is genuinely larger than anything else in the app
    // (lmi-context.md + spin-context.md combined, plus up to 30 full
    // reports' detailed content stacked on top), so _lib.js's default
    // 90s timeout was simply too tight for it. This runs as a
    // background function specifically because it has room for a
    // longer single call; 240s gives real headroom for a large batch
    // without being unbounded.
    const res = await callClaude({
      system: buildCacheableSystem(LMI_CONTEXT + '\n\n---\n\n' + SPIN_CONTEXT),
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000,
      timeoutMs: 240000
    });
    await logApiUsage({ member_id: member.id, report_id: null, function_name: 'gleaner-generate-background', action: 'scan', model: res.model, claudeResponse: res });

    const outputMarkdown = extractText(res);

    await supaPatch(`gleaner_reports?id=eq.${gleaner_report_id}`, {
      status: 'complete',
      reports_scanned_count: reports.length,
      reports_scanned_ids: reports.map((r) => r.id),
      output_markdown: outputMarkdown
    });

    return { statusCode: 200, body: 'done' };
  } catch (err) {
    try {
      await supaPatch(`gleaner_reports?id=eq.${gleaner_report_id}`, {
        status: 'failed',
        error_message: 'Server error: ' + err.message
      });
    } catch (e2) { /* nothing more we can do */ }
    return { statusCode: 200, body: 'done (failed - exception)' };
  }
};
