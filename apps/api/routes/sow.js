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

// ── Sub-task Excel import: keep file in memory (parsed then discarded) ────────
const uploadMem = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_MIMES.has(file.mimetype));
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
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
router.get("/standard/component/:component_id/templates", controller.getSowTemplatesByComponent);
router.delete("/standard/component/:component_id", controller.deleteSowStandardComponent);
router.post("/templates",                        controller.createTemplate);
router.put("/templates/:templateId",             controller.updateTemplate);
router.delete("/templates/:templateId",          controller.deleteTemplate);
router.get("/standard/operation/:id",    controller.getSowStandardById);
router.post("/standard/operation",       controller.createSowStandardOperation);
router.put("/standard/operation/:id",    controller.updateSowStandardOperation);
router.delete("/standard/operation/:id", controller.deleteSowStandardOperation);

// ── Attachments ───────────────────────────────────────────────────────────────
router.get("/standard/operation/:id/attachments",               controller.getAttachments);
router.post("/standard/operation/:id/attachments", upload.array('files', 10), controller.uploadAttachments);
router.delete("/standard/attachment/:attachmentId",             controller.deleteAttachment);

// ── NNVA (Non-Value-Added Activity) ────────────────────────────────────────────
router.get("/nnva/base",                          controller.getNnvaBase);
router.post("/nnva/base",                         controller.createNnvaBase);
router.put("/nnva/base/:id",                      controller.updateNnvaBase);
router.delete("/nnva/base/:id",                   controller.deleteNnvaBase);
router.get("/nnva/standard/:standardId",          controller.getNnvaByStandard);
router.put("/nnva/standard/:standardId",          controller.saveNnvaToStandard);

// ── Dropdown lookups ───────────────────────────────────────────────────────────
router.get("/customers",                          controller.getCustomers);
router.get("/components",                         controller.getComponents);
router.get("/documentnos",                        controller.getSowDocumentNos);
router.post("/documentnos",                       controller.createSowDocumentNo);

// ── Operation Card persistence ─────────────────────────────────────────────────
router.get("/operationcard/:standardId",          controller.getOperationCard);
router.post("/operationcard/:standardId",         controller.saveOperationCard);

// ============================================
// GROUPED ORDERS VIEW (for OrderListPage)
// ============================================
router.get("/grouped", controller.getGrouped);
router.get("/getrow/:id", controller.getRowById);
router.post("/create", controller.createFromBuilder);

// ============================================
// SOW HISTORY / REVISION EDITOR
// ============================================
router.get("/history-rows", controller.getSowHistoryRows);
router.get("/history-export", controller.exportSowHistoryRows);
router.get("/history-orders", controller.getSowOrderOptions);
router.get("/history-order/:orderNo", controller.getSowOrderForRevision);
router.put("/history-order/:orderNo/info", controller.saveSowOrderInfo);
router.put("/history-order/:orderNo", controller.saveSowOrderRevision);
router.get("/revision-history/:orderNo", controller.getSowRevisionHistory);

// ============================================
// PENANDA SUBCONT (Fase 6 — docs/MFG_PLAN_AREA_PLAN.md §4 Fase 6 / D4)
// Label saja: workcenter tidak disentuh, jadwal tetap ada, jamnya keluar dari beban internal.
// WAJIB terdaftar DI ATAS route generic `/:order`, `/:id` di bagian LEGACY paling bawah —
// kalau tidak, GET /sow/subcont-marks akan tertelan getById dengan order = "subcont-marks".
// ============================================
router.get("/subcont-marks", controller.listSowSubcontMarks);
router.post("/subcont-marks", controller.createSowSubcontMark);
router.delete("/subcont-marks/:order_no/:operation_no", controller.deleteSowSubcontMark);

// ============================================
// PROGRESS UPDATE HISTORY
// ============================================
router.get("/progress-history/:idsow", controller.getProgressHistory);
router.post("/progress-history", controller.addProgressUpdate);

// ============================================
// SUB-OPERATION / CHILD-TASK (manufaktur physical-progress rollup)
// docs/MFG_SUBOPERATION_PROGRESS_PLAN.md — child progress rolls up to sow.progress
// ============================================
router.get("/operations/:idsow/subtasks",     controller.getSubtasks);
router.post("/operations/:idsow/subtasks",    controller.createSubtask);
router.put("/subtasks/:subId",                controller.updateSubtask);
router.post("/subtasks/:subId/progress",      controller.addSubtaskProgress);
router.get("/subtasks/:subId/progress-history", controller.getSubtaskProgressHistory);
// Excel import (preview via commit=false, apply via commit=true) — memoryStorage
router.post("/subtasks/import", uploadMem.single('file'), controller.importSubtasks);

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
