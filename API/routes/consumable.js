const express = require("express");
const router = express.Router();
const controller = require("../controllers/consumableController");

router.get("/history", controller.getHistory);
router.get("/history/:sn", controller.getHistory);
router.get("/stock", controller.searchStock);
router.get("/control", controller.getControlTickets);
router.patch("/control/:id/approve", controller.approveTicket);
router.patch("/control/:id/close", controller.closeTicket);
router.patch("/control/items/:itemId/quantity", controller.adjustItemQuantity);
router.patch("/control/items/:itemId/reject", controller.rejectItem);
router.post("/request", controller.createRequest);

module.exports = router;
