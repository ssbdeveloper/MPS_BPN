const express = require("express");
const router = express.Router();
const controller = require("../controllers/dashboardController");
const mpsController = require("../controllers/mpsDashboardController");

router.get("/kpi", controller.getKpi);
router.get("/order-status", controller.getOrderStatus);
router.get("/workload", controller.getWorkload);
router.get("/daily-hours", controller.getDailyHours);
router.get("/operator-efficiency", controller.getOperatorEfficiency);
router.get("/ontime-monthly", controller.getOntimeMonthly);
router.get("/progress-distribution", controller.getProgressDistribution);
router.get("/validation-rate", controller.getValidationRate);
router.get("/operator-heatmap", controller.getOperatorHeatmap);
router.get("/workcenter-list", controller.getWorkcenterList);
router.get("/operations-hub", controller.getOperationsHub);

router.get("/mps-oee-summary", mpsController.getOeeSummary);
router.get("/mps-oee-trend", mpsController.getOeeTrend);
router.get("/mps-loss-breakdown", mpsController.getLossBreakdown);
router.get("/mps-pareto-loss", mpsController.getParetoLoss);
router.get("/mps-lean-distribution", mpsController.getLeanDistribution);
router.get("/mps-snapshot", mpsController.getSnapshot);

router.get("/order-progress", controller.getOrderProgress);
router.get("/order-activity-detail/:orderNo", controller.getOrderActivityDetail);
router.get("/operation-timesheet-history", controller.getOperationTimesheetHistory);
router.post("/refresh-order-matviews", async (req, res) => {
  try { await controller.refreshOrderMatviews(); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
