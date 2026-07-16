// Terjemahkan pesan mentah SAP / SKIPPED jadi sebab yang bisa ditindak.
//
// Satu sumber kebenaran: dipakai endpoint ringkasan (mengelompokkan kegagalan) DAN
// per-baris log SAP, supaya label + saran aksi konsisten di seluruh UI.
//
// Pesan FAILED datang dari SAP (Inggris/Jerman); pesan SKIPPED datang dari guard kita
// sendiri (post_sap_staging.py, sudah Bahasa Indonesia). Urutan pola PENTING —
// yang lebih spesifik diperiksa duluan.

const RULES = [
  {
    key: "needs_storno",
    label: "Perlu storno di SAP dulu",
    action: "Kiriman lama untuk segmen ini sudah masuk SAP. Storno di SAP sebelum koreksi ini dikirim.",
    test: (t) => /storno|source_key berbeda|sudah ter-?post/i.test(t),
  },
  {
    key: "burned_zid",
    label: "Nomor ZTIMESHEETID terpakai ulang",
    action: "Nomor ini sudah pernah diterima SAP (akibat reset sequence). Storno di SAP atau geser sequence.",
    test: (t) => /sudah pernah diterima sap|terpakai ulang|ztimesheetid \d+ sudah/i.test(t),
  },
  {
    key: "network",
    label: "Gangguan jaringan ke SAP",
    action: "Biasanya transien — coba lagi. Kalau berulang, cek koneksi ke SAP CPI.",
    test: (t) => /ssl|unexpected_eof|urlopen|timed? ?out|connection (reset|refused|aborted)|max retries|eof occurred|getaddrinfo|handshake/i.test(t),
  },
  {
    key: "order_lock",
    label: "Order sedang diproses SAP (lock)",
    action: "SAP mengunci order saat memproses. Coba lagi beberapa saat — posting per-order sudah serial.",
    test: (t) => /already being processed|being processed by|is locked|sapci|gesperrt|lock/i.test(t),
  },
  {
    key: "pernr_missing",
    label: "Nomor pegawai (PERNR) tidak ada di SAP HR",
    action: "Pegawai belum terdaftar di master HR SAP, atau PERNR salah. Perbaiki di sisi SAP HR (bukan di MPS2).",
    test: (t) => /personnel master record.*not found|pernr.*not found|personalnummer.*nicht|personnel number.*not/i.test(t),
  },
  {
    key: "order_teco",
    label: "Order sudah TECO / ditutup di SAP",
    action: "Order sudah ditutup teknis (TECO) — SAP menolak konfirmasi baru. Buka kembali (revoke TECO) di SAP, atau abaikan bila memang selesai.",
    test: (t) => /user status teco|status teco|teco is active|technically complete|order.*(closed|clsd)|systemstatus.*(teco|clsd)/i.test(t),
  },
  {
    key: "workcenter_missing",
    label: "Work center tidak ada di master SAP",
    action: "Master data SAP: work center belum terdaftar di plant ini. Perbaikan di sisi SAP.",
    test: (t) => /work ?cent(er|re).*(does not exist|not.*plant|tidak ada)|arbeitsplatz.*nicht/i.test(t),
  },
  {
    key: "cost_center",
    label: "Cost center / activity type belum di-set",
    action: "Baris non-M1/M2 butuh cost center di master SAP. Perbaikan di sisi SAP.",
    test: (t) => /cost ?cent(er|re)|kostenstelle|activity type only in conjunction/i.test(t),
  },
  {
    key: "period_closed",
    label: "Periode posting SAP tertutup",
    action: "Tanggal kerja jatuh di periode yang sudah ditutup SAP. Buka periode atau cek tanggal.",
    test: (t) => /posting period|period.*not open|buchungsperiode|posting date/i.test(t),
  },
  {
    key: "duplicate",
    label: "Ditolak SAP sebagai duplikat",
    action: "SAP menganggap konfirmasi ini sudah ada. Cek apakah sudah masuk; storno kalau mau kirim ulang.",
    test: (t) => /already exist|duplicate|been posted|confirmation.*exist|bereits vorhanden/i.test(t),
  },
];

const UNKNOWN = {
  key: "other",
  label: "Lainnya",
  action: "Belum dikenali — buka detail untuk lihat pesan SAP lengkap.",
};

/**
 * Klasifikasikan sebuah pesan error. Mengembalikan { key, label, action, message }.
 * `message` = baris pertama yang bermakna dari pesan mentah (untuk fallback "Lainnya").
 */
function classifySapError(rawText) {
  const text = String(rawText || "").trim();
  if (!text) {
    return { key: "none", label: "-", action: null, message: "" };
  }

  const firstLine = text.split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 240) || text.slice(0, 240);

  for (const rule of RULES) {
    if (rule.test(text)) {
      return { key: rule.key, label: rule.label, action: rule.action, message: firstLine };
    }
  }
  // "Lainnya": pakai baris pertama sebagai label supaya tetap informatif.
  return { key: UNKNOWN.key, label: firstLine || UNKNOWN.label, action: UNKNOWN.action, message: firstLine };
}

module.exports = { classifySapError };
