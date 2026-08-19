"use strict";

// Configuration Rules (halaman FE /config-rules).
// Menyimpan rules yang dipakai pipeline SAP di plant_config.sap_rules (JSONB):
//   {
//     "break_windows": [ {"start":"12:00","end":"13:00","days":[1,2,3,4,5,6,0]}, ... ],
//     "max_record_minutes": 90
//   }
// Python staging (jobs/sap_staging) membaca kolom yang sama — jadi simpan di sini
// = langsung berlaku untuk staging berikutnya (rebuild untuk antrian PENDING lama).

const pool = global.pool || require("../db");
const { reloadPlantConfig } = require("../config/plantConfig");

// DOW Postgres: 0=Sunday..6=Saturday. Semua 7 hari = [0,1,2,3,4,5,6].
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULT_RULES = {
  break_windows: [
    { start: "12:00", end: "13:00", days: [1, 2, 3, 4, 5, 6, 0] },
    { start: "00:00", end: "01:00", days: [1, 2, 3, 4, 5] },
    { start: "18:30", end: "19:00", days: [6, 0] },
    { start: "22:00", end: "22:30", days: [6, 0] },
  ],
  max_record_minutes: 90,
};

function normalizeRules(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const windows = Array.isArray(src.break_windows)
    ? src.break_windows
        .filter((w) => w && TIME_RE.test(String(w.start || "")) && TIME_RE.test(String(w.end || "")))
        .map((w) => ({
          start: String(w.start),
          end: String(w.end),
          days: Array.isArray(w.days)
            ? [...new Set(w.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
            : [],
        }))
        .filter((w) => w.days.length > 0)
    : [];
  const minutes = Number.parseInt(src.max_record_minutes, 10);
  return {
    break_windows: windows,
    max_record_minutes: Number.isFinite(minutes) && minutes >= 1 ? minutes : DEFAULT_RULES.max_record_minutes,
  };
}

// GET /config/rules — rules SAP (break windows + max record).
async function getConfigRules(req, res) {
  try {
    const result = await pool.query("SELECT sap_rules FROM public.plant_config WHERE id = 1 LIMIT 1");
    const raw = result.rows[0]?.sap_rules || {};
    res.json({ data: normalizeRules(raw), meta: { generated_at: new Date().toISOString() } });
  } catch (err) {
    console.error("getConfigRules error:", err);
    res.status(500).json({ error: err.message });
  }
}

// PUT /config/rules — timpa seluruh rules (break_windows + max_record_minutes).
async function putConfigRules(req, res) {
  try {
    const rules = normalizeRules(req.body);
    if (!rules.break_windows.length) {
      return res.status(400).json({ error: "At least one break window with start/end/days is required" });
    }
    const requestedBy = req.header("x-user-name") || req.header("x-user-id") || "web";
    const result = await pool.query(
      `UPDATE public.plant_config
       SET sap_rules = $1::jsonb, updated_by = $2, updated_at = now()
       WHERE id = 1
       RETURNING sap_rules`,
      [JSON.stringify(rules), requestedBy]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "plant_config row not found — seed via scripts/seed_plant_config.js" });
    }
    // Segarkan cache plantConfig supaya pembaca lain (kalau ada) dapat nilai baru.
    await reloadPlantConfig(pool).catch(() => {});
    res.json({ data: normalizeRules(result.rows[0].sap_rules), meta: { generated_at: new Date().toISOString() } });
  } catch (err) {
    console.error("putConfigRules error:", err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getConfigRules, putConfigRules, normalizeRules, DEFAULT_RULES, ALL_DAYS };
