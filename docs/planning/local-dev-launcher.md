---
type: plan
status: done
tags: [domain/ops]
---

# Launcher pengujian lokal

Permintaan: satu launcher Windows untuk menjalankan web (`npm run dev` di
`apps/web`) dan API (`node server.js` di `apps/api`), berhenti dengan Ctrl+C,
restart API, dan build web tanpa membuka terminal tambahan.

## Ruang lingkup dan dampak

Tambahkan `dev.bat` dan supervisor Node bawaan `dev.cjs` di root. Tidak ada
dependensi baru atau perubahan kode aplikasi, scripts/, konfigurasi, dan `.env`.
Launcher mewarisi konfigurasi proses seperti perintah manual. Restart dan stop
hanya menargetkan pohon proses yang dibuat launcher, bukan semua proses Node.
Build menghasilkan artefak web sesuai perintah npm yang sudah ada.

## Langkah

1. Tambahkan launcher dan supervisor: start paralel, kontrol keyboard, cleanup.
2. Tambahkan `dev.test.cjs` untuk memeriksa proses dummy terisolasi, restart,
   build, exit error, dan cleanup anak proses.
3. Catat penggunaan di [[concepts/local-dev-launcher]], sesi di
   [[log/2026-10-01-local-dev-launcher]], dan baris [[PLANNING]].
4. Stage hanya file sesi ini, jalankan tes launcher dan gate; satu commit tooling.

## Verifikasi

Uji dengan fixture sementara, termasuk path berspasi, agar API asli tidak
memulai job terhadap database yang dikonfigurasi. Jalankan pemeriksaan sintaks
dan gate staged. Pengujian halaman tablet tidak berlaku karena tidak ada UI
yang berubah. Pemeriksaan Ctrl+C pada terminal interaktif dibedakan dari input
Ctrl+C fixture melalui pipe. Tidak menjalankan server API asli dalam verifikasi.
