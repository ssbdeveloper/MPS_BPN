# Dashboard Development Instructions

## Context
Gunakan file `CLAUDE.md` sebagai sumber utama pengetahuan dan referensi untuk project ini. Semua keputusan arsitektur, pola coding, dan standar harus mengacu ke sana.

## Task Objective
Bangun dashboard sesuai spesifikasi yang terdapat di:
`D:\website\MPS2\MPS_Dashboard_Task_Spec.md`

## Data Source
- Gunakan database PostgreSQL lokal
- Akses database melalui MCP server
- Analisis struktur database dan tentukan tabel/field yang relevan untuk memenuhi kebutuhan dashboard
- Gunakan hanya data yang benar-benar diperlukan (hindari over-fetching)

## Realtime Requirement
- Implementasikan **real-time data updates** menggunakan WebSocket
- Data diperbarui setiap detik
- Pastikan:
  - UI tetap **smooth**
  - Tidak ada flicker / kedip
  - Tidak ada layout shift
  - Gunakan state management & rendering optimization (debounce, memoization, batching jika perlu)

## Project Structure
- API backend tersedia di:  
  `D:\website\MPS2\API`
- Environment variables tersedia di:  
  `D:\website\MPS2\.env`
- Frontend (React + Vite) tersedia di:  
  `D:\website\MPS2\react-timesheet`

## Implementation Guidelines
- Tambahkan **halaman dashboard baru** di project React
- Gunakan komponen reusable
- Ikuti struktur folder yang sudah ada
- Pastikan performa optimal untuk update tiap detik
- Gunakan best practices React (hooks, separation of concerns, dll)

## Output Requirement
- Buat halaman dashboard baru
- Jelaskan dengan jelas:
  - Path file yang dibuat/diubah
  - Route untuk mengakses halaman tersebut
  - Cara menjalankan dan melihat hasilnya

## Notes
- Fokus pada performa dan user experience
- Hindari render berulang yang tidak perlu
- Pastikan kode clean dan maintainable