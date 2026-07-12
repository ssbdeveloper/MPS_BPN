# MPS Heartbeat — app Android armada tablet

App kecil (Kotlin, tanpa dependency jaringan eksternal) yang mengirim heartbeat device
tiap 60 detik ke API MPS2 → mengisi `device_status` (kondisi terkini) dan
`ews.device_heartbeat_daily` (feed KPI `uptime_tablet`).

```
App (foreground service, 60s) --POST /api/device-heartbeat (X-Device-Token)--> nginx -> Express
    Express: UPSERT public.device_status (1 baris/device)
             UPSERT ews.device_heartbeat_daily (counter beats per hari)
```

**Prinsip:** beat yang HILANG adalah sinyal downtime — tidak ada buffer/retry, tidak ada
tabel beat mentah (pelajaran dari machine_heartbeat 268 MB).

---

## Development & test lokal (iterasi harian)

1. Install **Android Studio** (sekali; membawa JDK + SDK sendiri).
2. Open folder `apps/mobile` → tunggu Gradle sync.
3. Colok tablet via USB (aktifkan *USB debugging* di Developer Options) → **Run ▶**.
   App terpasang dalam hitungan detik; log live di panel Logcat.

## APK untuk armada (distribusi)

Otomatis via GitHub Actions: setiap push yang menyentuh `apps/mobile/**` ke branch
`2b`/`main` → tab **Actions** → workflow *Build MPS Heartbeat APK* → unduh artifact
`mps-heartbeat-debug-apk`. Sideload ke tablet (izinkan *install unknown apps*).

Update armada: pasang APK versi baru di atas yang lama (data setting bertahan).
Tablet mana yang belum ter-update terlihat dari kolom `app_version` di
`GET /api/device-heartbeat/fleet`.

## Konfigurasi server (sekali)

1. `.env` server: tambah `DEVICE_HEARTBEAT_TOKEN=<token>` (dev .env sudah punya —
   samakan nilainya, atau buat baru: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`).
2. `docker-compose.yml` service api: tambah `- DEVICE_HEARTBEAT_TOKEN=${DEVICE_HEARTBEAT_TOKEN}`
   ke `environment:` — lalu rebuild api.
3. Migration `20260712_device_heartbeat.sql` sudah diterapkan via `database/migrate.js`.

## Setup di tablet (sekali per device)

1. Pasang APK → buka **MPS Heartbeat**.
2. Isi: Server base (`https://10.169.1.12/api`), nama device (mis. `TABLET-WELDING-01`),
   token (sama dengan server), interval 60.
3. **SIMPAN + START** → notifikasi "MPS Heartbeat aktif" muncul dengan status beat terakhir.
4. Matikan battery optimization untuk app ini (Settings → Battery) supaya OS tidak
   membunuh service — service punya watchdog 15 menit, tapi optimasi agresif vendor
   (Xiaomi/Oppo dll) tetap perlu whitelist manual.

## Monitoring

- `GET /api/device-heartbeat/fleet` — seluruh armada + `online` (true bila last_seen
  < 3× interval).
- `ews.device_heartbeat_daily` — uptime harian: `beats / (86400/interval_sec)`.
- KPI `uptime_tablet` EWS: **belum diaktifkan sengaja** — aktifkan setelah armada
  terpasang (kalau tidak, dashboard merah semua karena 0 device melapor). Implementasinya
  nyaris copy-paste `calculateUptimeHmi` membaca `ews.device_heartbeat_daily`.

## Keamanan (jujur, untuk tool internal)

- Autentikasi: shared token `X-Device-Token` — cukup untuk telemetri liveness internal,
  BUKAN standar untuk data sensitif. Kalau nanti app ini membawa data lebih penting,
  naikkan ke service-token per-device (lihat docs/security/AUTH_RBAC_DESIGN.md).
- Opsi "izinkan self-signed" melonggarkan TLS hanya untuk koneksi heartbeat (nginx
  internal memakai sertifikat self-signed). Risiko diterima: payload = telemetri saja.
