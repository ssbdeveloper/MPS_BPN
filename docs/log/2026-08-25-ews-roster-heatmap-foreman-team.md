---
title: "EWS Roster: Heatmap Bulanan + Foreman Team (drag-drop bawahan)"
date: 2026-08-25
tags: [ews, roster, heatmap, foreman, team, drag-drop]
---

# EWS Roster Heatmap + Foreman Team (2026-08-25)

Keputusan user: 1a (warna intensitas jam), 2c (foreman = users role foreman),
4a (foreman bisa akses semua, default tim sendiri), 5a (1 operator = 1 foreman),
6a (drag-select bulk), 7a (scope default foreman=team, admin/supervisor=all).

## Backend

- Migration `20260825_ews_foreman_team.sql` (di-apply BPN + CKP): tabel
  `ews.foreman_team` (foreman_user_id → public.users.id, member_serialnumber
  UNIQUE = 1 operator 1 foreman; pindah = DELETE+INSERT dalam transaksi).
- `GET /ews/roster/month?month=YYYY-MM&scope=team|all` — semua baris sebulan +
  attendance + recorded_hours (CTE logged dari timesheet_transaction, filter
  tanggal bulan tsb). scope=team → filter `member_serialnumber IN (foreman_team
  WHERE foreman_user_id = x-user-id header)`.
- `PUT /ews/roster/bulk` `{serialnumbers[], business_dates[], status?, half_day?}`
  — UPDATE ... WHERE serialnumber = ANY($1::text[]) AND business_date =
  ANY($2::date[]); forward-only (ada tanggal < hari ini → 400).
- `GET /ews/roster/foreman-team` — foremen (users COALESCE(roles,role)='foreman',
  9 akun: AGUS.SUPRIYATNO, AHMAT, AHYADI, ERWIN, HADHI.KUSUMA, HADI.PRAYITNO,
  JUMAEDI, LUKMAN, takbir), members (+full_name dari usernfc), semua operator NFC aktif.
- `PUT/DELETE /ews/roster/foreman-team/member` — assign (move) / remove. RBAC
  feature baru `roster_foreman_team` (admin/supervisor/foreman FULL).
- Route order penting: GET `/roster/month` + GET `/roster/foreman-team` DIDAFTAR
  SEBELUM GET `/roster/config`? Tidak — semua path literal, tidak ada konflik
  dengan `/roster` (exact match Express).

## FE

- `EwsRosterPage.jsx` = HEATMAP bulanan: filter `input type=month` + ‹ ›,
  scope toggle My team/All operators (default foreman=team), operator = baris
  (sticky kiri), tanggal = kolom (sticky header, weekend bg amber-50). Warna sel:
  PRESENT → rasio recorded/required ≥100% emerald, 50-99% lime, <50% red;
  ABSENT red-200; IN_PROGRESS amber-100; LEAVE sky; SICK purple; PERMIT indigo;
  OFF slate-300; kosong slate-100. Strip atas DAY=amber / NIGHT=indigo; badge ½
  half-day. **Drag-select**: mousedown+mouseenter (rect r1c1..r2c2), mouseup
  global; 1 sel = toggle + panel detail (status, half-day, delete day); >1 sel =
  panel bulk (apply status / set half-day). Legend lengkap di bawah tabel.
- `EwsForemanTeamPage.jsx` (BARU, `/ews/foreman-team`): kiri = daftar foreman
  (card + count + YOU badge), kanan = team selected foreman (drop zone, X remove)
  + semua operator NFC (draggable, search, badge assigned-to/unassigned).
  Drag & drop HTML5 (dataTransfer text/plain = snssb). Default select foreman =
  diri sendiri (x-user-id) utk role foreman.
- Router + featureRegistry (`roster_foreman_team`) + permissionMatrix (FULL utk
  supervisor & foreman) + hubSidebarItems (menu "Foreman Team" group Production).

## Verifikasi (BPN live, test 11/11 PASS)

- month 2026-09 = 1001 rows; scope=team (x-user-id=6) → cuma 19473; unknown user
  → kosong; bulk 2 rows OFF → rows_updated 2; bulk past date → 400; assign/remove
  member OK; foremen ≥ 9; operators > 100. eslint 0 error, build OK.

## Commit

- Javanian `D:\website\MPS2` → `df3d544` (9 file; migration tidak ikut — dir
  `/database` di-ignore di repo ini, sudah di-apply langsung ke DB).
- SSB `D:\website\MPS\MPS2` → `108e2e0` (11 file termasuk migration).
