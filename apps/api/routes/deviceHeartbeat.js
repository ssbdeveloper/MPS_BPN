const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/deviceHeartbeatController");

router.post("/", ctrl.beat);     // dipanggil app Android (X-Device-Token)
router.get("/fleet", ctrl.fleet); // monitoring armada (read)

module.exports = router;
