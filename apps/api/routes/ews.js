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
router.put("/roster/status", roster.updateStatus);
router.get("/roster/config", roster.getConfig);
router.put("/roster/config/workday", roster.updateWorkday);
router.put("/roster/group", roster.updateGroup);
router.post("/roster/generate", roster.generate);

module.exports = router;
