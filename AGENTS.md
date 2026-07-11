# AGENTS.md — MPS Timesheet

> **Single source of truth: [CLAUDE.md](./CLAUDE.md) di root repo ini.**
> Baca CLAUDE.md secara penuh sebelum membuat atau mengubah kode apapun.
> **Jangan menduplikasi isi CLAUDE.md ke file ini.** File ini sengaja dibuat tipis
> supaya tidak ada dua dokumen konteks yang saling drift.

## Ringkasan minimum (detail lengkap dan mengikat ada di CLAUDE.md)

- **Monorepo:** frontend React 19 + Vite 7 + Tailwind v3 di `apps/web`; Express API (CommonJS) di `apps/api`; FastAPI di `apps/fastapi-msproject`; TTS worker di `apps/tts-worker`; ETL/SAP jobs di `jobs/`; migrasi SQL hanya di `database/migrations/`.
- **UI wajib mengikuti** "Corporate Color System" + "UI Engineering Standards" di CLAUDE.md: light theme only, **offline-first (dilarang CDN/font/aset eksternal)**, **component-first (pakai/extend komponen reusable di `apps/web/src/components/`, jangan copy-paste string className antar halaman)**.
- **`.env` tunggal di root repo** dibaca backend dan frontend. Timezone `Asia/Makassar` dari env `TIMEZONE` — jangan hardcode.
- Perintah npm frontend dijalankan dari `apps/web/`; route baru didaftarkan di `apps/web/src/router/index.jsx`.

## Riwayat

Versi lama file ini adalah salinan penuh CLAUDE.md yang sempat drift parah
(menyebut React 18, React Router v6, TanStack React Query, dan file
`TimesheetValidationPageV2.jsx` — semuanya sudah tidak benar). Jangan kembalikan
pola duplikasi itu; kalau ada informasi baru, tulis di CLAUDE.md.
