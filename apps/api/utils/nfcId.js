// Normalisasi NFC ID — satu sumber kebenaran untuk SELURUH backend.
// Kembarannya di frontend: apps/web/src/utils/nfcId.js (logika HARUS identik).
//
// ── MASALAH ────────────────────────────────────────────────────────────────
// Dua reader membaca kartu yang SAMA tapi berbicara dialek berbeda:
//   • Tablet (mode internal, Web NFC `event.serialNumber`) -> hex ber-titik-dua
//     little-endian terbalik, mis. "52:ee:d9:69"
//   • Reader eksternal (keyboard-wedge)                    -> desimal, mis. 1775890002
//
// DIVERIFIKASI DENGAN KARTU FISIK YANG SAMA (2026-07-14):
//   "52:ee:d9:69" -> balik urutan byte -> 69 d9 ee 52 -> 0x69D9EE52 = 1775890002  ✓
//
// Tanpa normalisasi, satu kartu = dua identitas, tergantung reader mana yang dipakai.
//
// ── BENTUK KANONIK ─────────────────────────────────────────────────────────
// Desimal little-endian, tanpa nol di depan. Dipilih karena 212 dari 231 record
// yang ada sudah dalam bentuk itu (hasil registrasi via reader eksternal).

const HEX_RE = /^[0-9a-fA-F]+$/;

/** Buang pemisah, deteksi apakah string ini HEX (bukan desimal). */
function looksHex(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return false;
  const hasSeparator = /[:\-\s]/.test(s);
  const hasHexLetter = /[a-fA-F]/.test(s);
  if (!hasSeparator && !hasHexLetter) return false; // digit murni -> desimal
  const hex = s.replace(/[\s:\-]/g, "");
  return HEX_RE.test(hex) && hex.length % 2 === 0 && hex.length >= 6;
}

/** Hex (dgn/tanpa pemisah) -> desimal little-endian. */
function hexToLeDecimal(raw) {
  const hex = String(raw).replace(/[\s:\-]/g, "");
  const bytes = hex.match(/../g) || [];
  return BigInt("0x" + bytes.slice().reverse().join("")).toString();
}

/**
 * Bentuk kanonik sebuah NFC ID: desimal little-endian.
 * Nilai yang TIDAK dikenali (mis. "1385-D", "123") dikembalikan APA ADANYA —
 * jangan pernah merusak data yang tidak kita pahami.
 */
function normalizeNfcId(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (looksHex(s)) return hexToLeDecimal(s);
  if (/^\d+$/.test(s)) return BigInt(s).toString(); // buang nol di depan
  return s;
}

/**
 * SEMUA bentuk setara dari sebuah NFC ID — untuk pencarian TOLERAN.
 *
 * Kenapa perlu: data lama tersimpan dalam 6 bentuk berbeda (desimal, desimal
 * ber-nol-depan, hex titik-dua, hex polos, dan beberapa nilai non-UID). Kalau
 * login hanya mencocokkan bentuk kanonik, operator yang kartunya terdaftar dalam
 * bentuk lama LANGSUNG TIDAK BISA ABSEN. Dengan varian, semua bentuk saling cocok.
 */
function nfcIdVariants(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  const out = new Set([s]);

  if (looksHex(s)) {
    const hex = s.replace(/[\s:\-]/g, "");
    const bytes = hex.match(/../g) || [];
    out.add(hex.toLowerCase());
    out.add(hex.toUpperCase());
    out.add(bytes.join(":").toLowerCase());
    out.add(bytes.join(":").toUpperCase());
    out.add(hexToLeDecimal(s));
  } else if (/^\d+$/.test(s)) {
    const n = BigInt(s);
    const bare = n.toString();
    out.add(bare); // tanpa nol depan

    // WAJIB: bangkitkan kembali bentuk BER-NOL-DEPAN.
    // 16 record lama tersimpan seperti "0100903404". Frontend sudah menormalkan
    // ("100903404") sebelum memanggil API, jadi bentuk aslinya HILANG di sini.
    // Tanpa padding ini, ke-16 operator itu langsung tidak bisa absen.
    for (let w = bare.length + 1; w <= 12; w++) out.add(bare.padStart(w, "0"));

    // desimal -> hex little-endian (balik lagi) supaya cocok dgn record hex lama
    const hex = bare === "0" ? "00000000" : n.toString(16).padStart(8, "0");
    const bytes = (hex.match(/../g) || []).reverse();
    out.add(bytes.join(":").toLowerCase());
    out.add(bytes.join(":").toUpperCase());
    out.add(bytes.join("").toLowerCase());
    out.add(bytes.join("").toUpperCase());
  }

  return [...out].filter(Boolean);
}

module.exports = { normalizeNfcId, nfcIdVariants, looksHex };
