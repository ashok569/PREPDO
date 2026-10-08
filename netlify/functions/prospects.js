// PREPDO — prospects.js
// BUILD 19 | 2026-10-08
// Real bug fix in the existing 'delete' action (found by check_foreign_keys.sql):
// it deleted reports FIRST and never touched report_backups or
// iterative_research_sessions, but action_items, learnings, stalls_objections_log,
// report_backups (all pointing at reports) and iterative_research_sessions (pointing
// at the prospect) all BLOCK deletion. So deleting any prospect that had action items,
// learnings, a backup or a Guided Research session would fail. It now clears those
// first, in the same order clear-data uses (CLEAR_STEPS). clear-data is unchanged.
//
// BUILD 18 | 2026-10-02
// Privacy: clearing a prospect's data from the cloud, with a backup and a way
// back (migration_v27.sql). Three new actions:
//  - 'backup-data': read-only. Everything held for one prospect (the prospect,
//    its reports, and the rows in action_items / stalls_objections_log /
//    learnings), for the screen to turn into a downloadable CSV.
//  - 'clear-data': removes the prospect's reports and every row that points at
//    them or at the prospect (action items, stall/objection entries, learnings,
//    report backups, guided-research sessions) — children first, reports last,
//    so a foreign key can't block it. The PROSPECT ROW and its own details
//    (company, contact, notes) are deliberately left alone; it is only marked
//    data_cleared_at so the list can say "nothing on the cloud". Refused unless
//    the caller confirms they downloaded first (the server cannot see a
//    browser download — this is the honest contract, the screen enforces the
//    actual step). Allowed for the prospect's owner or a platform-level admin,
//    and for the owner only while can_clear_data is not switched off for them.
//  - 'restore-backup': loads the REPORTS from a backup back into a prospect
//    that is currently cleared — new rows, new ids, original dates kept.
//    Only into a cleared prospect with no reports (so a backup can't be loaded
//    twice or on top of live data), only finished reports of the four known
//    types, only known columns, size-capped, and all-or-nothing: if any row
//    fails, the ones already inserted by that call are removed. Action items,
//    stall/objection entries and learnings stay in the backup file but are not
//    loaded back — nothing in the app reads those tables.
// list/get also drop a stale "cleared" mark if the prospect has reports again
// (a new run started), so the badge can never lie.
//
// BUILD 17 | 2026-10-02
// Wildcard research: create now accepts and stores wildcard_query — the
// field is already fetched by presales-research-start.js (select=*), so this
// is the one piece that was missing for the setup wildcard to actually work
// end to end (app.html Build 86 already sends it).
//
// BUILD 16 | 2026-09-06
// Replaced all 5 admin-scope checks (2 list-query scopes, 3 single-
// record ownership checks) with the new shared getScopeFilter()/
// isInScope() from _lib.js — same real gap fix as everywhere else in
// this pass: these were previously binary ("my own" vs. "everyone,
// across every org"), with no way for an org_admin to see their own
// org's prospects without seeing every other org's too. The 3 single-
// record checks also needed their own select clauses widened to
// include organization_id — isInScope can't evaluate org-level scope
// on a record it was never given that column for.
//
// BUILD 15 | 2026-08-29
// Added 'list-my-roleplays' — lists ALL roleplay reports, standalone
// and prospect-tied alike, for the new Roleplay History view.
// Standalone roleplays (prospect_id null) had no prospect page to
// attach to and were genuinely invisible anywhere after the session
// ended — confirmed as a real gap from actual use, not hypothetical.
// Embeds the linked prospect's name via PostgREST's foreign-table
// syntax where one exists; comes back null for standalone sessions.
//
// BUILD 14 | 2026-08-12
// New: folder support (migration_v8.sql) — list now accepts an
// optional folder_id filter (a real folder id, the literal string
// 'unfiled' for prospects with no folder, or omitted entirely for the
// unfiltered "All Prospects" view), and a new move-to-folder action
// checks the target folder actually belongs to the requesting member
// before filing a prospect into it — a crafted request shouldn't be
// able to file into someone else's folder.
//
// BUILD 13 | 2026-08-10
// New this build: delete (with cascading cleanup of dependent rows —
// reports, action_items, stalls_objections_log, learnings — since
// Postgres foreign keys would otherwise block deleting a prospect that
// has any reports), archive/unarchive, and list now filters by the new
// archived flag so archived prospects don't clutter the main list.
// Both delete and archive/unarchive check ownership (or admin) before
// acting, matching the same access rule already used for list/get.

