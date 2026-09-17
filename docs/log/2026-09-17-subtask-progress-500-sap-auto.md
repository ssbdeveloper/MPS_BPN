# Sub-task progress update: GET subtasks 500 (22P02 "sap-auto")

## Gejala
Panel Sub-task di Update Progress (Foreman) dan Order List kosong / gagal load.
`GET /sow/operations/:idsow/subtasks` balas 500:

```
invalid input syntax for type integer: "sap-auto"
```

Bukan sebagian — SEMUA operasi kena, karena query-nya gagal sebelum baris apa pun keluar.

## Akar masalah
`exports.getSubtasks` me-resolve nama pembuat/pengubah lewat join ke `public.users`,
dengan penjaga regex dan cast di JOIN yang sama:

```sql
LEFT JOIN public.users cu ON s.created_by ~ '^\d+$' AND cu.id = s.created_by::int
```

Postgres tidak menjamin urutan evaluasi kondisi dalam satu JOIN — planner boleh
mengevaluasi `s.created_by::int` lebih dulu. Baris autoseed SAP menyimpan
`created_by = 'sap-auto'` (lihat `20260804e_sow_sub_operation_autoseed.sql`),
jadi cast meledak dan seluruh endpoint 500.

Kolom `sow_sub_operation.created_by` adalah `varchar(100)`; isinya campur:
`'Tee San'`, `'selsabil.angelika'`, `'sap-auto'`, dan (data lama) id numerik.

## Perbaikan
1. `apps/api/controllers/sowController.js` — bandingkan sebagai TEXT, tanpa cast ke int:
   `LEFT JOIN public.users cu ON cu.id::text = s.created_by`.
   Nilai non-numerik cukup tidak match (join NULL); `CASE ... ~ '^\d+$'` tetap
   menampilkan nama untuk baris id-numerik lama dan string aslinya untuk sisanya.
2. `apps/web/src/features/progress/subtasks.jsx` — kalau refresh sub-task gagal TAPI
   masih ada data, jangan kosongkan panel: tampilkan baris + banner amber
   "showing last known data". Panel merah penuh hanya saat benar-benar tidak ada data.
3. `apps/web/src/pages/ProgressUpdatePage.jsx` — normalkan sub-task dari payload
   hierarki (`progress_pct`, tanpa `order_no`) ke bentuk yang dibaca `SubTaskRow`
   (`progress`), supaya baris fallback tidak menampilkan progress kosong.

## Verifikasi
- Query resolver dijalankan ke DB prod (read-only): 892 baris aktif, 0 error.
- `getSubtasks` dipanggil langsung untuk operasi ber-`sap-auto` dan non: 200 semua.
- Jalur tulis (history insert + update progress + rollup + weights) diuji dalam
  transaksi yang di-ROLLBACK: sukses, tidak ada data yang berubah.
- Test baru: `apps/api/controllers/sowSubtaskList.contract.test.js` (larang cast
  `created_by::int` muncul lagi) + kasus "fetch sub-task gagal" di
  `ProgressUpdatePage.test.jsx`.
- `npm test` api 66/66, `vitest run` web 97/97, `vite build` sukses.

## Jangan diulang
Jangan pernah cast kolom teks bebas ke `int`/`numeric` di dalam JOIN/WHERE dengan
mengandalkan penjaga regex di predikat yang sama. Bandingkan ke sisi teks
(`users.id::text = kolom_teks`), atau saring dulu lewat subquery/CTE.
