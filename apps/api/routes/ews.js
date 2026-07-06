const express = require("express");
const router = express.Router();
const controller = require("../controllers/ewsController");
const roster = require("../controllers/ewsRosterController");

router.get("/summary", controller.getSummary);
router.get("/trend", controller.getTrend);
router.get("/stream", controller.stream);
router.get("/health", controller.getHealth);
router.get("/issues", controller.getIssues);
router.get("/actions", controller.getActions);
router.post("/actions/sync", controller.syncActions);
router.put("/actions/:id/resolve", controller.resolveAction);
router.get("/kpi/:type/detail", controller.getKpiDetail);

// Roster (R3): foreman roster view + status editing, config, group, generate.
router.get("/roster", roster.getRoster);
router.put("/roster/status", roster.updateStatus);
router.get("/roster/config", roster.getConfig);
router.put("/roster/config/workday", roster.updateWorkday);
router.put("/roster/group", roster.updateGroup);
router.post("/roster/generate", roster.generate);

module.exports = router;
