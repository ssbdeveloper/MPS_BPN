const express = require("express");
const controller = require("../controllers/machineHoursSqlServerController");

const router = express.Router();

router.get("/health", controller.getHealth);
router.get("/", controller.getMachineHours);

module.exports = router;
