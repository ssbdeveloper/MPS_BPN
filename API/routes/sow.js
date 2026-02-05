const express = require("express");
const router = express.Router();
const controller = require("../controllers/sowController");

// ============================================
// PARTS ROUTES (PINDAH KE ATAS!)
// ============================================
router.get("/parts", controller.getAllParts);
router.get("/parts/search", controller.searchParts);
router.get("/parts/:id", controller.getPartById);
router.post("/parts", controller.createPart);
router.put("/parts/:id", controller.updatePart);
router.delete("/parts/:id", controller.deletePart);

// ============================================
// OPERATIONS ROUTES
// ============================================
router.get("/operations/part/:part_id", controller.getOperationsByPartId);
router.get("/operations/:id", controller.getOperationById);
router.post("/operations", controller.createOperation);
router.put("/operations/:id", controller.updateOperation);
router.delete("/operations/:id", controller.deleteOperation);

// ============================================
// BULK OPERATIONS ROUTES
// ============================================
router.post("/sow", controller.createPartWithOperations);
router.put("/sow/:id", controller.updatePartWithOperations);
router.get("/sow/complete/:id", controller.getCompleteSOW);

// ============================================
// REPORTS & STATISTICS ROUTES
// ============================================
router.get("/stats", controller.getStatistics);
router.get("/reports/drawing-usage", controller.getDrawingUsageReport);

// ============================================
// LEGACY ROUTES
// ============================================
router.get("/", controller.getAll);
router.get("/data", controller.get2data);
router.get("/datajson", controller.getDataJSON);
router.get("/mesin/:order", controller.getbymesinid);
router.get("/csv/", controller.getcsv);
router.get("/csv/:order_no", controller.getcsvbyid);
router.get("/search/:order_no/:operation_no", controller.getBySSBRAndGroup);
router.post("/", controller.create);
router.post("/createex/", controller.createexcel);
router.post("/upsert", controller.upsert);

// PUT ROUTES - SPESIFIK DULU!
router.put("/updateex/:id", controller.updateexcel);  // <-- PINDAH KE ATAS
router.put("/finish/", controller.finish);
router.put("/:id", controller.update);                // <-- GENERIC PALING BAWAH

router.delete("/:id", controller.remove);
router.get("/:order", controller.getById);            // PALING BAWAH!

module.exports = router;