# PENJELASAN SELISIH 431 STAGING BALIKPAPAN (4.366 VS 4.797)

Tanggal: 2026-09-28 00:25 WITA / 2026-09-27 23:25 WIB.
Penulis: Hermes Cutover Runner.
Verifikasi: query central RDS AWS via dblink plant 5051 (`ptssb`), tersimpan di
`C:/Users/Admin/mps_cutover_20260927/s1_5051_pending_basis.json`.

## Kesimpulan

**Tidak ada 431 record timesheet yang hilang atau anomali.**
Angka **4.797** adalah total seluruh baris berstatus `PENDING` di tabel AWS
`public.sap_timesheet_staging` untuk plant Balikpapan (`werks = '5051'`) dengan
tanggal kerja `isdd >= '20260923'`, yang terdiri dari **DUA sistem sumber yang berbeda**:

| source_system | Jumlah Baris (PENDING, werks='5051', isdd >= 20260923) | Total Detik | Min ISDD | Max ISDD | Keterangan |
|---|---|---|---|---|---|
| `TIMESHEET` | **4.366** | 10.408.799 s (2.891,33 jam) | 20260923 | 20260927 | Antrean timesheet operator hasil staging legacy worker |
| `MCH_HOURS` | **431** | 841.568 s (233,77 jam) | 20260923 | 20260927 | Antrean jam mesin dari `stage_machinehours.py` |
| **TOTAL** | **4.797** | 11.250.367 s | 20260923 | 20260927 | Angka yang muncul bila `source_system` tidak difilter |

## Bukti SQL

```sql
SELECT source_system,
       count(*)::bigint AS n,
       sum(total_seconds)::bigint AS secs,
       min(isdd) AS min_d,
       max(isdd) AS max_d
  FROM sap_timesheet_staging
 WHERE werks = '5051'
   AND status = 'PENDING'
   AND isdd >= '20260923'
 GROUP BY 1
 ORDER BY 1;
```

Hasil aktual dari central RDS:
```
 source_system |  n   |   secs   |  min_d   |  max_d
---------------+------+----------+----------+----------
 MCH_HOURS     |  431 |   841568 | 20260923 | 20260927
 TIMESHEET     | 4366 | 10408799 | 20260923 | 20260927
(2 rows)
```

## Analisis Baris MCH_HOURS (431 baris)

- `source_ref_id`: seluruhnya bernilai kosong (`''`), karena jam mesin diagregasi per bundel
  (bukan per individual timesheet record).
- Relasi ke `sap_staging_source`: mencakup **1.929 segmen sumber**, dengan total 841.568 detik.
- Created at: 2026-09-23 s.d. 2026-09-27.
- Updated at: 2026-09-27 23:15:33+08 (tersentuh oleh scheduler/worker machine-hours BPN).
- Tabel `sap_timesheet_staging` dipakai bersama untuk dua jenis data (timesheet orang dan
  machine hours). Query rekonsiliasi wajib selalu menyertakan `source_system = 'TIMESHEET'`.
