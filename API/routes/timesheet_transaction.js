const express = require("express");
const router = express.Router();
const controller = require("../controllers/timesheet_transactionController");

router.get("/", controller.getAll);
router.get("/search", controller.search);
router.get("/validation-stats", controller.validationStats);
router.get("/validation-group/:serialnumber", controller.validationGroupRecords);
router.get("/getsn/:snkaryawan", controller.getbysn);
router.get("/getid/:id", controller.getbyid);
router.get("/nama/:nama", controller.getbyname);
router.get("/getcsv", controller.getcsv);
router.get("/getexcel", controller.getxlsx);
router.post("/", controller.create);
router.put("/validation", controller.bulkValidation);
router.put("/updateadmin/:id", controller.updateTimesheetadmin);
router.put("/checkout", controller.checkout);
router.put("/checkoutid/", controller.checkoutid);
router.patch("/:tsnumber", controller.partialUpdate);
router.delete("/:id", controller.remove);

module.exports = router;
///:serialnumber