---
title: Tombol download template upload sub-task (progress-update)
date: 2026-08-06
tags: [domain/sow, fe, ux]
---

# Tombol download template di modal import sub-task

## Permintaan

User tanya di mana template Excel upload sub-task di page progress-update.
Ternyata UI hanya menampilkan nama file sebagai teks ("Pakai template
sub_task_upload_template.xlsx") tanpa link download, dan file template hanya
ada di `samples/excel/` (tidak di `public/templates/`).

## Perubahan

- Copy `samples/excel/sub_task_upload_template.xlsx` →
  `apps/web/public/templates/sub_task_upload_template.xlsx` (bisa diakses via
  URL `/templates/sub_task_upload_template.xlsx`, ikut ter-copy ke dist/).
- `features/progress/SubTaskImport.jsx`: export `SubTaskTemplateLink`
  (tombol link `Template` + icon Download) + barrel `features/progress/index.js`.
- `pages/ProgressUpdatePage.jsx`: render `<SubTaskTemplateLink />` di header
  (sebelah tombol "Upload Excel") — SELALU terlihat, tidak perlu pilih file
  dulu. Catatan: percobaan pertama menaruh link di footer modal import,
  tapi modal hanya terbuka SETELAH pilih file (chicken-and-egg) — dipindah
  ke header.

## Verifikasi

- ESLint 0, `vite build` SUCCESS.
- `dist/templates/sub_task_upload_template.xlsx` ada (11797 bytes, sama
  dengan samples).
- Dev server Vite: `GET /templates/sub_task_upload_template.xlsx` → HTTP 200.
- Browser: header `/progress-update` menampilkan `Template` link di samping
  `Upload Excel` + `Refresh`.