// /netlify/functions/prospects.js
//
// Handles Prospects: list (filtered to the logged-in user, or all for
// admins; optionally archived-only), create, get-one (with its report
// history), delete (permanent, cascades to dependent rows), archive,
// and unarchive.
//
// Request body always includes { session_token, action, ...fields }

const { getMemberFromSession, supaGet, supaPost, supaPatch, supaDelete, respond, handleOptions, getScopeFilter, isInScope } = require('./_lib.js');

const isPlatformLevel = (m) => m.key_type === 'platform_admin' || m.key_type === 'institutional_admin';
// Data actions: the prospect's owner, or a platform-level admin.
const canManageData = (member, prospect) => prospect.owner_id === member.id || isPlatformLevel(member);

// Tables whose rows must go before the reports can. [table, column that points at the PROSPECT or null, column that points at a REPORT or null]
const CLEAR_STEPS = [
  ['report_backups', null, 'report_id'],
  ['action_items', 'prospect_id', 'report_id'],
  ['stalls_objections_log', 'prospect_id', 'report_id'],
  ['learnings', 'prospect_id', 'report_id'],
  ['iterative_research_sessions', 'prospect_id', null]
];
const IN_CHUNK = 40; // ids per request, to keep URLs short

async function selectIds(table, col, ids) {
  let found = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const part = ids.slice(i, i + IN_CHUNK);
    found = found.concat(await supaGet(`${table}?${col}=in.(${part.join(',')})&select=id`));
  }
  return found;
}
async function deleteIn(table, col, ids) {
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    await supaDelete(`${table}?${col}=in.(${ids.slice(i, i + IN_CHUNK).join(',')})`);
  }
}

// Report restore: what may come back from a backup.
const RESTORABLE_TYPES = ['presales_prep', 'presales_research', 'meeting_analysis', 'role_play'];
const RESTORE_TEXT = ['confirmed_facts', 'ai_output_detailed', 'ai_output_summary', 'ai_output_extra', 'ai_output_ponder', 'ai_output_spin', 'ai_output_missed', 'ai_output_opportunities', 'ai_output_self_reflection', 'ai_output_client_perspective', 'ai_output_relationship', 'transcript_raw'];
const RESTORE_NUMBERS = ['overall_score', 'probability_of_close'];
const RESTORE_JSON = { recommended_actions: 'array', structured_data: 'object', conversation: 'array' };
const INPUT_MODES = ['transcript', 'structured', 'both'];
const MAX_RESTORE_REPORTS = 200;
const MAX_TEXT_CHARS = 1000000;
const MAX_JSON_CHARS = 2000000;

// Returns a clean row to insert, or null if this report can't / shouldn't come back.
function sanitizeReportForRestore(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  if (!RESTORABLE_TYPES.includes(r.report_type)) return null;
  if (r.status && r.status !== 'complete') return null;
  const out = { report_type: r.report_type };
  for (const f of RESTORE_TEXT) {
    const v = r[f];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string' || v.length > MAX_TEXT_CHARS) return null;
    out[f] = v;
  }
  for (const f of RESTORE_NUMBERS) {
    const v = r[f];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[f] = n;
  }
  for (const [f, kind] of Object.entries(RESTORE_JSON)) {
    let v = r[f];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return null; } }
    const okShape = kind === 'array' ? Array.isArray(v) : (v && typeof v === 'object' && !Array.isArray(v));
    if (!okShape) return null;
    if (JSON.stringify(v).length > MAX_JSON_CHARS) return null;
    out[f] = v;
  }
  if (r.meeting_number !== undefined && r.meeting_number !== null && r.meeting_number !== '') out.meeting_number = String(r.meeting_number).slice(0, 40);
  if (typeof r.meeting_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.meeting_date)) out.meeting_date = r.meeting_date.slice(0, 10);
  if (INPUT_MODES.includes(r.input_mode)) out.input_mode = r.input_mode;
  if (typeof r.created_at === 'string') {
    const t = new Date(r.created_at).getTime();
    if (Number.isFinite(t) && t <= Date.now()) out.created_at = new Date(t).toISOString();
  }
  return out;
}

