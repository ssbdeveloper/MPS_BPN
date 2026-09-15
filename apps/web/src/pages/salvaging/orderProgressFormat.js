// Formatter angka untuk dashboard Order Progress varian Salvaging.
// Dipisah dari file komponen karena react-refresh mensyaratkan file komponen
// hanya mengekspor komponen.

export function formatNumber(value, fallback = '0') {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(number);
}
