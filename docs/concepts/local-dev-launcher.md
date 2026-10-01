---
type: concept
tags: [domain/ops]
---

# Menjalankan web dan API lokal

Dari root repo, jalankan `dev.bat` (PowerShell: `./dev.bat`). Launcher menjalankan
`node server.js` dengan cwd `apps/api` dan `npm run dev` dengan cwd `apps/web`.
Log kedua layanan muncul di satu terminal. Path repo boleh mengandung spasi.

Kontrol langsung tanpa Enter pada terminal interaktif:

| Tombol | Perintah |
|---|---|
| `r` | Hentikan API yang dibuat launcher, lalu jalankan ulang |
| `w` | Hentikan web yang dibuat launcher, lalu jalankan ulang |
| `b` | `npm run build` di apps/web; kedua server tetap berjalan |
| `h` | Tampilkan bantuan |
| `q` / Ctrl+C | Hentikan seluruh proses milik launcher, termasuk build |

`dev.bat build` hanya menjalankan build web dan mengembalikan exit code build.
`dev.bat help` menampilkan bantuan tanpa memulai layanan. Vite tetap menyediakan
hot reload; rebuild bukan syarat setiap perubahan frontend.

Windows memakai `taskkill /PID <pid> /T /F` untuk menghentikan pohon proses
milik launcher. Ini penghentian paksa, bukan graceful shutdown API. Proses Node
lain di luar launcher tidak ditargetkan. Menutup paksa terminal atau mematikan
supervisor dari Task Manager tidak memiliki jaminan cleanup yang sama.

Launcher mewarisi environment dan konfigurasi aplikasi yang sudah ada. Tidak
memilih database lokal secara otomatis; job dan koneksi API sama dengan
menjalankan `node server.js` secara manual. Tidak menjalankan tunnel atau install
dependensi otomatis.

## Asal-usul

[[planning/local-dev-launcher]] · [[log/2026-10-01-local-dev-launcher]]
