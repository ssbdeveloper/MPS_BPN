---
tags: [decision-log, domain/ews]
date: 2026-07-22
topic: KPI uptime_hmi — dari rata-rata harian per mesin → state HIDUP per device HMI
---

# 2026-07-22 — Uptime HMI: ukur kondisi SEKARANG, bukan rata-rata sejak tengah malam

## Masalah (keluhan owner)

KPI kartu **Uptime HMI** tidak bereaksi saat device mati. Sebabnya bukan bug pengetikan,
tapi **definisi metriknya**: `calculateUptimeHmi` membaca `ews.machine_heartbeat_daily`
(agregat harian per mesin dari SSB_OEE `MachineHeartbeat`), lalu me-rata-rata
`uptime_pct` harian tiap mesin.

Akibat aritmatikanya:

- Penyebut = SELURUH ping mesin itu sejak jam 00:00. Box mati jam 12.00 hanya menggeser
  KPI ~**0,03 poin/menit**.
- Lebih buruk: **tidak pernah pulih** di hari yang sama. Device nyala lagi jam 13.00,
  angka harian tetap tercemar 1 jam mati sampai ganti hari.
- Lag data 5 menit (daemon `sync_machine_heartbeat.py` interval 300 detik).

Jadi kartu "health" itu justru paling lambat memberi tahu bahwa armada sedang sakit.

## Keputusan

**Sumber pindah** ke `public.mch_machine_ping_log` (sudah live di Postgres, ping tiap
~60 detik, 4 ICMP per baris) dan **grain pindah ke device HMI**, bukan mesin.

Fakta yang mendasari (diverifikasi di prod, bukan asumsi):

- 1 box HMI = 1 IP = beberapa mesin. **9 IP menaungi 36 mesin** (4+5+5+5+2+3+4+5+3).
  Ping worker menulis **satu baris per device per siklus**, termasuk saat gagal
  (`success_count = 0`, status DOWN) — jadi device mati tetap muncul, tidak hilang
  dari penyebut.
- Rumus: ambil **baris ping TERAKHIR** tiap device → nilai 100 (terjangkau) / 0 → rata-rata.
  Satu box mati = **−11,1 poin seketika**, dan kembali 100% begitu menjawab lagi.

Pilihan yang SENGAJA diambil (dan alasannya):

1. **Biner, bukan rasio paket.** Baris dengan 3/4 ICMP tetap dihitung UP. Kalau pakai
   rasio, satu paket hilang = −2,8 poin di armada 9 device → status `critical` (band
   <98) hanya karena jitter. Data 7 hari: 803 baris 3/4 vs 3.124 baris 0/4 — noise-nya
   nyata, jadi tidak boleh masuk KPI.
2. **Titik baca = `bounds.window_end` (dibatasi `now()`)**, bukan `now() - 24 jam`.
   Satu kode melayani semua pemanggil: window live membaca kondisi sekarang, bounds
   "previous" membaca kondisi di akhir window itu. Delta EWS jadi "HMI hilang/kembali
   sejak titik itu", bukan membandingkan dua rata-rata harian yang beda arti.
3. **Ada guard kesegaran** (`EWS_UPTIME_HMI_FRESH_MINUTES`, default 10). Kalau ping
   worker sendiri yang mati, KPI **no_data** + helper "cek machine-ping-worker" —
   BUKAN 100% palsu. Window di luar retensi log dibedakan pesannya.
4. **Issue/TTS di-debounce** `EWS_UPTIME_HMI_DOWN_STREAK` (default 3 siklus ≈ 3 menit).
   KPI-nya sengaja bereaksi seketika, tapi alarm tidak boleh berbunyi untuk blip satu
   siklus ping.

## Bukti uji (read-only, terhadap DB prod)

| Skenario | Hasil |
|---|---|
| Sekarang (22-Jul 12:23) | `100` · normal · `9/9 HMI online` |
| Insiden 20-Jul (3 box mati 19,5 jam) | `66.7` · **critical** · `6/9 HMI online · 14 mesin terdampak` |
| Tanggal di luar retensi ping log | `null` · no_data · pesan retensi (bukan 100% palsu) |

Metrik lama untuk hari yang sama (20-Jul) hanya melaporkan **86,32%** — 3 box mati
seharian tersamar jadi "kurang 14 poin", dan hari ini kembali 100% seolah tak terjadi apa-apa.

## Efek samping yang disengaja

- **Issue jadi per device, bukan per mesin.** Insiden 20-Jul dulu melahirkan **14 issue**
  (satu per mesin) + 14 antrian TTS untuk **3 box** yang mati. Sekarang 3 issue,
  `scope_type = 'device'`, entity = IP, daftar mesin terdampak ada di deskripsi.
- Env lama `EWS_UPTIME_HMI_MIN_PINGS` / `_WARNING_PCT` / `_CRITICAL_PCT` **tidak dipakai lagi**
  (band lama tak punya arti untuk metrik biner).
- Ambang KPI tidak diubah (normal ≥99): di armada 9 device, satu box mati = 88,9% →
  langsung critical. Itu memang yang diminta.
- `ews.machine_heartbeat_daily` **tidak dihapus** — daemon syncnya jalan terus dan tabel
  tetap jadi satu-satunya rekam jejak uptime harian tingkat mesin.

## Belum dikerjakan (sadar, bukan lupa)

- **Halaman detail `/ews/uptime_hmi` masih kosong** — `KpiBreakdown` tidak punya cabang
  `uptime_hmi` (sudah begitu sejak sebelum perubahan ini). Backend kini mengirim
  `source_detail.by_device` (9 baris siap pakai: ip, is_up, down_streak, mesin terdampak).
  Sisa kerjanya tinggal komponen tabel. Sementara ini, device yang mati tetap terlihat
  lewat Issue Log.
- **Issue tidak menutup sendiri saat device pulih** — model issue_log memang per hari
  (auto-resolve saat ganti hari), sama seperti semua kategori lain. Tidak diubah sendirian.

## Deploy note

Rebuild service `api` + `frontend`. **Tidak ada migration.** Nilai KPI langsung berubah
begitu API baru jalan (snapshot job tiap 60 detik yang menuliskannya).

## Berkas

- `apps/api/services/ewsCalculator.js` — `calculateUptimeHmi` ditulis ulang + 2 konstanta env
- `apps/api/services/ewsIssueGenerator.js` — `generateUptimeHmi` per device + debounce streak
- `apps/api/controllers/ewsController.js` — `source_detail` uptime_hmi → `by_device`
- `apps/web/src/pages/EwsDetailPage.jsx` — `unit: 'machine'` → `'device'`
