---
tags: [domain/timesheet, domain/sow]
type: plan
status: planning
---

# Planhours Guard Implementation Plan

## Goal

Tambahkan kontrol saat operator memilih job: total aktual hours dari `timesheet_transaction` dibandingkan dengan limit efektif job.

Limit efektif dihitung dari:

```text
effective_allowed_hours = original_planhours + approved_overrun_hours
```

`original_planhours` tetap berasal dari `sow.planhours` dan tidak boleh diubah oleh fitur ini. Jika butuh tambahan jam, operator membuat request overrun berisi jumlah jam tambahan dan note justifikasi. Setelah request di-approve, sistem memberi allowance tambahan di luar plan original. Tombol Start tetap block selama actual hours sudah mencapai limit efektif dan belum ada allowance approve yang cukup.

## Scope

- Database view untuk summary plan vs actual.
- API read endpoint untuk job selection memakai view baru.
- API write endpoint untuk request overrun hours.
- API approve/reject endpoint untuk overrun hours.
- UI warning di `SelectJobPage.jsx`.
- Disable tombol Start di `TimesheetMainMenuPage.jsx` variant aktif.
- Button request overrun hours di area antara Rework dan Finish.
- Email delivery disiapkan sebagai backend endpoint/queue boundary; implementasi SMTP aktual mengikuti credential email yang tersedia.

## Database

1. Buat view `public.vw_sow_plan_actual_hours`.
2. Key utama mapping:
   - `sow.order_no` atau `sow.production_order` jika ada.
   - `sow.operation_no`.
   - fallback join lama yang sudah dipakai beberapa controller: `sow.codenumber = timesheet_transaction.order_no || timesheet_transaction.operation_no`.
3. Hitung:
   - `original_planhours` dari `sow.planhours`.
   - `approved_overrun_hours` dari total request overrun yang sudah approve.
   - `effective_allowed_hours = original_planhours + approved_overrun_hours`.
   - `actualhours` dari sum `timesheet_transaction.duration`.
   - `remaining_original_hours = original_planhours - actualhours`.
   - `remaining_effective_hours = effective_allowed_hours - actualhours`.
   - `is_planhours_limited = original_planhours > 0`.
   - `is_original_plan_exhausted = original_planhours > 0 AND actualhours >= original_planhours`.
   - `is_effective_limit_exhausted = original_planhours > 0 AND actualhours >= effective_allowed_hours`.
   - `can_start = original_planhours IS NULL OR original_planhours <= 0 OR actualhours < effective_allowed_hours`.
4. Exclude row timesheet yang dibatalkan/deleted:
   - gunakan `COALESCE(state_flag::text, '') <> '5'`.
5. Buat table request overrun:
   - `public.sow_planhours_overrun_request`.
   - simpan order, operation, current original plan, current approved overrun, current actual, requested overrun hours, note, requester, status, approval fields, timestamps.
6. Status request:
   - `PENDING`
   - `APPROVED`
   - `REJECTED`
   - `CANCELLED`
7. Approved overrun yang dihitung ke limit efektif hanya request dengan status `APPROVED`.
8. Jangan update `sow.planhours` dari flow request/approval ini.

Suggested table columns:

```sql
CREATE TABLE public.sow_planhours_overrun_request (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_no TEXT NOT NULL,
  operation_no INTEGER NOT NULL,
  ssbr_id TEXT,
  workcenter TEXT,
  original_planhours NUMERIC,
  actualhours_at_request NUMERIC,
  approved_overrun_hours_at_request NUMERIC,
  requested_overrun_hours NUMERIC NOT NULL,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  requested_by_sn TEXT,
  requested_by_name TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by_sn TEXT,
  reviewed_by_name TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_sow_planhours_overrun_request_status
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT chk_sow_planhours_overrun_request_hours
    CHECK (requested_overrun_hours > 0)
);
```

## Backend API

1. Update `apps/api/controllers/sowController.js` untuk endpoint `datajson` agar join/read dari view plan actual.
2. Tambahkan endpoint request:
   - `POST /sow/planhours-overrun-request`.
3. Tambahkan endpoint approval:
   - `PUT /sow/planhours-overrun-request/:id/approve`.
   - `PUT /sow/planhours-overrun-request/:id/reject`.
3. Validasi payload:
   - `order_no`, `operation_no`, `requested_overrun_hours`, `note` wajib.
   - `requested_overrun_hours` harus numeric dan lebih besar dari 0.
   - `note` wajib agar justifikasi jelas.
4. Response endpoint job harus membawa:
   - `original_planhours`
   - `approved_overrun_hours`
   - `effective_allowed_hours`
   - `actualhours`
   - `remaining_original_hours`
   - `remaining_effective_hours`
   - `remaining_effective_seconds_before`
   - `is_planhours_limited`
   - `is_original_plan_exhausted`
   - `is_effective_limit_exhausted`
   - `can_start`
   - `pending_overrun_request_count`
5. Email:
   - siapkan helper backend yang membaca env SMTP jika ada.
   - jika SMTP belum diset, request tetap tersimpan di DB dan response memberi status `email_skipped`.
   - email dikirim saat request dibuat, dan optional saat request approve/reject.

## Frontend

1. `SelectJobPage.jsx`
   - Jika `is_original_plan_exhausted` true tapi `can_start` masih true karena ada approved overrun, tampilkan toast info/warning ringan bahwa job berjalan memakai allowance overrun.
   - Jika `is_effective_limit_exhausted` true, tampilkan toast warning: "Jam plan dan allowance tambahan telah habis".
   - Simpan flag ke `selectedactivity`.
   - Row exhausted tetap bisa dipilih agar user bisa request overrun, tapi Start nanti disable jika `can_start` false.
   - Jika `planhours` null/0, jangan munculkan warning.
2. `TimesheetMainMenuPage.jsx`
   - Variant salvaging: disable tombol Start jika `selectedactivity.can_start === false`.
   - Tampilkan reason singkat di tombol/helper state.
   - Tambahkan button "Request Hours" di antara Rework dan Finish.
   - Modal input:
     - requested overrun hours.
     - note justifikasi.
   - Submit ke `/sow/planhours-overrun-request`.
   - Setelah submit sukses, tombol Start tetap disable sampai request di-approve.
3. Variant manufacturing:
   - Minimal baca flag yang sama agar behavior konsisten jika mode manufacturing dipakai.

## Verification

- Jalankan SQL view creation di PostgreSQL via credential `.env`.
- Test query view untuk order yang punya planhours dan actualhours.
- `npm run build` di `apps/web`.
- Smoke endpoint:
  - `GET /sow/datajson?search=<order>`
  - `POST /sow/planhours-overrun-request`
  - `PUT /sow/planhours-overrun-request/:id/approve`
- Manual UI:
  - Job planhours null/0 tidak warning.
   - Job actual < plan masih bisa Start.
  - Job actual >= original plan dan belum ada approved overrun yang cukup: warning, Start disable, request button bisa submit.
  - Job actual >= original plan tapi approved overrun masih cukup: Start tetap bisa.
  - Request pending tidak membuka Start.
  - Request approved membuka Start hanya sampai batas `original_planhours + approved_overrun_hours`.
