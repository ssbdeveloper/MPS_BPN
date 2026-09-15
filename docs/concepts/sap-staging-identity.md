---
type: concept
tags: [sap, payroll, staging, domain/sap]
updated: 2026-07-14
---

# Identitas Baris SAP: kenapa `source_key` rapuh dan `segmen` tidak

## Tiga identitas yang harus dibedakan

| | Dibentuk dari | Sifat |
|---|---|---|
| `ZTIMESHEETID` | `sap_timesheet_staging.id::text` (nomor baris) | **Bukan** turunan data sumber |
| `source_key` | md5 dari 13 field bundel (jam, operator, order, operasi, mesin, dst) | **Berubah** bila resep kode ATAU data sumber berubah |
| **segmen** = `(source_row_id, bucket_start)` | proddataid + jam bucket | **Tidak pernah berubah** |

## Jebakan mematikan

SAP menolak `ZTIMESHEETID` ganda. **Itu TIDAK melindungi dari double-post**, karena
`ztimesheetid = id::text`: begitu `source_key` berubah → baris staging **baru** → `id` baru →
ZTIMESHEETID baru → SAP menganggapnya kiriman baru → **DITERIMA** → jam masuk dua kali.

Dua pemicu, efek sama:
1. **Kode**: resep md5 diubah (tambah/hapus/format field, ganti `PLANT_SSB`).
2. **Data**: `order_no` salah dikoreksi ETL → bundel lahir ulang dengan kunci beda.
   Yang salah **sudah di SAP dan tidak ditarik** — sistem ini tidak punya storno.

## Kenapa jangkarnya SEGMEN, bukan proddataid saja

Bundling **memotong satu record per jam**. Contoh nyata: proddataid `501272` berjalan
16:45→20:48 → **5 segmen → 5 bundel berbeda**. Guard yang hanya mengecek `proddataid`
akan salah men-skip 4 jam yang sah. Kunci yang benar: `(proddataid, bucket_start)`.

## Pertahanan yang terpasang (migration 20260714)

1. `sap_staging_source` — provenance tiap bundel (segmen + detik). Audit dua arah.
2. **Guard poster** — sebelum POST, cek segmen sudah ter-POST?
   `source_key` sama → skip (re-run). **Beda → KONFLIK** → `SKIPPED`, tunggu keputusan
   manusia (storno di SAP dulu, baru kirim koreksi).
3. **Unique index parsial** `WHERE posted_at IS NOT NULL` — satu segmen **mustahil**
   ter-POST dua kali. Jaminan DB, bukan disiplin manusia.
4. **Trigger pembekuan** `mch_transaction` — record yang sudah terkirim ke SAP tidak bisa
   diubah field kuncinya; percobaan dicatat ke `sap_source_change_blocked`. ETL tidak putus
   (update lain tetap lolos), tapi MPS2 **sengaja berhenti mencerminkan SQL Server** untuk
   baris terkunci — yang dipegang = versi yang sudah dibayarkan.

## Yang MASIH terbuka

- **Storno**: tidak ada mekanisme membatalkan kiriman salah di SAP. Konflik hanya
  *terdeteksi*, penyelesaiannya manual.
- Baris **non-M1/M2** (LSTAR tanpa cost center) ditolak SAP — perbaikan di sisi SAP.

**Terhubung:** [[concepts/payroll-data-path]] · [[log/2026-07-14-sap-staging-provenance]]
