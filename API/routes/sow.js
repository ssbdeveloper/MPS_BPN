const express = require("express");
const router  = express.Router();
const path    = require('path');
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');
const controller = require("../controllers/sowController");

// ── Multer config: store files at /uploads/sow-pdf/{uuid}.{ext} ──────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/sow-pdf');
    require('fs').mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, `${uuidv4()}${ext}`);
  },
});
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_MIMES.has(file.mimetype));
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

// ============================================
// SOW STANDARD — flat list (legacy)
// ============================================
router.get("/standard", controller.getSowStandard);

// ============================================
// SOW STANDARD — grouped by component
// ============================================
router.get("/standard/grouped",          controller.getSowStandardGrouped);
router.get("/standard/component/:component_id", controller.getSowStandardByComponent);
router.get("/standard/operation/:id",    controller.getSowStandardById);
router.post("/standard/operation",       controller.createSowStandardOperation);
router.put("/standard/operation/:id",    controller.updateSowStandardOperation);
router.delete("/standard/operation/:id", controller.deleteSowStandardOperation);

// ── Attachments ───────────────────────────────────────────────────────────────
router.get("/standard/operation/:id/attachments",               controller.getAttachments);
router.post("/standard/operation/:id/attachments", upload.array('files', 10), controller.uploadAttachments);
router.delete("/standard/attachment/:attachmentId",             controller.deleteAttachment);

// ============================================
// GROUPED ORDERS VIEW (for OrderListPage)
// ============================================
router.get("/grouped", controller.getGrouped);
router.get("/getrow/:id", controller.getRowById);

// ============================================
// PROGRESS UPDATE HISTORY
// ============================================
router.get("/progress-history/:idsow", controller.getProgressHistory);
router.post("/progress-history", controller.addProgressUpdate);

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
// PLANHOURS LOOKUP
// ============================================
router.get("/planhours", controller.getPlanhours);
router.post("/planhours/multi", controller.getPlanhoursMulti);

// ============================================
// LEGACY ROUTES
// ============================================
router.get("/", controller.getAll);
router.get("/data", controller.get2data);
router.get("/ssbr/:ssbr_id/:group", controller.getByIdent);
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