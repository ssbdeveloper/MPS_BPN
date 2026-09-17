# Cleanup mapping drift se-DB & optimasi `/sow-scheduling/map`

Tanggal: 2026-09-17
Status: SELESAI — cleanup prod committed, kode diuji dan siap deploy.

## 1. Cleanup `sow_operation_task_map` se-DB

Owner meminta cleanup seluruh DB setelah analisa UNIT Rock Bucket.

### Klasifikasi sebelum delete

Audit awal menemukan **62** baris di mana identitas mapping tidak persis sama dengan
identitas task saat ini:

- **22 order drift**: `mapping.order_key != task.order_no`
- **40 operation-only difference**: order sama, tetapi `operation_key != task.operation_no`

Penting: 40 operation-only difference TIDAK otomatis korup. Mayoritas adalah mapping
legacy yang sah ke task rework/cutting/inspection yang `operation_no`-nya kosong.
Menghapus semua 62 akan menghancurkan 40 assignment valid. Karena itu cleanup hanya
menyasar 22 order drift. Satu task tidak mungkin sekaligus dimiliki dua order berbeda;
mapping tersebut tidak aman dan harus dilepas untuk remap sadar.

### Prosedur fail-closed

Script auditable:

`database/maintenance/2026-09-17-clean-mapping-order-drift.js`

Safety:

- dry-run secara default; mutasi hanya dengan `--apply`
- abort kecuali live count tepat **22**
- backup JSON sebelum transaksi
- DELETE mengulang predicate mismatch yang sama
- verifikasi 0 mismatch di dalam transaksi sebelum COMMIT
- operation-only difference sengaja tidak disentuh

Backup apply (disimpan di luar repo):

`C:/Users/Admin/AppData/Local/Temp/mps2-mapping-backups/2026-09-17T13-04-43-347Z-sow-operation-task-map-order-drift.json`

- rows: 22
- SHA-256: `819BFCAF724C6066676DD9524ADE6D6EAE737FF7C86C943FB3D186A1F556CD9E`

Hasil transaksi:

```text
Order-drift rows: 22
COMMITTED — detached 22 unsafe mappings; 0 order drift remains.
```

Verifikasi independen sesudah COMMIT:

```json
{"total":"2110","order_drift":"0","op_only":"40"}
```

Artinya 22 mapping lintas-order sudah dilepas, sementara 40 mapping legacy dengan
order benar tetap dipertahankan.

## 2. Root cause page map terasa lemot

Pengukuran ulang menunjukkan latency 33–39 detik yang pernah terlihat bukan biaya
intrinsik query saat ini (kemungkinan koneksi/plan sementara). Baseline aktual prod:

- empty pool, 361 order: 217–513 ms
- exact order `1000132018`: 204–560 ms pada pengukuran awal
- broad part/text: 82–110 ms pada cache hangat

Dua masalah nyata tetap ditemukan:

1. Exact numeric order tetap memakai enam wildcard `LIKE '%q%'`, padahal index
   normalized order sudah tersedia.
2. Debounce FE 250 ms hanya mencegah request yang belum dimulai. Request lama yang
   sudah dikirim tidak dibatalkan, sehingga response lambat dapat tiba belakangan
   dan menimpa hasil search terbaru (UI terasa lambat/salah).

## 3. Optimasi yang diterapkan

### Backend: indexed exact-order fast path

`listSowOrders` kini mengklasifikasikan query:

- numeric >= 7 digit → exact normalized order equality
- numeric pendek → broad search (tetap bisa mencari operation number)
- teks/alphanumeric → broad search (part name, part number, operation text,
  workcenter, dll.)

Predicate exact disamakan persis dengan expression index prod:

```sql
ltrim(coalesce(s.order_no, ''), '0') = ltrim($1, '0')
```

`EXPLAIN (ANALYZE, BUFFERS)` membuktikan `Bitmap Index Scan` memakai
`idx_sow_order_key_operation_idsow`; SOW scan selesai **0.212 ms**.

Benchmark end-to-end service setelah fix (5 kali, median):

- exact `1000132018`: **82 ms** (min 74, max/cold 292)
- zero-padded `0001000132018`: **80 ms**
- exact + tab counts: **148 ms**
- broad part: **83 ms**
- broad text `bucket`: **110 ms**, hasil tetap 3 order

### Frontend: latest request wins

`MapSapOperationPage` sekarang:

- meng-abort request search sebelumnya dengan `AbortController`
- mengabaikan `AbortError` (bukan error user)
- memakai sequence guard agar `finally` request lama tidak mematikan loading request baru
- membatalkan request aktif saat page unmount

Jadi response lama tidak dapat lagi menimpa hasil query terbaru.

## 4. Verifikasi

- API: **77/77 pass**
- Web: **104/104 pass**
- ESLint folder map: clean
- `node --check services/msProjectService.js`: pass
- Vite production build: pass
- Contract prod: exact, zero-padded, broad part, broad text semuanya mempertahankan hasil
- Cleanup prod: **0 order drift** tersisa

Warnings build/test yang tampil (`window.scrollTo` jsdom, browserslist lama, chunk >500
kB, NODE_ENV dari `.env`) adalah warning pre-existing dan tidak menyebabkan failure.