// A prospect marked "cleared" that has reports again (a new run started) is no
// longer empty — drop the stale mark. Never lets a failure here break a read.
async function healClearedMarks(rows) {
  try {
    const marked = rows.filter((p) => p.data_cleared_at);
    if (!marked.length) return rows;
    const have = await supaGet(`reports?prospect_id=in.(${marked.map((p) => p.id).join(',')})&select=prospect_id`);
    const stale = new Set(have.map((r) => r.prospect_id));
    if (!stale.size) return rows;
    await supaPatch(`prospects?id=in.(${[...stale].join(',')})`, { data_cleared_at: null, data_cleared_by: null });
    return rows.map((p) => (stale.has(p.id) ? { ...p, data_cleared_at: null, data_cleared_by: null } : p));
  } catch (e) {
    return rows;
  }
}

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

  const { session_token, action } = payload;

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }

    if (action === 'list') {
      const scope = getScopeFilter(member);
      const archivedValue = payload.archived ? 'true' : 'false';
      // folder_id filtering (BUILD 32): omit entirely for "All
      // Prospects" (default, unfiltered by folder), pass a real folder
      // id to see just that folder's prospects, or pass the literal
      // string 'unfiled' to see prospects with no folder assigned.
      let folderFilter = '';
      if (payload.folder_id === 'unfiled') {
        folderFilter = '&folder_id=is.null';
      } else if (payload.folder_id) {
        folderFilter = `&folder_id=eq.${payload.folder_id}`;
      }
      const rows = await supaGet(`prospects?select=*${scope}&archived=eq.${archivedValue}${folderFilter}&order=created_at.desc`);
      return respond(200, { ok: true, prospects: await healClearedMarks(rows) });
    }

    if (action === 'list-my-roleplays') {
      // BUILD 15: standalone roleplays (prospect_id null, migration_v15
      // dropped the not-null constraint on it) have no prospect page to
      // attach to — they were genuinely invisible anywhere after the
      // session ended. This lists EVERY roleplay report, standalone and
      // prospect-tied alike, for the new dedicated Roleplay History
      // view. Embeds the linked prospect's company/contact name via
      // PostgREST's foreign-table syntax where one exists; comes back
      // null for standalone sessions, handled on the frontend.
      const scope = getScopeFilter(member);
      const rows = await supaGet(`reports?report_type=eq.role_play&select=*,prospects(company_name,prospect_name)${scope}&order=created_at.desc`);
      return respond(200, { ok: true, roleplays: rows });
    }

    if (action === 'create') {
      const { company_name, company_website, prospect_name, linkedin_url, position, meeting_objective, notes, partner_or_salesperson_name, referred_by, linkedin_paste, prospect_name_2, position_2, linkedin_url_2, wildcard_query } = payload;
      if (!company_name) {
        return respond(400, { ok: false, message: 'Company name is required.' });
      }
      const [row] = await supaPost('prospects', {
        owner_id: member.id,
        company_name,
        company_website: company_website || null,
        prospect_name: prospect_name || null,
        linkedin_url: linkedin_url || null,
        position: position || null,
        meeting_objective: meeting_objective || null,
        notes: notes || null,
        partner_or_salesperson_name: partner_or_salesperson_name || null,
        referred_by: referred_by || null,
        linkedin_paste: linkedin_paste || null,
        prospect_name_2: prospect_name_2 || null,
        position_2: position_2 || null,
        linkedin_url_2: linkedin_url_2 || null,
        wildcard_query: wildcard_query || null
      });
      return respond(200, { ok: true, prospect: row });
    }

    if (action === 'get') {
      const { prospect_id } = payload;
      if (!prospect_id) return respond(400, { ok: false, message: 'prospect_id required.' });

      const rows = await supaGet(`prospects?id=eq.${prospect_id}&select=*`);
      if (!rows.length) return respond(404, { ok: false, message: 'Prospect not found.' });

      const reports = await supaGet(`reports?prospect_id=eq.${prospect_id}&select=*&order=created_at.desc`);
      const [prospectOut] = reports.length ? await healClearedMarks(rows) : rows;
      return respond(200, { ok: true, prospect: prospectOut, reports });
    }

    if (action === 'archive' || action === 'unarchive') {
      const { prospect_id } = payload;
      if (!prospect_id) return respond(400, { ok: false, message: 'prospect_id required.' });

      const existing = await supaGet(`prospects?id=eq.${prospect_id}&select=id,owner_id,organization_id`);
      if (!existing.length) return respond(404, { ok: false, message: 'Prospect not found.' });
      if (!isInScope(member, existing[0])) {
        return respond(403, { ok: false, message: 'Not authorized.' });
      }

      await supaPatch(`prospects?id=eq.${prospect_id}`, { archived: action === 'archive' });
      return respond(200, { ok: true });
    }

    if (action === 'move-to-folder') {
      const { prospect_id, folder_id } = payload; // folder_id may be null (un-file)
      if (!prospect_id) return respond(400, { ok: false, message: 'prospect_id required.' });

      const existing = await supaGet(`prospects?id=eq.${prospect_id}&select=id,owner_id,organization_id`);
      if (!existing.length) return respond(404, { ok: false, message: 'Prospect not found.' });
      if (!isInScope(member, existing[0])) {
        return respond(403, { ok: false, message: 'Not authorized.' });
      }

      // If moving INTO a folder (not un-filing), confirm that folder
      // actually belongs to this member — otherwise a crafted request
      // could file a prospect into someone else's folder.
      if (folder_id) {
        const folderCheck = await supaGet(`folders?id=eq.${folder_id}&select=id,owner_id`);
        if (!folderCheck.length || folderCheck[0].owner_id !== member.id) {
          return respond(403, { ok: false, message: 'Not authorized to use this folder.' });
        }
      }

      await supaPatch(`prospects?id=eq.${prospect_id}`, { folder_id: folder_id || null });
      return respond(200, { ok: true });
    }

    if (action === 'delete') {
      const { prospect_id } = payload;
      if (!prospect_id) return respond(400, { ok: false, message: 'prospect_id required.' });

      const existing = await supaGet(`prospects?id=eq.${prospect_id}&select=id,owner_id,organization_id`);
      if (!existing.length) return respond(404, { ok: false, message: 'Prospect not found.' });
      if (!isInScope(member, existing[0])) {
        return respond(403, { ok: false, message: 'Not authorized.' });
      }

      // Dependent rows have to go first — Postgres foreign keys BLOCK the delete
      // otherwise. Same children-before-reports order as clear-data (CLEAR_STEPS):
      // report_backups, action_items, stalls_objections_log, learnings and
      // iterative_research_sessions all point at the prospect or its reports.
      const delReportIds = (await supaGet(`reports?prospect_id=eq.${prospect_id}&select=id`)).map((r) => r.id);
      for (const [table, prospectCol, reportCol] of CLEAR_STEPS) {
        if (prospectCol) await supaDelete(`${table}?${prospectCol}=eq.${prospect_id}`);
        if (reportCol && delReportIds.length) await deleteIn(table, reportCol, delReportIds);
      }
      await supaDelete(`reports?prospect_id=eq.${prospect_id}`);
      await supaDelete(`prospects?id=eq.${prospect_id}`);

      return respond(200, { ok: true });
    }

    if (action === 'backup-data') {
      const { prospect_id } = payload;
      if (!prospect_id) return respond(400, { ok: false, message: 'prospect_id required.' });
      const existing = await supaGet(`prospects?id=eq.${prospect_id}&select=*`);
      if (!existing.length) return respond(404, { ok: false, message: 'Prospect not found.' });
      if (!canManageData(member, existing[0])) return respond(403, { ok: false, message: 'Not authorized.' });

      const reports = await supaGet(`reports?prospect_id=eq.${prospect_id}&select=*&order=created_at.asc`);
      const [actionItems, stallsObjections, learnings] = await Promise.all([
        supaGet(`action_items?prospect_id=eq.${prospect_id}&select=*`),
        supaGet(`stalls_objections_log?prospect_id=eq.${prospect_id}&select=*`),
        supaGet(`learnings?prospect_id=eq.${prospect_id}&select=*`)
      ]);
      return respond(200, { ok: true, prospect: existing[0], reports, action_items: actionItems, stalls_objections: stallsObjections, learnings });
    }

    if (action === 'clear-data') {
      const { prospect_id, confirm_downloaded } = payload;
      if (!prospect_id) return respond(400, { ok: false, message: 'prospect_id required.' });
      const existing = await supaGet(`prospects?id=eq.${prospect_id}&select=*`);
      if (!existing.length) return respond(404, { ok: false, message: 'Prospect not found.' });
      const prospect = existing[0];
      if (!canManageData(member, prospect)) return respond(403, { ok: false, message: 'Not authorized.' });
      if (!isPlatformLevel(member) && member.can_clear_data === false) {
        return respond(403, { ok: false, message: 'Your administrator has turned off data clearing for your account.' });
      }
      if (confirm_downloaded !== true) {
        return respond(400, { ok: false, message: 'Download your reports first, and confirm you have saved them, before clearing.' });
      }

      const reportIds = (await supaGet(`reports?prospect_id=eq.${prospect_id}&select=id`)).map((r) => r.id);

      // Count first (the delete call's own return value isn't something this relies on),
      // then delete children before the reports they point at.
      const cleared = {};
      try {
        for (const [table, prospectCol, reportCol] of CLEAR_STEPS) {
          const ids = new Set();
          if (prospectCol) (await supaGet(`${table}?${prospectCol}=eq.${prospect_id}&select=id`)).forEach((r) => ids.add(r.id));
          if (reportCol && reportIds.length) (await selectIds(table, reportCol, reportIds)).forEach((r) => ids.add(r.id));
          cleared[table] = ids.size;
          if (prospectCol) await supaDelete(`${table}?${prospectCol}=eq.${prospect_id}`);
          if (reportCol && reportIds.length) await deleteIn(table, reportCol, reportIds);
        }
        cleared.reports = reportIds.length;
        if (reportIds.length) await supaDelete(`reports?prospect_id=eq.${prospect_id}`);
      } catch (err) {
        // Nothing is marked cleared, and running it again is safe.
        return respond(500, { ok: false, message: 'Could not finish clearing — some data may already have been removed. It is safe to try again. (' + err.message + ')' });
      }

      const markedAt = new Date().toISOString();
      await supaPatch(`prospects?id=eq.${prospect_id}`, { data_cleared_at: markedAt, data_cleared_by: member.id });
      return respond(200, { ok: true, cleared, data_cleared_at: markedAt });
    }

    if (action === 'restore-backup') {
      const { prospect_id, reports } = payload;
      if (!prospect_id) return respond(400, { ok: false, message: 'prospect_id required.' });
      if (!Array.isArray(reports) || reports.length === 0) {
        return respond(400, { ok: false, message: 'The backup contains no reports to load.' });
      }
      if (reports.length > MAX_RESTORE_REPORTS) {
        return respond(400, { ok: false, message: 'That backup has too many reports to load in one go.' });
      }
      const existing = await supaGet(`prospects?id=eq.${prospect_id}&select=*`);
      if (!existing.length) return respond(404, { ok: false, message: 'Prospect not found.' });
      const prospect = existing[0];
      if (!canManageData(member, prospect)) return respond(403, { ok: false, message: 'Not authorized.' });
      if (!prospect.data_cleared_at) {
        return respond(409, { ok: false, message: 'This prospect still has its data in PREPDO. A backup can only be loaded into a prospect whose data has been cleared.' });
      }
      const present = await supaGet(`reports?prospect_id=eq.${prospect_id}&select=id&limit=1`);
      if (present.length) {
        return respond(409, { ok: false, message: 'This prospect already has reports, so a backup cannot be loaded into it.' });
      }

      const clean = [];
      let skipped = 0;
      for (const r of reports) {
        const row = sanitizeReportForRestore(r);
        if (row) clean.push(row); else skipped++;
      }
      if (!clean.length) {
        return respond(400, { ok: false, message: 'None of the reports in that backup could be loaded.' });
      }
      // Oldest first, so the restored history keeps its order.
      clean.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

      const insertedIds = [];
      try {
        for (const row of clean) {
          const [created] = await supaPost('reports', {
            ...row,
            prospect_id,
            owner_id: prospect.owner_id,
            organization_id: prospect.organization_id || (prospect.owner_id === member.id ? member.organization_id : null) || null,
            status: 'complete'
          });
          insertedIds.push(created.id);
        }
      } catch (err) {
        for (const id of insertedIds) {
          try { await supaDelete(`reports?id=eq.${id}`); } catch (e) { /* best effort */ }
        }
        return respond(500, { ok: false, message: 'Could not load the backup — nothing was changed. (' + err.message + ')' });
      }

      await supaPatch(`prospects?id=eq.${prospect_id}`, { data_cleared_at: null, data_cleared_by: null });
      return respond(200, { ok: true, restored: insertedIds.length, skipped });
    }

    return respond(400, { ok: false, message: 'Unknown action: ' + action });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
