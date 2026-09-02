"use strict";

// Single source of truth timezone aplikasi.
// Prioritas: env TIMEZONE (dari .env per deployment — fleksibel) → plant_config.timezone
// (fallback) → default. Divalidasi IANA agar aman diinterpolasi ke SQL.
//
// Revisi 2026-09-02 (keputusan owner): SEMULA plant_config dulu (design
// PLANT_CONFIG_VARIANT_DESIGN). plant_config Cikupa ter-seed Asia/Makassar padahal
// Cikupa = WIB — API ikut WITA sedangkan stager Python (env TIMEZONE) sudah WIB.
// Env-first mencegah pergeseran diam-diam kalau baris plant_config salah/stale, dan
// menyalakan plant baru cukup set TIMEZONE di .env. plant_config tetap di-seed benar
// sebagai fallback + kebenaran untuk konsumen DB (lihat config/plantConfig.js).

const DEFAULT_TIMEZONE = "Asia/Makassar";
const IANA_ZONE = /^[A-Za-z][A-Za-z_+-]*(?:\/[A-Za-z][A-Za-z0-9_+-]*)+$/;

function validTz(raw) {
  const s = String(raw || "").trim();
  return IANA_ZONE.test(s) ? s : null;
}

function resolveTimezone() {
  const fromEnv = validTz(process.env.TIMEZONE);
  if (fromEnv) return fromEnv;
  try {
    const { getPlantConfig } = require("./plantConfig");
    const fromConfig = validTz(getPlantConfig().timezone);
    if (fromConfig) return fromConfig;
  } catch (_) { /* plantConfig belum dimuat — lanjut ke default */ }
  return DEFAULT_TIMEZONE;
}

module.exports = { resolveTimezone, DEFAULT_TIMEZONE };
