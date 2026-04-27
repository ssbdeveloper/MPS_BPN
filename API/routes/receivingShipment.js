const express = require("express");
const router = express.Router();
const controller = require("../controllers/receivingShipmentController");

router.get("/lookups", controller.getLookups);
router.get("/sow-components", controller.getSowComponentOptions);
router.get("/components", controller.searchComponents);
router.get("/", controller.getAll);
router.get("/:id", controller.getById);
router.post("/", controller.create);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);

module.exports = router;
