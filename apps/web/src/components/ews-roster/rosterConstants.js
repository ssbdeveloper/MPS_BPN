// Konstanta dan helper bersama untuk halaman roster. Dipisah dari komponen agar file
// komponen hanya mengekspor komponen (aturan react-refresh/only-export-components).

export const STATUS_OPTIONS = ['SCHEDULED', 'LEAVE', 'SICK', 'PERMIT', 'SITE_VISIT', 'OFF'];
export const EXCUSED = ['LEAVE', 'SICK', 'PERMIT', 'SITE_VISIT', 'OFF'];

export function todayLocalISO() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}
