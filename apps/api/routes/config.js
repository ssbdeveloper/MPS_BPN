"use strict";
const express = require("express");
const router = express.Router();
const { getPublicConfig } = require("../config/plantConfig");
const {
  getConfigRules,
  putConfigRules,
  getActivityCatalog,
} = require("../controllers/configRulesController");

// GET /config — subset publik profil plant (dipakai frontend saat boot).
router.get("/", (req, res) => {
  try {
    res.set("Cache-Control", "public, max-age=60");
    res.json(getPublicConfig());
  } catch (err) {
    res.status(503).json({ error: "plant config belum siap" });
  }
});

// GET/PUT /config/rules — rules pipeline SAP (break windows + max record).
// Read tidak di-enforce RBAC (konvensi: manifest hanya untuk write); halaman
// FE di-guard oleh feature `config_rules` di rbac/featureRegistry + permissionMatrix.
router.get("/rules", getConfigRules);
router.put("/rules", putConfigRules);

// GET /config/activity-catalog — jenis aktivitas (mch_statustypes + ews.activity_type_ref)
// sebagai sumber baris "Max Record Duration" di FE.
router.get("/activity-catalog", getActivityCatalog);

module.exports = router;
