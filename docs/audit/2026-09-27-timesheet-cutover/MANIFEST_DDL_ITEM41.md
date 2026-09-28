# MANIFEST AUDIT MUTASI DDL PRODUKSI (ITEM 41)

Tanggal: 2026-09-28 00:35 WIB.
Scope: Mutasi DDL pendukung akses central RDS AWS dari plant Postgres (`5100` dan `5051`).
Status: TERVERIFIKASI pada kedua database plant.
File bukti JSON: `C:/Users/Admin/mps_cutover_20260927/manifest_ddl_item41.json`.

## Ringkasan Perubahan

Mutasi ini dilakukan untuk memungkinkan verifikasi dan publish data staging ke AWS RDS
karena host AWS RDS (`10.50.97.105`) hanya dapat dijangkau dari jaringan plant, bukan dari
workstation lokal.

| Plant | Mutasi DDL | Alasan | Status Verifikasi |
|---|---|---|---|
| 5100 & 5051 | `CREATE EXTENSION IF NOT EXISTS dblink;` | Memungkinkan query SQL langsung ke central RDS melalui user mapping yang sudah ada | Aktif (versi 1.2) |
| 5100 & 5051 | `ALTER FOREIGN TABLE public.sap_timesheet_staging ADD COLUMN IF NOT EXISTS provenance_snapshot jsonb;` | Menyesuaikan skema Foreign Table lokal dengan kolom yang ditambahkan oleh migrasi AWS `20260922_sap_staging_provenance_snapshot.sql` | Kolom `provenance_snapshot` bertipe `jsonb` ada di kedua plant |
| 5100 & 5051 | `ALTER SERVER aws_staging OPTIONS (ADD hostaddr '10.50.97.105');` | Menyediakan resolusi IP statis internal AWS VPC untuk postgres_fdw sehingga tidak bergantung pada DNS internal AWS yang tidak resolve dari luar | Opsi `hostaddr=10.50.97.105` aktif pada foreign server `aws_staging` |

## Dampak & Keamanan

- **Tidak ada data yang dihapus atau diubah** oleh mutasi ini.
- `dblink` hanya dapat digunakan oleh superuser (`tag`) atau role yang diberikan hak akses eksplisit.
- Kolom baru pada foreign table bersifat nullable (`YES`) dan hanya memetakan kolom yang sudah ada di tabel target AWS RDS.
- Penambahan opsi `hostaddr` menstabilkan koneksi FDW yang sebelumnya gagal dengan DNS resolution error.
