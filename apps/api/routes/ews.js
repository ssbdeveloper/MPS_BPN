const express = require("express");
const router = express.Router();
const controller = require("../controllers/ewsController");

router.get("/summary", controller.getSummary);
router.get("/stream", controller.stream);
router.get("/health", controller.getHealth);
router.get("/issues", controller.getIssues);
router.get("/actions", controller.getActions);
router.get("/kpi/:type/detail", controller.getKpiDetail);

module.exports = router;
