# EWS Detail Page — Perbaikan (2026-07-04)

File: `apps/web/src/pages/EwsDetailPage.jsx` (rewrite penuh)

## Masalah yang ditemukan

Dengan connect ke DB produksi via Tailscale (`ews.*` di `100.86.231.55`), ditemukan:

1. **Data aktual dibuang.** Backend (`ewsController.js`) sudah menghitung breakdown kaya per KPI
   (`by_machine`, `by_operator`, `by_error_type`, `by_gap_type`, `by_loss_type`, `by_activity`,
   `totals`, `waterfall`), tapi frontend lama hanya memakai `sample_rows` mentah → tampilan
   generik & tidak menggambarkan data nyata.
2. **Issue log penuh noise (root cause).** `issue_key` dibangun memakai `window_end` (berubah tiap
   menit), jadi `ON CONFLICT` tidak pernah match → tiap refresh membuat baris baru. Ditemukan
   **423 open action** — tiap baris timesheet OT yang belum checkout ("Duration is null or
   negative") jadi 1 issue Critical, tiap sampel ping jadi 1 issue Watch.
3. Tidak ada insight/diagnosa; user tidak tahu KPI ini artinya apa atau data mana yang harus dibetulkan.

## Yang dilakukan

**Anti-noise (inti permintaan):**
- Hapus 423 baris noise di `ews.action_table` (semua machine-generated, belum pernah disentuh manusia, 0 history).
- `issue_key` sekarang **stabil per hari per entitas** (`kpi:tanggal:scope:entity`) → re-sync meng-*update*, bukan menambah.
- Issue dibuat dari entitas **teragregasi** (mesin/operator/kategori error), bukan per baris mentah.
- Gerbang anti-false-alert sesuai plan §4.2: uptime hanya escalate bila **≥6 gagal berturut**
  (ping blip tunggal diabaikan); accuracy hanya bila **≥50 record**; issue hanya dibuat saat KPI
  watch/critical (KPI normal → tidak ada issue).

**Insight & tampilan:**
- **Gauge** nilai vs target + **delta chip** vs periode sebelumnya + status badge.
- **Diagnosa cross-KPI** (plan Insight #4 & #6): mis. OEE rendah + OLE tinggi → masalah mesin;
  Adoption + OLE rendah → input issue, bukan inefisiensi nyata; Accuracy rendah → data belum bisa dipercaya.
- **Strip 5-KPI** untuk konteks & navigasi cepat antar KPI.
- **Metric tiles** headline per KPI dari `detail` nyata (ping, error, bucket, jam mesin/labor).
- **Breakdown per KPI** dari data agregat asli:
  - Uptime: uptime per mesin + kegagalan nyata (≥6 berturut).
  - Accuracy: error per kategori + hotspot mesin + hotspot operator.
  - Adoption: donut tipe gap + gap per mesin + per operator.
  - OEE: waterfall + machine time mix + OEE per mesin + loss by type.
  - OLE: mix aktivitas + OLE per operator + non-produktif per mesin.
- **"Data yang Perlu Diperbaiki"**: tabel teragregasi (sudah bebas noise) dengan kondisi, metric,
  action, dan PIC — fokus impact terbesar.
- Semua mengikuti Corporate Color System (light theme, brand blue accent), responsif tablet.

## Verifikasi
- `eslint` clean, `vite build` sukses (`EwsDetailPage-CO9cUKZw.js`, 47.7 kB).
- Tidak ada perubahan backend/route selain pembersihan data noise; issue-sync tetap pakai
  endpoint `/ews/actions/sync` yang sama (payload kini teragregasi).

## Catatan
- Perbaikan `issue_key` menghentikan noise **ke depan**. Bila muncul lagi backlog lama, jalankan:
  `DELETE FROM ews.action_table WHERE updated_by='ews-detail-page' AND action_status='Open' AND issue_key ~ '\+08:';`
