# TEMUAN AKAR MASALAH: KONTRAK KOLOM IS_PRODUCTIVE DI CENTRAL RDS

Tanggal: 2026-09-28 00:50 WIB.
Penulis: Hermes Cutover Runner.
File terkait:
- Skema AWS: `database/migrations/aws/20260831_sap_staging_aws_schema.sql` (baris 68)
- Test Rollback: `database/tests/timesheet/test_rollback_simulation.py` (baris 137-138)
- Runner ETL: `jobs/sap_staging/run_timesheet_etl.py` (baris 2560-2563, 2825, 2884, 2901)

## 1. Fakta Data Aktual di AWS RDS Central (`ssb_dw`)

Hasil query langsung ke central RDS membuktikan distribusi nilai kolom `is_productive`:

| source_system | zconf_type | is_productive | Jumlah Baris di Central |
|---|---|---|---|
| `MCH_HOURS` | `M1` | **true** | 795 |
| `MCH_HOURS` | `M2` | **true** | 2.256 |
| `MCH_HOURS` | `''` | **false** | 1.216 |
| `TIMESHEET` | `RG` | **false** | 14.337 |
| `TIMESHEET` | `OV` | **false** | 2.242 |
| `TIMESHEET` | `RW` | **false** | 81 |
| `TIMESHEET` | `''` | **false** | 20.491 |

**100% dari 37.151 baris data `TIMESHEET` di central berstatus `is_productive = false`.**

## 2. Penyebab (Root Cause)

1. **Definisi DDL Asli di AWS RDS:**
   ```sql
   is_productive boolean GENERATED ALWAYS AS (zconf_type = ANY (ARRAY['M1'::text, 'M2'::text])) STORED,
   ```
   Kolom ini dirancang khusus untuk entitas Machine Hours, di mana konfirmasi M1/M2 dianggap produktif.
2. **Perbedaan Asumsi antara Runner ETL dan Database:**
   - Runner `run_timesheet_etl.py` mengasumsikan `is_productive` adalah kolom bebas bertipe boolean:
     ```python
     cand_is_productive = (candidate_payload.get("confirmation_type") != "NONE") and (not candidate_payload.get("activitytype"))
     ```
     dan memasukkannya secara eksplisit ke dalam query `INSERT INTO sap_timesheet_staging (...)`.
   - Di Postgres 17 (versi AWS RDS saat ini), percobaan melakukan INSERT eksplisit ke kolom `GENERATED ALWAYS` menghasilkan error:
     `ERROR: cannot insert a non-DEFAULT value into column "is_productive"`
   - Jika nilai candidate dibandingkan dengan nilai central, `assert_semantic_contract_match` akan melempar exception:
     `mismatches.append("is_productive (central=False vs candidate=True)")`
3. **Penyebab Mengapa Lolos di Pengujian Lab:**
   Di file `database/tests/timesheet/test_rollback_simulation.py` baris 137–138, ditemukan perintah:
   ```python
   # Drop GENERATED ALWAYS expression agar sinkron dengan kontrak produksi (is_productive boolean)
   cur_c.execute("ALTER TABLE public.sap_timesheet_staging ALTER COLUMN is_productive DROP EXPRESSION IF EXISTS;")
   ```
   Author tes menduga di produksi kolom tersebut sudah berupa boolean biasa, padahal **di AWS RDS produksi, ekspresi GENERATED ALWAYS tersebut tidak pernah di-drop**.

## 3. Implikasi & Opsi Solusi

Tanpa penyesuaian, tahap F5 (`--publish`) di production **pasti gagal** saat berhadapan dengan AWS RDS central.

Dua opsi solusi:
- **Opsi A (Modifikasi Migrasi Central):** Terapkan migrasi DDL pada AWS RDS central:
  `ALTER TABLE public.sap_timesheet_staging ALTER COLUMN is_productive DROP EXPRESSION;`
  sehingga kolom menjadi boolean reguler, lalu izinkan runner mengisinya secara eksplisit.
  *(Perlu persetujuan karena mengubah DDL database central).*
- **Opsi B (Penyelarasan Runner):** Sesuaikan `run_timesheet_etl.py` agar tidak menyertakan kolom `is_productive` pada query INSERT ke central (biarkan database central menghitungnya sendiri via formula generated), dan sesuaikan assertion semantiknya agar menghormati sifat `GENERATED ALWAYS` kolom tersebut bila `source_system == 'TIMESHEET'`.
