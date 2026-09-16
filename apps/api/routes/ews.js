const express = require("express");
const router = express.Router();
const controller = require("../controllers/ewsController");
const roster = require("../controllers/ewsRosterController");
const requireAdmin = require("../rbac/requireAdmin");

router.get("/summary", controller.getSummary);
router.get("/trend", controller.getTrend);
router.get("/stream", controller.stream);
router.get("/health", controller.getHealth);
// ews.issue_log — backend-generated issue log, filter by KPI category
router.get("/issue-log", controller.getIssueLog);
router.put("/issue-log/:id/resolve", controller.resolveIssueLog);
router.post("/issue-log/generate", controller.generateIssueLog);
// Phase 6 — drill-through ke culprit records (read-only; issueKey di-URL-encode oleh FE)
router.get("/issue/:issueKey/records", controller.getIssueRecords);
// (legacy /issues + /actions* dipensiunkan 2026-07-12 — IL-last; ganti: /issue-log)
router.get("/kpi/:type/detail", controller.getKpiDetail);

// TTS notifications (audio pengumuman issue log)
router.get("/notifications", controller.getTtsNotifications);
router.post("/notifications/:id/played", controller.markTtsNotificationPlayed);
// Admin-only playlist untuk tombol "Putar Pengumuman" di Operations Hub (enforce keras).
router.get("/tts/playlist", requireAdmin, controller.getTtsPlaylist);

// Roster (R3): foreman roster view + status editing, config, group, generate.
router.get("/roster", roster.getRoster);
router.get("/roster/month", roster.getRosterMonth);
router.delete("/roster", roster.deleteRoster);
router.put("/roster/bulk", roster.bulkUpdateRoster);
router.put("/roster/status", roster.updateStatus);
router.put("/roster/half-day", roster.updateHalfDay);
router.get("/roster/foreman-team", roster.getForemanTeam);
router.put("/roster/foreman-team/member", roster.setForemanMember);
router.delete("/roster/foreman-team/member", roster.removeForemanMember);
router.get("/roster/config", roster.getConfig);
router.put("/roster/config/workday", roster.updateWorkday);
router.put("/roster/group", roster.updateGroup);
router.put("/roster/permanent-shift", roster.updatePermanentShift);
// Master shift (single source): jam shift + jam kerja bersih + pratinjau/resync snapshot future.
router.put("/roster/shift", roster.updateShiftMaster);
router.get("/roster/shift/impact", roster.getShiftImpact);
router.put("/roster/shift/resync-future", roster.resyncFutureShifts);
router.post("/roster/generate", roster.generate);
// Shift-lock (R3 override, Phase 1): pin operator DAY/NIGHT for N weeks. Applied by VIEW
// ews.roster_effective (readers not switched yet). set / cancel (soft, forward-only) / list.
router.post("/roster/lock", roster.setLock);
router.post("/roster/lock/:id/cancel", roster.cancelLock);
router.get("/roster/locks", roster.listLocks);

module.exports = router;
