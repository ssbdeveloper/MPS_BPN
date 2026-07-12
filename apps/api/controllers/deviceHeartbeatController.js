// Device heartbeat — tablet/HP armada POST liveness ke sini (app apps/mobile).
// Desain meniru pelajaran machine_heartbeat: TANPA tabel beat mentah.
//   - device_status                : 1 baris per device (kondisi terkini), upsert tiap beat
//   - ews.device_heartbeat_daily   : 1 baris per (work_date, device), counter beats
//     -> sumber KPI uptime_tablet (bentuk kembar ews.machine_heartbeat_daily)
// Autentikasi: shared token X-Device-Token vs env DEVICE_HEARTBEAT_TOKEN
// (device anonim seperti alur tablet NFC; route ada di RBAC ALLOWLIST).
const db = global.pool || require("../db");
const { resolveTimezone } = require("../config/timezone");

exports.beat = async (req, res) => {
  const expected = process.env.DEVICE_HEARTBEAT_TOKEN;
  if (!expected) {
    // Fail-fast konsisten S-R1: tanpa token terkonfigurasi, endpoint menolak semua.
    return res.status(503).json({ error: "DEVICE_HEARTBEAT_TOKEN belum di-set di server" });
  }
  if (req.headers["x-device-token"] !== expected) {
    return res.status(401).json({ error: "invalid device token" });
  }

  const {
    device_id,
    device_name,
    app_version,
    android_version,
    model,
    battery_pct,
    charging,
    ip,
    interval_sec,
  } = req.body || {};

  if (!device_id || typeof device_id !== "string" || device_id.length > 64) {
    return res.status(400).json({ error: "device_id required" });
  }
  const interval = Math.min(Math.max(parseInt(interval_sec, 10) || 60, 15), 3600);
  const tz = resolveTimezone();

  try {
    await db.query(
      `INSERT INTO public.device_status
         (device_id, device_name, app_version, android_version, model,
          battery_pct, charging, ip, interval_sec, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (device_id) DO UPDATE SET
         -- COALESCE: beat parsial tidak boleh menghapus nilai terakhir yang diketahui
         device_name     = COALESCE(EXCLUDED.device_name,     device_status.device_name),
         app_version     = COALESCE(EXCLUDED.app_version,     device_status.app_version),
         android_version = COALESCE(EXCLUDED.android_version, device_status.android_version),
         model           = COALESCE(EXCLUDED.model,           device_status.model),
         battery_pct     = COALESCE(EXCLUDED.battery_pct,     device_status.battery_pct),
         charging        = EXCLUDED.charging,
         ip              = COALESCE(EXCLUDED.ip,              device_status.ip),
         interval_sec    = EXCLUDED.interval_sec,
         last_seen       = now()`,
      [
        device_id,
        String(device_name || "").slice(0, 100) || null,
        String(app_version || "").slice(0, 20) || null,
        String(android_version || "").slice(0, 20) || null,
        String(model || "").slice(0, 100) || null,
        Number.isFinite(+battery_pct) ? Math.round(+battery_pct) : null,
        charging === true,
        String(ip || "").slice(0, 45) || null,
        interval,
      ]
    );

    // Counter harian: beats++ dan expected dihitung dari interval (86400/interval).
    // uptime_pct harian = beats/expected — dihitung saat dibaca, bukan disimpan ganda.
    await db.query(
      `INSERT INTO ews.device_heartbeat_daily (work_date, device_id, beats, interval_sec)
       VALUES ((now() AT TIME ZONE $2)::date, $1, 1, $3)
       ON CONFLICT (work_date, device_id) DO UPDATE SET
         beats        = ews.device_heartbeat_daily.beats + 1,
         interval_sec = EXCLUDED.interval_sec,
         updated_at   = now()`,
      [device_id, tz, interval]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("[device-heartbeat]", err.message);
    return res.status(500).json({ error: "internal" });
  }
};

// GET ringkas untuk dashboard/monitoring: kondisi seluruh armada.
exports.fleet = async (_req, res) => {
  try {
    const r = await db.query(
      `SELECT device_id, device_name, model, app_version, battery_pct, charging, ip,
              interval_sec, last_seen,
              (now() - last_seen) < make_interval(secs => interval_sec * 3) AS online
       FROM public.device_status
       ORDER BY online DESC, device_name NULLS LAST`
    );
    return res.json(r.rows);
  } catch (err) {
    console.error("[device-heartbeat fleet]", err.message);
    return res.status(500).json({ error: "internal" });
  }
};
