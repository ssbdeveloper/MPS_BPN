// Guard beda-unit untuk Map SAP Operation.
//
// Dipisah dari MapSapOperationPage.jsx karena file page hanya boleh meng-export
// komponen (react-refresh/only-export-components) — dan supaya logikanya bisa
// diuji tanpa me-render page.
//
// Latar: dua order bisa punya part_number, part_name, dan jumlah operasi yang
// IDENTIK (prod: SB10115AC, 48 operasi, di bawah UNIT 1 dan UNIT 2). Kartu order
// tidak menampilkan unit, jadi planner tidak punya cara membedakannya saat
// drag-drop. Akibatnya 22 baris sow_operation_task_map menunjuk subtree unit yang
// salah, dan UNIT 1 tidak pernah terbentuk sebagai bucket di halaman scheduling.

// Operasi yang ditarik berasal dari order X; task tujuan bernaung di bawah UNIT
// yang order_no-nya Y. Kalau X != Y, operasi sedang mendarat di unit yang salah.
//
// Dibandingkan sebagai kunci ternormalisasi: SAP memulas order dengan nol di depan
// ('0001000132018') sedangkan ms_project_task menyimpannya polos ('1000132018').
// Tanpa normalisasi, SETIAP drop akan dianggap beda unit dan planner belajar
// mengabaikan peringatannya — persis kegagalan yang sedang kita perbaiki.
//
// Mengembalikan null = tidak ada masalah ATAU tidak ada info unit sama sekali
// (project berbasis proses): jangan menakut-nakuti planner dengan peringatan yang
// tidak bisa ia tindaklanjuti.
export function unitMismatchOf(dragged, task) {
  if (!dragged || !task) return null;
  const unitOrder = String(task.unit_order_no || '').replace(/^0+/, '');
  const draggedOrder = String(dragged.order_no || '').replace(/^0+/, '');
  if (!unitOrder || !draggedOrder || unitOrder === draggedOrder) return null;
  return { unitName: task.unit_name || 'unit lain', unitOrder, draggedOrder };
}
