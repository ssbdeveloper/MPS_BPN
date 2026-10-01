---
type: log
date: 2026-10-01
tags: [domain/ops]
---

# Launcher dev lokal

Menjalankan [[planning/local-dev-launcher]]; penggunaan menetap dicatat di
[[concepts/local-dev-launcher]].

## Keputusan dan eksekusi

- Tambahkan `dev.bat`, supervisor `dev.cjs`, dan pengujian `dev.test.cjs` di root.
- Satu terminal untuk web dan API; r/w untuk restart, b untuk build, q/Ctrl+C
  untuk cleanup seluruh pohon proses yang dimiliki launcher.
- Tidak mengubah aplikasi, scripts/, dependencies, atau konfigurasi environment.
- API asli tidak dijalankan saat verifikasi karena bisa mengaktifkan job database.
- Fixture Windows dengan path berspasi memverifikasi launcher batch, log web,
  start paralel, restart API tanpa menghentikan web, restart web, build, dan
  cleanup proses anak melalui input karakter Ctrl+C. Build-only memverifikasi
  sukses serta propagasi exit code gagal. Ketiga tes lulus.
- Pengujian Ctrl+C dengan terminal interaktif fisik belum dilakukan; fixture
  mengirim karakter Ctrl+C melalui pipe. UI tablet tidak berlaku untuk tooling ini.

## Pemeriksaan akhir

- `node --check dev.cjs`: lulus.
- `node --test dev.test.cjs`: 3/3 lulus; build-only juga diuji dengan stdin ditutup.
- `cmd /d /c dev.bat build`: build web asli lulus, exit code 0. Vite melaporkan
  warning ukuran chunk dan data Browserslist lama; tidak ada kegagalan build.
- Gate dijalankan pada index khusus file launcher agar staged changes sesi lain
  tidak ikut commit. Output gate dicatat pada laporan akhir.
- Hook pre-commit tidak ditemukan pada awal sesi; dipasang dari
  `scripts/hooks/pre-commit` sesuai CLAUDE.md sebelum commit.
