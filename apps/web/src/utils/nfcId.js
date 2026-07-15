// Normalisasi NFC ID — kembaran dari apps/api/utils/nfcId.js (logika HARUS identik).
//
// Tablet (mode internal, Web NFC `event.serialNumber`) mengeluarkan hex ber-titik-dua
// little-endian terbalik: "52:ee:d9:69".
// Reader eksternal (keyboard-wedge) mengeluarkan desimal: 1775890002.
// ITU KARTU FISIK YANG SAMA — diverifikasi langsung dengan kartu asli (2026-07-14):
//   "52:ee:d9:69" -> balik byte -> 0x69D9EE52 = 1775890002  ✓
//
// Bentuk kanonik = desimal little-endian (mayoritas record lama sudah begitu).
//
// Selain menyeragamkan data, normalisasi di sisi frontend juga membuang ':' dari
// URL fetch `/usernfc/nfcid/:nfcid` — titik-dua di path itu rawan salah tafsir.

const HEX_RE = /^[0-9a-fA-F]+$/;

function looksHex(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  const hasSeparator = /[:\-\s]/.test(s);
  const hasHexLetter = /[a-fA-F]/.test(s);
  if (!hasSeparator && !hasHexLetter) return false; // digit murni -> desimal
  const hex = s.replace(/[\s:\-]/g, '');
  return HEX_RE.test(hex) && hex.length % 2 === 0 && hex.length >= 6;
}

function hexToLeDecimal(raw) {
  const hex = String(raw).replace(/[\s:\-]/g, '');
  const bytes = hex.match(/../g) || [];
  return BigInt('0x' + bytes.slice().reverse().join('')).toString();
}

/**
 * Bentuk kanonik sebuah NFC ID: desimal little-endian.
 * Nilai yang tidak dikenali (mis. "1385-D") dikembalikan apa adanya — jangan
 * merusak data yang tidak kita pahami.
 */
export function normalizeNfcId(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (looksHex(s)) return hexToLeDecimal(s);
  if (/^\d+$/.test(s)) return BigInt(s).toString(); // buang nol di depan
  return s;
}

export default normalizeNfcId;
