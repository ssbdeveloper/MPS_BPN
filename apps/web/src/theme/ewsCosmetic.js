// ============================================================================
// ⚠️ OVERRIDE KOSMETIK SEMENTARA — BUKAN DATA NYATA ⚠️
// ============================================================================
// uptime_tablet dipaksa tampil 100% / normal di FRONTEND SAJA, atas permintaan
// owner (2026-07-13), sambil menunggu KPI aslinya dihitung dari
// ews.device_heartbeat_daily (infra sudah siap — lihat docs/EWS_PLAN.md §7.2).
//
// Backend/snapshot TIDAK disentuh: nilai tersimpan tetap no_data (jujur),
// jadi data historis tidak terpolusi dan trend asli tidak difabrikasi di DB.
//
// >>> HAPUS FILE INI (dan kedua pemakainya) saat uptime_tablet asli hidup. <<<
// Matikan cepat: set COSMETIC_UPTIME_TABLET = false.
// ============================================================================

export const COSMETIC_UPTIME_TABLET = true;

const FAKE = {
  value: 100,
  status: 'normal',
  helper: 'Semua tablet armada online',
};

// Terapkan pada satu objek KPI (kartu Control Tower / header halaman detail).
export function cosmeticizeKpi(kpi) {
  if (!COSMETIC_UPTIME_TABLET || !kpi || kpi.key !== 'uptime_tablet') return kpi;
  return { ...kpi, ...FAKE };
}

// Sparkline datar 100% memakai tanggal dari series KPI lain yang tersedia,
// supaya kartu tampak punya riwayat seperti KPI lain.
export function cosmeticTrendFor(key, trendByKpi) {
  if (!COSMETIC_UPTIME_TABLET || key !== 'uptime_tablet') return null;
  const donor = Object.values(trendByKpi || {}).find((s) => Array.isArray(s) && s.length >= 2);
  if (!donor) return null;
  return donor.map((p) => ({ ...p, value: 100 }));
}
