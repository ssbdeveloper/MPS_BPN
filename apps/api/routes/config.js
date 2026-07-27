"use strict";
const express = require("express");
const router = express.Router();
const { getPublicConfig } = require("../config/plantConfig");

// GET /config — subset publik profil plant (dipakai frontend saat boot).
router.get("/", (req, res) => {
  try {
    res.set("Cache-Control", "public, max-age=60");
    res.json(getPublicConfig());
  } catch (err) {
    res.status(503).json({ error: "plant config belum siap" });
  }
});

module.exports = router;
