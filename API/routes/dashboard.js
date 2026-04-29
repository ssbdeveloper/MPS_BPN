const express = require("express");
const router = express.Router();
const controller = require("../controllers/dashboardController");

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

module.exports = router;
