---
title: "Offline LAN hardening + analisa performa"
date: 2026-08-13
tags: [offline, LAN, TTS, piper, gzip, performa]
---

# Offline LAN hardening + analisa performa (A-2026-08-13)

## 1. Audit dependensi internet (runtime)

Hasil grep menyeluruh FE + API + jobs + workers:

| Komponen | Temuan | Status |
|---|---|---|
| FE (index.html, src, CSS) | 0 referensi eksternal | ✅ |
| FE workbox | rule fonts.googleapis/gstatic (mati) | ❌ dihapus |
| `backuptc.html` (template) | link Google Fonts, TIDAK dipakai (app pakai travel-card.html) | ❌ dihapus |
| API (services/controllers/routes/jobs) | 0 outbound HTTP (axios/fetch = 0) | ✅ |
| SAP staging/ETL | DB-to-DB PostgreSQL, tanpa HTTP | ✅ |
| fastapi-msproject | bersih | ✅ |
| .env | semua localhost/LAN | ✅ |
| **tts-worker** | **edge-tts (cloud Microsoft) — BUTUH INTERNET** | ❌ diganti Piper |

Satu-satunya fitur yang butuh internet = EWS TTS audio (edge-tts). Sisanya
100% offline.

## 2. Ganti TTS → Piper (offline)

- `generate_ews_audio.py` (worker EWS): hapus jalur edge-tts, engine tetap
  Piper lokal — model `models/id_ID.onnx` (+ .json) sudah ada sejak Juli.
- `preview_ews_tts.py` (alat test): edge → Piper (sync, tanpa asyncio).
- `requirements.txt`: hapus `edge-tts==7.2.7`; tambah
  `audioop-lts; python_version >= "3.13"` (pydub butuh audioop yang dihapus
  dari stdlib 3.13+).
- `docker-compose.yml` (ews-tts-worker): hapus `EWS_TTS_ENGINE=edge`,
  `EWS_TTS_VOICE`, `EWS_TTS_EDGE_RATE`.
- Verifikasi lokal (Windows): `piper.exe` (dari pip piper-tts) + model
  id_ID.onnx + ffmpeg (imageio-ffmpeg) → MP3 23KB OK, tanpa internet.
- Catatan: `tts_gen.py`/`tts_generate.py`/`tts.bat` = alat PC pribadi (bukan
  server) — sengaja dibiarkan edge (user pakai di PC yang ada internet).

## 3. Analisa performa LAN

### Pengukuran (API lokal, window peta 1 bulan)

- `GET /ms-project/bay-schedules` → **1.096.626 bytes (~1,1 MB)**, ~0.5-0.8s.
- `GET /ms-project/sow-orders?counts=true` → 44 KB.
- DB query (EXPLAIN ANALYZE): **9,6 ms** — DB bukan bottleneck (planner
  mengangkat EXISTS order_known/is_subcont jadi scan tunggal).
- **Gzip TIDAK aktif di API maupun nginx** → 1,1 MB dikirim mentah tiap
  buka halaman scheduling area.

### Penyebab lambat (urut kepentingan)

1. **Payload API 1 MB+ tanpa gzip** — `listBaySchedules` mengembalikan semua
   reservasi dalam window peta (bounds) setiap load.
2. **Bundle JS/CSS besar tanpa gzip** — chunk 400–530 KB (peringatan vite).
3. Banyak request saat buka halaman (bay-schedules + sow-orders + counts).
4. Render React ribuan baris di klien (bukan jaringan).

### Perbaikan yang diimplementasi

- `server.js`: middleware `compression` (gzip semua respons JSON) → terukur
  **1.096.626 B → 69.648 B (15,7×)**, data utuh (1154 rows, order_known).
- `nginx.conf` (web): `gzip on` + types → bundle JS/CSS ~30% ukuran asli.

### Rekomendasi lanjutan (di luar repo)

- **nginx luar (host/proxy utama)**: aktifkan `gzip`, `http2` (di layer TLS),
  `keepalive` ke upstream API, `client_max_body_size` sesuai. Repo hanya berisi
  nginx container FE (statis).
- Kalau WiFi kantor padat: pertimbangkan kurangi window fetch
  (WINDOW_BACK/FORWARD_DAYS di SchedulingAreaPage) atau kirim field ringkas
  untuk baris jadwal.
- PWA sudah NetworkFirst untuk /api (cache 5 menit) — load ulang cepat.

## File

- `apps/tts-worker/generate_ews_audio.py`, `preview_ews_tts.py`,
  `requirements.txt` (commit fd8b07b)
- `docker-compose.yml` (fd8b07b)
- `apps/web/src/templates/backuptc.html` (hapus), `apps/web/vite.config.js`
  (9440d05)
- `apps/api/server.js`, `apps/api/package.json` + lock, `apps/web/nginx.conf`
  (3525eca)
