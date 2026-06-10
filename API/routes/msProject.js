const express = require("express");
const router = express.Router();
const controller = require("../controllers/msProjectController");

router.get("/health", controller.health);

router.get("/projects", controller.listProjects);
router.post("/projects/bulk-load", controller.bulkLoadProjects);
router.get("/projects/:project_id/package", controller.getProjectPackage);
router.post("/projects", controller.publishProject);
router.post("/projects/:project_id/checkout", controller.checkoutProject);
router.post("/projects/:project_id/heartbeat", controller.heartbeatProject);
router.put("/projects/:project_id/sync", controller.syncProject);
router.post("/projects/:project_id/publish", controller.publishCurrentRevision);
router.post("/projects/:project_id/checkin", controller.checkinProject);
router.post("/projects/:project_id/force-checkin", controller.forceCheckinProject);

router.get("/calendars", controller.listCalendars);
router.post("/calendars/refresh-from-shifts", controller.refreshCalendarsFromShifts);
router.get("/calendars/:calendar_id", controller.getCalendar);

router.get("/resources/conflicts", controller.getConflicts);
router.get("/resources", controller.searchResources);
router.post("/resources/refresh", controller.refreshResources);

router.get("/projects/:project_id/resources", controller.getProjectResources);
router.post("/projects/:project_id/resources", controller.addProjectResources);
router.delete("/projects/:project_id/resources/:resource_id", controller.deactivateProjectResource);

module.exports = router;
