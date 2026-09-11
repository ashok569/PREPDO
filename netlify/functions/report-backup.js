// PREPDO — report-backup.js
// BUILD 1 | 2026-09-06
// New file. Per-report data-privacy backup: download → confirm-delete
// → (optionally, later) restore, with a real random token — generated
// the same way session tokens already are (generateToken/hashToken in
// _lib.js) — embedded in the exported data itself, not just the
// filename, and re-checked against report_backups (migration_v19.sql)
// on every step. A mismatched or already-used token is a hard reject,
// not a soft warning — this is what makes the "only you can restore
// your own backup" rule actually enforceable, not just a naming
// convention.
//
// Three actions:
//   'download'      — issues a token, returns the full report data
//                      with it embedded, for the frontend to save as
//                      a file (same client-side pattern already used
//                      for Full Data Backup — no server-side file
//                      generation here either).
//   'confirm-delete' — requires a matching, still-'issued' token for
//                      this exact report; without one, deletion is
//                      refused outright. This enforces "you must have
//                      a real backup before you can delete," not just
//                      suggest it.
//   'restore'        — requires a matching, still-'deleted' token.
//                      Normally restorable only by whoever downloaded
//                      it; an org_admin/platform_admin CAN restore on
//                      a departed user's behalf, but this is recorded
//                      distinctly (restored_on_behalf=true), never
//                      silently treated as identical to a normal
//                      self-restore.
//
// Scoping on 'download' and 'confirm-delete' uses isInScope() (same
// shared helper as prospects.js/roleplay-turn.js) — an org_admin can
// only back up / delete reports within their own org, never another
// org's, even though they CAN restore across a seat within their own
// org on someone's behalf.

const crypto = require('crypto');
const { getMemberFromSession, supaGet, supaPost, supaPatch, supaDelete, respond, handleOptions, isInScope } = require('./_lib.js');

function generateBackupToken() {
  return crypto.randomBytes(32).toString('base64url');
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

    if (action === 'download') {
      const { report_id } = payload;
      if (!report_id) return respond(400, { ok: false, message: 'report_id is required.' });

      const rows = await supaGet(`reports?id=eq.${report_id}&select=*`);
      if (!rows.length) return respond(404, { ok: false, message: 'Report not found.' });
      const report = rows[0];

      if (!isInScope(member, report)) {
        return respond(403, { ok: false, message: 'Not authorized.' });
      }

      const download_token = generateBackupToken();
      await supaPost('report_backups', {
        report_id: report.id,
        download_token,
        downloaded_by: member.id,
        organization_id: report.organization_id || null,
        status: 'issued'
      });

      // The token travels embedded INSIDE the data the frontend saves
      // as a file — not the filename, which the user can freely
      // rename without affecting anything.
      return respond(200, { ok: true, backup: { download_token, report } });
    }

    if (action === 'confirm-delete') {
      const { report_id, download_token } = payload;
      if (!report_id || !download_token) {
        return respond(400, { ok: false, message: 'report_id and download_token are both required.' });
      }

      const rows = await supaGet(`reports?id=eq.${report_id}&select=*`);
      if (!rows.length) return respond(404, { ok: false, message: 'Report not found.' });
      const report = rows[0];

      if (!isInScope(member, report)) {
        return respond(403, { ok: false, message: 'Not authorized.' });
      }

      // The core enforcement: deletion is refused outright without a
      // matching, still-'issued' backup token for THIS exact report —
      // not just discouraged by a confirmation dialog.
      const backupRows = await supaGet(`report_backups?report_id=eq.${report_id}&download_token=eq.${download_token}&status=eq.issued&select=id`);
      if (!backupRows.length) {
        return respond(400, { ok: false, message: 'No matching, unused backup found for this report. A valid backup must be downloaded before deletion is allowed.' });
      }

      await supaDelete(`reports?id=eq.${report_id}`);
      await supaPatch(`report_backups?id=eq.${backupRows[0].id}`, {
        status: 'deleted',
        deleted_at: new Date().toISOString()
      });

      return respond(200, { ok: true });
    }

    if (action === 'restore') {
      const { download_token, report_data } = payload;
      if (!download_token || !report_data) {
        return respond(400, { ok: false, message: 'download_token and report_data are both required.' });
      }

      const backupRows = await supaGet(`report_backups?download_token=eq.${download_token}&status=eq.deleted&select=*`);
      if (!backupRows.length) {
        return respond(400, { ok: false, message: 'This backup token is not valid — it may have already been restored, or this file does not match a real backup issued by this system.' });
      }
      const backup = backupRows[0];

      const isSelfRestore = backup.downloaded_by === member.id;
      const isAuthorizedOnBehalf = Boolean(
        member.key_type === 'platform_admin' ||
        (member.key_type === 'org_admin' && member.organization_id && backup.organization_id === member.organization_id)
      );

      if (!isSelfRestore && !isAuthorizedOnBehalf) {
        return respond(403, { ok: false, message: 'This backup belongs to a different user, and you are not authorized to restore it on their behalf.' });
      }

      // Deliberately reuses the original report's own id (the row was
      // deleted, not the id retired) — nothing else in the schema
      // holds a foreign key to an individual report, so this is safe,
      // and it means anything that once referenced this report by id
      // (e.g. a past Gleaner run's reports_scanned_ids) still points
      // to something real after a restore.
      const restoredReport = { ...report_data, id: backup.report_id };
      await supaPost('reports', restoredReport);

      await supaPatch(`report_backups?id=eq.${backup.id}`, {
        status: 'restored',
        restored_at: new Date().toISOString(),
        restored_by: member.id,
        restored_on_behalf: !isSelfRestore
      });

      return respond(200, { ok: true, restored_on_behalf: !isSelfRestore });
    }

    return respond(400, { ok: false, message: `Unknown action: ${action}` });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
