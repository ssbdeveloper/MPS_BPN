title: Meal Break (activity 0000) — istirahat pribadi, tidak ke SAP, auto checkout 90 menit
date: 2026-08-31
tags: [timesheet, sap-staging, login-timesheet, meal-break]
---

# Meal Break: mode unprod baru di login-timesheet

Permintaan user 2026-08-31: (1) mode "Break" di panel unprod diganti nama
**Coffee Break** + icon coffee; (2) tambah mode **Meal Break** — istirahat makan
pribadi, activity type **0000**, TIDAK di-post ke SAP dan tidak masuk bundel SAP;
(3) auto checkout setelah **90 menit**; (4) penjelasan di panel.

Latar: istirahat makan tiap orang bisa beda waktu (tidak terikat break window
umum 11:30–13:30 di SAP staging), sehingga meal break dicatat sebagai
timesheet_transaction lokal dengan penanda `activitytype='0000'` yang
di-exclude total dari pipeline SAP.

## Perubahan

1. **FE `LoginTimesheetPage.jsx`**:
   - `UNPROD_QUICK_MODES`: `break` label → `COFFEE BREAK`; tambah
     `mealbreak: { code: '0000', label: 'MEAL BREAK' }`.
   - Panel mode unprod: tombol List Unprod jadi full-width di atas, lalu 4 quick
     mode sebaris (Briefing | Coffee Break | Meal Break | HouseKeeping) —
     grid-cols-4. Icon coffee (lucide) menggantikan icon jam; Meal Break pakai
     icon utensils (orange).
   - Footer panel: penjelasan Coffee Break (1520) dan Meal Break (0000 —
     pribadi, tidak ke SAP, auto checkout 90 menit).
   - Toast/status saat scan meal break menampilkan "auto checkout 90 menit".

2. **BE `timesheet_transactionController.js`**:
   - `MEAL_BREAK_ACTIVITY='0000'`, `MEAL_BREAK_MAX_MINUTES=90`.
   - `closeStaleMealBreaks(sn?)`: UPDATE `timesheet_transaction` — meal break
     terbuka yang `checkin + 90 menit <= NOW()` ditutup di `checkin + 90 menit`
     (longdate_checkout, date/hour_checkout, duration=1.5).
   - Dipanggil: `checkout` (sebelum update utama; kalau yang tertutup hanya meal
     break → 200 `{auto_closed_meal_break}` bukan 404), `checkoutUnprod`,
     `getbysn` (lazy close saat baca).
   - `create` produktif (activitytype kosong): tutup meal break terbuka orang
     tsb di NOW() — mode multiple tidak melakukan checkout umum, istirahat
     berakhir saat produktif dilanjutkan.
   - Interval berkala 5 menit (`setInterval(...).unref()`) menutup meal break
     terlupakan walau operator tidak pernah scan lagi.

3. **BE `jobs/sap_staging/stage_timesheet_transaction.py`**:
   - `fetch_rows` (base CTE) + `fetch_blocked_today_rows`: tambah
     `AND COALESCE(t.activitytype, '') <> '0000'` → meal break tidak pernah
     di-stage ke `sap_timesheet_staging` (tidak masuk bundel SAP) dan tidak
     muncul sebagai BLOCKED di eligibility audit.

## Verifikasi (BPN live, semua rollback-safe)

- `0000` belum ada di `ews.activity_type_ref` dan 0 baris di
  timesheet_transaction → aman dipakai sebagai penanda lokal.
- SQL auto-close: insert meal break 2 jam lalu → UPDATE menutup di
  checkin+90m, duration 1.5, date/hour checkout sesuai.
- SQL productive-start: meal break 10 menit lalu → ditutup di NOW(),
  duration 0.17h.
- PITFALL PostgreSQL: data-modifying CTE (WITH ins AS INSERT... UPDATE FROM
  ins) TIDAK melihat baris yang baru di-insert (same-snapshot) → rowcount 0.
  Kode asli memakai statement terpisah, jadi aman; jangan pakai pola CTE
  untuk tes UPDATE terhadap baris baru.
- `node --check`, `py_compile`, eslint, `npm run build` SUCCESS; dry-run
  staging (window 25-26 Agt) jalan normal.
- Endpoint: GET /timesheet/getsn/24696 → 200; PUT /timesheet/checkout tanpa
  open record → 404 (tidak ada write). POST create 0000 TIDAK dites live
  (menghindari menulis data produksi) — jalur `inferActivityType` → '0000'
  sudah terverifikasi via insert rollback.

## Commit

- dev `df10d76` (Javanian) · prod `3c00277` (SSB) — 3 file:
  `timesheet_transactionController.js`, `stage_timesheet_transaction.py`,
  `LoginTimesheetPage.jsx`.
