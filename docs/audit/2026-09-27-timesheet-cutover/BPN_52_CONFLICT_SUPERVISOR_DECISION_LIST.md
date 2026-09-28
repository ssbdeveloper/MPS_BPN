# DAFTAR KEPUTUSAN KONFLIK OVERLAP BALIKPAPAN (PLANT 5051)
Total Kluster: 52 | Total Record: 121 tsnumber | Seluruhnya saat ini berstatus PENDING di legacy staging central

### Kasus BPN-C01 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000131758` | **Operation**: `160`
- **Max Overlap**: `2700.00` detik
- **Detail Record**:
  * `tsnumber`: **173426** | Workcenter: `M5051T31` | Durasi: `2700`s | [2026-09-22 22:15:00+07:00 s.d. 2026-09-22 23:00:00+07:00]
  * `tsnumber`: **173427** | Workcenter: `M5051CP3` | Durasi: `6540`s | [2026-09-22 22:15:00+07:00 s.d. 2026-09-23 00:04:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C02 — Pola: WORKCENTER_TRANSITION
- **Operator**: `50410` | **Order**: `1000131646` | **Operation**: `190`
- **Max Overlap**: `600.00` detik
- **Detail Record**:
  * `tsnumber`: **173457** | Workcenter: `M5051T31` | Durasi: `2400`s | [2026-09-23 00:00:00+07:00 s.d. 2026-09-23 00:40:00+07:00]
  * `tsnumber`: **173460** | Workcenter: `M5051CP2` | Durasi: `9000`s | [2026-09-23 00:30:00+07:00 s.d. 2026-09-23 03:00:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C03 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000131522` | **Operation**: `180`
- **Max Overlap**: `600.00` detik
- **Detail Record**:
  * `tsnumber`: **173613** | Workcenter: `M5051T31` | Durasi: `1800`s | [2026-09-23 02:10:00+07:00 s.d. 2026-09-23 02:40:00+07:00]
  * `tsnumber`: **173614** | Workcenter: `M5051CP3` | Durasi: `1800`s | [2026-09-23 02:30:00+07:00 s.d. 2026-09-23 03:00:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C04 — Pola: PROVEN_DUPLICATE_SCAN
- **Operator**: `52592` | **Order**: `1000128210` | **Operation**: `140`
- **Max Overlap**: `43.13` detik
- **Detail Record**:
  * `tsnumber`: **173884** | Workcenter: `M5051WM3` | Durasi: `43`s | [2026-09-23 08:18:19.117011+07:00 s.d. 2026-09-23 08:19:02.250911+07:00]
  * `tsnumber`: **173885** | Workcenter: `M5051WM3` | Durasi: `39`s | [2026-09-23 08:18:19.116795+07:00 s.d. 2026-09-23 08:18:58.436755+07:00]
  * `tsnumber`: **173886** | Workcenter: `M5051WM3` | Durasi: `2563`s | [2026-09-23 08:18:19.121144+07:00 s.d. 2026-09-23 09:01:02.517797+07:00]
- **Bukti & Analisis**: Operator melakukan scan checkin ganda/berulang pada detik yang hampir identik (< 5 detik) di workcenter yang sama.
- **Rekomendasi / Pilihan**: **BATALKAN scan terpendek**, pertahankan record dengan checkout riil.

### Kasus BPN-C05 — Pola: WORKCENTER_TRANSITION
- **Operator**: `2763-M` | **Order**: `1000131522` | **Operation**: `180`
- **Max Overlap**: `900.00` detik
- **Detail Record**:
  * `tsnumber`: **173974** | Workcenter: `M5051T31` | Durasi: `2520`s | [2026-09-23 09:10:00+07:00 s.d. 2026-09-23 09:52:00+07:00]
  * `tsnumber`: **174003** | Workcenter: `M5051CP3` | Durasi: `8700`s | [2026-09-23 09:37:00+07:00 s.d. 2026-09-23 12:02:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C06 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000131897` | **Operation**: `1505`
- **Max Overlap**: `1800.00` detik
- **Detail Record**:
  * `tsnumber`: **174587** | Workcenter: `M5051T31` | Durasi: `2040`s | [2026-09-23 21:10:00+07:00 s.d. 2026-09-23 21:44:00+07:00]
  * `tsnumber`: **174588** | Workcenter: `M5051CP3` | Durasi: `8760`s | [2026-09-23 21:14:00+07:00 s.d. 2026-09-23 23:40:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C07 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000132322` | **Operation**: `10`
- **Max Overlap**: `1860.00` detik
- **Detail Record**:
  * `tsnumber`: **174613** | Workcenter: `M5051CP1` | Durasi: `9000`s | [2026-09-23 22:00:00+07:00 s.d. 2026-09-24 00:30:00+07:00]
  * `tsnumber`: **174614** | Workcenter: `M5051T31` | Durasi: `1860`s | [2026-09-23 22:00:00+07:00 s.d. 2026-09-23 22:31:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C08 — Pola: WORKCENTER_TRANSITION
- **Operator**: `50410` | **Order**: `1000131505` | **Operation**: `80`
- **Max Overlap**: `2700.00` detik
- **Detail Record**:
  * `tsnumber`: **174661** | Workcenter: `M5051T31` | Durasi: `2700`s | [2026-09-24 00:00:00+07:00 s.d. 2026-09-24 00:45:00+07:00]
  * `tsnumber`: **174662** | Workcenter: `M5051CP2` | Durasi: `10800`s | [2026-09-24 00:00:00+07:00 s.d. 2026-09-24 03:00:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C09 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000132247` | **Operation**: `100`
- **Max Overlap**: `1620.00` detik
- **Detail Record**:
  * `tsnumber`: **174710** | Workcenter: `M5051T31` | Durasi: `1620`s | [2026-09-24 01:03:00+07:00 s.d. 2026-09-24 01:30:00+07:00]
  * `tsnumber`: **174711** | Workcenter: `M5051CP3` | Durasi: `1620`s | [2026-09-24 01:03:00+07:00 s.d. 2026-09-24 01:30:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C10 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000132247` | **Operation**: `100`
- **Max Overlap**: `720.00` detik
- **Detail Record**:
  * `tsnumber`: **174791** | Workcenter: `M5051T31` | Durasi: `1860`s | [2026-09-24 01:40:00+07:00 s.d. 2026-09-24 02:11:00+07:00]
  * `tsnumber`: **174816** | Workcenter: `M5051CP3` | Durasi: `3660`s | [2026-09-24 01:59:00+07:00 s.d. 2026-09-24 03:00:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C11 — Pola: WORKCENTER_TRANSITION
- **Operator**: `28813` | **Order**: `1000132120` | **Operation**: `100`
- **Max Overlap**: `1800.00` detik
- **Detail Record**:
  * `tsnumber`: **175259** | Workcenter: `M5051T31` | Durasi: `1800`s | [2026-09-24 12:40:00+07:00 s.d. 2026-09-24 13:10:00+07:00]
  * `tsnumber`: **175260** | Workcenter: `M5051CP4` | Durasi: `2040`s | [2026-09-24 12:40:00+07:00 s.d. 2026-09-24 13:14:00+07:00]
  * `tsnumber`: **175274** | Workcenter: `M5051T31` | Durasi: `2100`s | [2026-09-24 13:10:00+07:00 s.d. 2026-09-24 13:45:00+07:00]
  * `tsnumber`: **175275** | Workcenter: `M5051CP4` | Durasi: `1440`s | [2026-09-24 13:14:00+07:00 s.d. 2026-09-24 13:38:00+07:00]
  * `tsnumber`: **175296** | Workcenter: `M5051CP4` | Durasi: `8520`s | [2026-09-24 13:38:00+07:00 s.d. 2026-09-24 16:00:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C12 — Pola: WORKCENTER_TRANSITION
- **Operator**: `19480` | **Order**: `1000132376` | **Operation**: `380`
- **Max Overlap**: `48.98` detik
- **Detail Record**:
  * `tsnumber`: **175435** | Workcenter: `M5051WM6` | Durasi: `49`s | [2026-09-24 16:00:00+07:00 s.d. 2026-09-24 16:00:48.982901+07:00]
  * `tsnumber`: **175436** | Workcenter: `M55WM6OT` | Durasi: `10200`s | [2026-09-24 16:00:00+07:00 s.d. 2026-09-24 18:50:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C13 — Pola: WORKCENTER_TRANSITION
- **Operator**: `22477` | **Order**: `1000131736` | **Operation**: `100`
- **Max Overlap**: `73.93` detik
- **Detail Record**:
  * `tsnumber`: **175441** | Workcenter: `M5051SB2` | Durasi: `74`s | [2026-09-24 16:00:00+07:00 s.d. 2026-09-24 16:01:13.930545+07:00]
  * `tsnumber`: **175442** | Workcenter: `M55SB2OT` | Durasi: `9960`s | [2026-09-24 16:00:00+07:00 s.d. 2026-09-24 18:46:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C14 — Pola: AMBIGUOUS_OVERLAP_SAME_WC
- **Operator**: `4461-N` | **Order**: `1000132117` | **Operation**: `40`
- **Max Overlap**: `3900.00` detik
- **Detail Record**:
  * `tsnumber`: **175738** | Workcenter: `M5051FT3` | Durasi: `4080`s | [2026-09-24 21:10:00+07:00 s.d. 2026-09-24 22:18:00+07:00]
  * `tsnumber`: **175739** | Workcenter: `M5051FT3` | Durasi: `3900`s | [2026-09-24 21:13:00+07:00 s.d. 2026-09-24 22:18:00+07:00]
  * `tsnumber`: **175740** | Workcenter: `M5051FT3` | Durasi: `3908`s | [2026-09-24 21:13:42.472154+07:00 s.d. 2026-09-24 22:18:50.060527+07:00]
- **Bukti & Analisis**: Overlap pada workcenter yang sama dengan durasi signifikan.
- **Pilihan untuk Supervisor**: Memerlukan konfirmasi fisik: apakah salah satu order salah input atau waktu aktual perlu disesuaikan.

### Kasus BPN-C15 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000131897` | **Operation**: `1505`
- **Max Overlap**: `1680.00` detik
- **Detail Record**:
  * `tsnumber`: **175758** | Workcenter: `M5051T31` | Durasi: `1680`s | [2026-09-24 21:43:00+07:00 s.d. 2026-09-24 22:11:00+07:00]
  * `tsnumber`: **175759** | Workcenter: `M5051CP3` | Durasi: `1740`s | [2026-09-24 21:42:00+07:00 s.d. 2026-09-24 22:11:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C16 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000131897` | **Operation**: `1505`
- **Max Overlap**: `1740.00` detik
- **Detail Record**:
  * `tsnumber`: **175771** | Workcenter: `M5051T31` | Durasi: `1740`s | [2026-09-24 22:11:00+07:00 s.d. 2026-09-24 22:40:00+07:00]
  * `tsnumber`: **175772** | Workcenter: `M5051CP3` | Durasi: `8400`s | [2026-09-24 22:11:00+07:00 s.d. 2026-09-25 00:31:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C17 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000130069` | **Operation**: `270`
- **Max Overlap**: `839.96` detik
- **Detail Record**:
  * `tsnumber`: **175788** | Workcenter: `M5051T31` | Durasi: `1200`s | [2026-09-24 22:40:00+07:00 s.d. 2026-09-24 23:00:00+07:00]
  * `tsnumber`: **175789** | Workcenter: `M5051CP4` | Durasi: `1038`s | [2026-09-24 22:46:00.039087+07:00 s.d. 2026-09-24 23:03:18.420931+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C18 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000130069` | **Operation**: `270`
- **Max Overlap**: `1680.00` detik
- **Detail Record**:
  * `tsnumber`: **175819** | Workcenter: `M5051CP4` | Durasi: `10560`s | [2026-09-25 00:04:00+07:00 s.d. 2026-09-25 03:00:00+07:00]
  * `tsnumber`: **175820** | Workcenter: `M5051T31` | Durasi: `1920`s | [2026-09-25 00:00:00+07:00 s.d. 2026-09-25 00:32:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C19 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000131505` | **Operation**: `110`
- **Max Overlap**: `1854.39` detik
- **Detail Record**:
  * `tsnumber`: **175913** | Workcenter: `M5051T31` | Durasi: `1920`s | [2026-09-25 01:40:00+07:00 s.d. 2026-09-25 02:12:00+07:00]
  * `tsnumber`: **175914** | Workcenter: `M5051CP3` | Durasi: `2258`s | [2026-09-25 01:41:05.607573+07:00 s.d. 2026-09-25 02:18:43.497224+07:00]
  * `tsnumber`: **175959** | Workcenter: `M5051T31` | Durasi: `1680`s | [2026-09-25 02:12:00+07:00 s.d. 2026-09-25 02:40:00+07:00]
  * `tsnumber`: **175962** | Workcenter: `M5051CP3` | Durasi: `2520`s | [2026-09-25 02:18:00+07:00 s.d. 2026-09-25 03:00:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C20 — Pola: WORKCENTER_TRANSITION
- **Operator**: `62284` | **Order**: `1000131735` | **Operation**: `290`
- **Max Overlap**: `42.63` detik
- **Detail Record**:
  * `tsnumber`: **175997** | Workcenter: `M5051WLS` | Durasi: `43`s | [2026-09-25 03:00:00+07:00 s.d. 2026-09-25 03:00:42.627618+07:00]
  * `tsnumber`: **176001** | Workcenter: `M55WLSOT` | Durasi: `6600`s | [2026-09-25 03:00:00+07:00 s.d. 2026-09-25 04:50:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C21 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11006648` | **Order**: `1000132119` | **Operation**: `70`
- **Max Overlap**: `51.99` detik
- **Detail Record**:
  * `tsnumber`: **175998** | Workcenter: `M5051BB3` | Durasi: `52`s | [2026-09-25 03:00:00+07:00 s.d. 2026-09-25 03:00:51.986692+07:00]
  * `tsnumber`: **175999** | Workcenter: `M55BB3OT` | Durasi: `6480`s | [2026-09-25 03:00:00+07:00 s.d. 2026-09-25 04:48:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C22 — Pola: WORKCENTER_TRANSITION
- **Operator**: `20139` | **Order**: `1000131736` | **Operation**: `190`
- **Max Overlap**: `60.09` detik
- **Detail Record**:
  * `tsnumber`: **176002** | Workcenter: `M5051SB2` | Durasi: `60`s | [2026-09-25 03:00:00+07:00 s.d. 2026-09-25 03:01:00.086986+07:00]
  * `tsnumber`: **176011** | Workcenter: `M55SB2OT` | Durasi: `4920`s | [2026-09-25 03:00:00+07:00 s.d. 2026-09-25 04:22:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C23 — Pola: SUBSECOND_TOUCH
- **Operator**: `4461-N` | **Order**: `1000128216` | **Operation**: `210`
- **Max Overlap**: `1.69` detik
- **Detail Record**:
  * `tsnumber`: **176003** | Workcenter: `M5051FT3` | Durasi: `62`s | [2026-09-25 03:00:00+07:00 s.d. 2026-09-25 03:01:01.691784+07:00]
  * `tsnumber`: **176006** | Workcenter: `M55FT3OT` | Durasi: `6780`s | [2026-09-25 03:01:00+07:00 s.d. 2026-09-25 04:54:00+07:00]
- **Bukti & Analisis**: Timestamp check-in/checkout berselisih < 2 detik. Ini adalah scanning bounce/glitch pada pembaca barcode atau tombol.
- **Rekomendasi / Pilihan**: **BATALKAN/INVALIDATE record subdetik**, pertahankan shift kerja utama.

### Kasus BPN-C24 — Pola: WORKCENTER_TRANSITION
- **Operator**: `2486-Z` | **Order**: `1000130479` | **Operation**: `480`
- **Max Overlap**: `124.71` detik
- **Detail Record**:
  * `tsnumber`: **176016** | Workcenter: `M5051MS1` | Durasi: `125`s | [2026-09-25 03:00:00+07:00 s.d. 2026-09-25 03:02:04.711415+07:00]
  * `tsnumber`: **176017** | Workcenter: `M55MS1OT` | Durasi: `5400`s | [2026-09-25 03:00:00+07:00 s.d. 2026-09-25 04:30:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C25 — Pola: PROVEN_DUPLICATE_SCAN
- **Operator**: `11002862` | **Order**: `1000131694` | **Operation**: `70`
- **Max Overlap**: `253.81` detik
- **Detail Record**:
  * `tsnumber`: **176156** | Workcenter: `M5051CLS` | Durasi: `254`s | [2026-09-25 07:43:59.254440+07:00 s.d. 2026-09-25 07:48:13.068703+07:00]
  * `tsnumber`: **176157** | Workcenter: `M5051CLS` | Durasi: `257`s | [2026-09-25 07:43:59.256830+07:00 s.d. 2026-09-25 07:48:16.145541+07:00]
- **Bukti & Analisis**: Operator melakukan scan checkin ganda/berulang pada detik yang hampir identik (< 5 detik) di workcenter yang sama.
- **Rekomendasi / Pilihan**: **BATALKAN scan terpendek**, pertahankan record dengan checkout riil.

### Kasus BPN-C26 — Pola: WORKCENTER_TRANSITION
- **Operator**: `3231-M` | **Order**: `1000131922` | **Operation**: `5005`
- **Max Overlap**: `2.72` detik
- **Detail Record**:
  * `tsnumber`: **176199** | Workcenter: `M55BPPOT` | Durasi: `35`s | [2026-09-25 08:06:27.942959+07:00 s.d. 2026-09-25 08:07:02.716127+07:00]
  * `tsnumber`: **176203** | Workcenter: `M5051BPP` | Durasi: `3180`s | [2026-09-25 08:07:00+07:00 s.d. 2026-09-25 09:00:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C27 — Pola: WORKCENTER_TRANSITION
- **Operator**: `4029-M` | **Order**: `1000131922` | **Operation**: `5005`
- **Max Overlap**: `7.78` detik
- **Detail Record**:
  * `tsnumber`: **176200** | Workcenter: `M55BPPOT` | Durasi: `8`s | [2026-09-25 08:06:46.837851+07:00 s.d. 2026-09-25 08:06:54.615182+07:00]
  * `tsnumber`: **176201** | Workcenter: `M5051BPP` | Durasi: `3240`s | [2026-09-25 08:06:00+07:00 s.d. 2026-09-25 09:00:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C28 — Pola: AMBIGUOUS_OVERLAP_SAME_WC
- **Operator**: `20677` | **Order**: `1000131922` | **Operation**: `5005`
- **Max Overlap**: `7.94` detik
- **Detail Record**:
  * `tsnumber`: **176204** | Workcenter: `M5051BPP` | Durasi: `8`s | [2026-09-25 08:07:21.252244+07:00 s.d. 2026-09-25 08:07:29.195445+07:00]
  * `tsnumber`: **176205** | Workcenter: `M5051BPP` | Durasi: `3180`s | [2026-09-25 08:07:00+07:00 s.d. 2026-09-25 09:00:00+07:00]
- **Bukti & Analisis**: Overlap pada workcenter yang sama dengan durasi signifikan.
- **Pilihan untuk Supervisor**: Memerlukan konfirmasi fisik: apakah salah satu order salah input atau waktu aktual perlu disesuaikan.

### Kasus BPN-C29 — Pola: WORKCENTER_TRANSITION
- **Operator**: `2763-M` | **Order**: `1000132247` | **Operation**: `130`
- **Max Overlap**: `720.00` detik
- **Detail Record**:
  * `tsnumber`: **176291** | Workcenter: `M5051T31` | Durasi: `2100`s | [2026-09-25 09:10:00+07:00 s.d. 2026-09-25 09:45:00+07:00]
  * `tsnumber`: **176315** | Workcenter: `M5051CP3` | Durasi: `900`s | [2026-09-25 09:33:00+07:00 s.d. 2026-09-25 09:48:00+07:00]
  * `tsnumber`: **176326** | Workcenter: `M5051T31` | Durasi: `2700`s | [2026-09-25 09:45:00+07:00 s.d. 2026-09-25 10:30:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C30 — Pola: WORKCENTER_TRANSITION
- **Operator**: `28813` | **Order**: `1000132251` | **Operation**: `140`
- **Max Overlap**: `1620.00` detik
- **Detail Record**:
  * `tsnumber`: **176327** | Workcenter: `M5051T31` | Durasi: `1620`s | [2026-09-25 09:56:00+07:00 s.d. 2026-09-25 10:23:00+07:00]
  * `tsnumber`: **176328** | Workcenter: `M5051CP4` | Durasi: `1620`s | [2026-09-25 09:56:00+07:00 s.d. 2026-09-25 10:23:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C31 — Pola: WORKCENTER_TRANSITION
- **Operator**: `28813` | **Order**: `1000132251` | **Operation**: `140`
- **Max Overlap**: `2460.00` detik
- **Detail Record**:
  * `tsnumber`: **176370** | Workcenter: `M5051CP4` | Durasi: `2520`s | [2026-09-25 12:33:00+07:00 s.d. 2026-09-25 13:15:00+07:00]
  * `tsnumber`: **176372** | Workcenter: `M5051T31` | Durasi: `2640`s | [2026-09-25 12:30:00+07:00 s.d. 2026-09-25 13:14:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C32 — Pola: WORKCENTER_TRANSITION
- **Operator**: `24696` | **Order**: `1000131842` | **Operation**: `230`
- **Max Overlap**: `161.01` detik
- **Detail Record**:
  * `tsnumber`: **176576** | Workcenter: `M5051SB3` | Durasi: `161`s | [2026-09-25 16:00:00+07:00 s.d. 2026-09-25 16:02:41.010603+07:00]
  * `tsnumber`: **176577** | Workcenter: `M55SB3OT` | Durasi: `660`s | [2026-09-25 16:00:00+07:00 s.d. 2026-09-25 16:11:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C33 — Pola: SUBSECOND_TOUCH
- **Operator**: `52590` | **Order**: `1000130479` | **Operation**: `550`
- **Max Overlap**: `0.49` detik
- **Detail Record**:
  * `tsnumber`: **176713** | Workcenter: `M5051TKG` | Durasi: `0`s | [2026-09-25 19:25:48.852234+07:00 s.d. 2026-09-25 19:25:49.342919+07:00]
  * `tsnumber`: **176714** | Workcenter: `M5051TKG` | Durasi: `5700`s | [2026-09-25 19:25:00+07:00 s.d. 2026-09-25 21:00:00+07:00]
- **Bukti & Analisis**: Timestamp check-in/checkout berselisih < 2 detik. Ini adalah scanning bounce/glitch pada pembaca barcode atau tombol.
- **Rekomendasi / Pilihan**: **BATALKAN/INVALIDATE record subdetik**, pertahankan shift kerja utama.

### Kasus BPN-C34 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000131685` | **Operation**: `100`
- **Max Overlap**: `1100.85` detik
- **Detail Record**:
  * `tsnumber`: **176756** | Workcenter: `M5051T31` | Durasi: `2709`s | [2026-09-25 19:45:11.908850+07:00 s.d. 2026-09-25 20:30:20.854090+07:00]
  * `tsnumber`: **176771** | Workcenter: `M5051CP2` | Durasi: `10080`s | [2026-09-25 20:12:00+07:00 s.d. 2026-09-25 23:00:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C35 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000130069` | **Operation**: `300`
- **Max Overlap**: `1236.05` detik
- **Detail Record**:
  * `tsnumber`: **176893** | Workcenter: `M5051T31` | Durasi: `1236`s | [2026-09-25 22:41:35.109675+07:00 s.d. 2026-09-25 23:02:11.160992+07:00]
  * `tsnumber`: **176894** | Workcenter: `M5051CP3` | Durasi: `1980`s | [2026-09-25 22:41:00+07:00 s.d. 2026-09-25 23:14:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C36 — Pola: AMBIGUOUS_OVERLAP_SAME_WC
- **Operator**: `26952` | **Order**: `1000127789` | **Operation**: `270`
- **Max Overlap**: `272.40` detik
- **Detail Record**:
  * `tsnumber`: **176900** | Workcenter: `M55SB3OT` | Durasi: `272`s | [2026-09-26 00:00:44.434484+07:00 s.d. 2026-09-26 00:05:16.834342+07:00]
  * `tsnumber`: **176932** | Workcenter: `M55SB3OT` | Durasi: `540`s | [2026-09-26 00:00:00+07:00 s.d. 2026-09-26 00:09:00+07:00]
- **Bukti & Analisis**: Overlap pada workcenter yang sama dengan durasi signifikan.
- **Pilihan untuk Supervisor**: Memerlukan konfirmasi fisik: apakah salah satu order salah input atau waktu aktual perlu disesuaikan.

### Kasus BPN-C37 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000123537` | **Operation**: `210`
- **Max Overlap**: `1705.13` detik
- **Detail Record**:
  * `tsnumber`: **176918** | Workcenter: `M5051T31` | Durasi: `1707`s | [2026-09-26 00:03:34.868841+07:00 s.d. 2026-09-26 00:32:01.393154+07:00]
  * `tsnumber`: **176919** | Workcenter: `M5051CP4` | Durasi: `1740`s | [2026-09-26 00:03:00+07:00 s.d. 2026-09-26 00:32:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C38 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000130069` | **Operation**: `300`
- **Max Overlap**: `1740.95` detik
- **Detail Record**:
  * `tsnumber`: **176947** | Workcenter: `M5051T31` | Durasi: `1746`s | [2026-09-26 00:32:29.121758+07:00 s.d. 2026-09-26 01:01:35.519199+07:00]
  * `tsnumber`: **176948** | Workcenter: `M5051CP3` | Durasi: `8845`s | [2026-09-26 00:32:34.565352+07:00 s.d. 2026-09-26 03:00:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C39 — Pola: PROVEN_DUPLICATE_SCAN
- **Operator**: `2613-D` | **Order**: `1000130197` | **Operation**: `5003`
- **Max Overlap**: `2510.47` detik
- **Detail Record**:
  * `tsnumber`: **176967** | Workcenter: `M5051DIS` | Durasi: `2510`s | [2026-09-26 01:00:30.493953+07:00 s.d. 2026-09-26 01:42:20.965996+07:00]
  * `tsnumber`: **176968** | Workcenter: `M5051DIS` | Durasi: `2510`s | [2026-09-26 01:00:30.493702+07:00 s.d. 2026-09-26 01:42:20.964834+07:00]
- **Bukti & Analisis**: Operator melakukan scan checkin ganda/berulang pada detik yang hampir identik (< 5 detik) di workcenter yang sama.
- **Rekomendasi / Pilihan**: **BATALKAN scan terpendek**, pertahankan record dengan checkout riil.

### Kasus BPN-C40 — Pola: WORKCENTER_TRANSITION
- **Operator**: `62284` | **Order**: `1000131735` | **Operation**: `350`
- **Max Overlap**: `39.65` detik
- **Detail Record**:
  * `tsnumber`: **177107** | Workcenter: `M5051WLS` | Durasi: `40`s | [2026-09-26 03:00:00+07:00 s.d. 2026-09-26 03:00:39.654640+07:00]
  * `tsnumber`: **177110** | Workcenter: `M55WLSOT` | Durasi: `3720`s | [2026-09-26 03:00:00+07:00 s.d. 2026-09-26 04:02:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C41 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000131409` | **Operation**: `120`
- **Max Overlap**: `2846.04` detik
- **Detail Record**:
  * `tsnumber`: **177112** | Workcenter: `M55T31OT` | Durasi: `1709`s | [2026-09-26 03:01:55.742009+07:00 s.d. 2026-09-26 03:30:24.959248+07:00]
  * `tsnumber`: **177115** | Workcenter: `M55CP2OT` | Durasi: `2340`s | [2026-09-26 03:01:00+07:00 s.d. 2026-09-26 03:40:00+07:00]
  * `tsnumber`: **177127** | Workcenter: `M55T31OT` | Durasi: `4017`s | [2026-09-26 03:30:28.604783+07:00 s.d. 2026-09-26 04:37:26.038617+07:00]
  * `tsnumber`: **177130** | Workcenter: `M55CP2OT` | Durasi: `4380`s | [2026-09-26 03:50:00+07:00 s.d. 2026-09-26 05:03:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C42 — Pola: WORKCENTER_TRANSITION
- **Operator**: `28813` | **Order**: `1000131694` | **Operation**: `140`
- **Max Overlap**: `927.75` detik
- **Detail Record**:
  * `tsnumber`: **177245** | Workcenter: `M55T31OT` | Durasi: `1300`s | [2026-09-26 08:39:45.472001+07:00 s.d. 2026-09-26 09:01:25.786456+07:00]
  * `tsnumber`: **177246** | Workcenter: `M55CP3OT` | Durasi: `1800`s | [2026-09-26 08:20:00+07:00 s.d. 2026-09-26 08:50:00+07:00]
  * `tsnumber`: **177298** | Workcenter: `M55T31OT` | Durasi: `3328`s | [2026-09-26 09:14:32.246176+07:00 s.d. 2026-09-26 10:10:00.585577+07:00]
  * `tsnumber`: **177299** | Workcenter: `M55CP3OT` | Durasi: `2400`s | [2026-09-26 08:50:00+07:00 s.d. 2026-09-26 09:30:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C43 — Pola: WORKCENTER_TRANSITION
- **Operator**: `28813` | **Order**: `1000131409` | **Operation**: `120`
- **Max Overlap**: `995.27` detik
- **Detail Record**:
  * `tsnumber`: **177308** | Workcenter: `M55CP2OT` | Durasi: `1800`s | [2026-09-26 10:30:00+07:00 s.d. 2026-09-26 11:00:00+07:00]
  * `tsnumber`: **177309** | Workcenter: `M55T31OT` | Durasi: `2140`s | [2026-09-26 10:10:55.524085+07:00 s.d. 2026-09-26 10:46:35.266337+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C44 — Pola: WORKCENTER_TRANSITION
- **Operator**: `28813` | **Order**: `1000132248` | **Operation**: `70`
- **Max Overlap**: `1800.00` detik
- **Detail Record**:
  * `tsnumber`: **177366** | Workcenter: `M55T31OT` | Durasi: `3589`s | [2026-09-26 13:11:48.796478+07:00 s.d. 2026-09-26 14:11:37.845814+07:00]
  * `tsnumber`: **177367** | Workcenter: `M55CP4OT` | Durasi: `1800`s | [2026-09-26 13:00:00+07:00 s.d. 2026-09-26 13:30:00+07:00]
  * `tsnumber`: **177372** | Workcenter: `M55CP4OT` | Durasi: `1800`s | [2026-09-26 13:30:00+07:00 s.d. 2026-09-26 14:00:00+07:00]
  * `tsnumber`: **177373** | Workcenter: `M55T31OT` | Durasi: `121`s | [2026-09-26 14:11:56.857181+07:00 s.d. 2026-09-26 14:13:57.488879+07:00]
  * `tsnumber`: **177376** | Workcenter: `M55CP4OT` | Durasi: `7200`s | [2026-09-26 14:00:00+07:00 s.d. 2026-09-26 16:00:00+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C45 — Pola: WORKCENTER_TRANSITION
- **Operator**: `28813` | **Order**: `1000131694` | **Operation**: `140`
- **Max Overlap**: `2773.99` detik
- **Detail Record**:
  * `tsnumber`: **177427** | Workcenter: `M5051T31` | Durasi: `2799`s | [2026-09-26 14:43:30.702281+07:00 s.d. 2026-09-26 15:30:09.356660+07:00]
  * `tsnumber`: **177429** | Workcenter: `M55CP3OT` | Durasi: `2774`s | [2026-09-26 14:43:52.763077+07:00 s.d. 2026-09-26 15:30:06.751688+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C46 — Pola: AMBIGUOUS_OVERLAP_SAME_WC
- **Operator**: `11006648` | **Order**: `1000127792` | **Operation**: `30`
- **Max Overlap**: `6.67` detik
- **Detail Record**:
  * `tsnumber`: **177507** | Workcenter: `M55GD1OT` | Durasi: `7`s | [2026-09-26 16:26:10.552878+07:00 s.d. 2026-09-26 16:26:17.222998+07:00]
  * `tsnumber`: **177508** | Workcenter: `M55GD1OT` | Durasi: `3841`s | [2026-09-26 16:26:10.553042+07:00 s.d. 2026-09-26 17:30:11.163546+07:00]
- **Bukti & Analisis**: Overlap pada workcenter yang sama dengan durasi signifikan.
- **Pilihan untuk Supervisor**: Memerlukan konfirmasi fisik: apakah salah satu order salah input atau waktu aktual perlu disesuaikan.

### Kasus BPN-C47 — Pola: AMBIGUOUS_OVERLAP_SAME_WC
- **Operator**: `11006648` | **Order**: `1000127792` | **Operation**: `30`
- **Max Overlap**: `4.93` detik
- **Detail Record**:
  * `tsnumber`: **177546** | Workcenter: `M55GD1OT` | Durasi: `5`s | [2026-09-26 18:10:11.908180+07:00 s.d. 2026-09-26 18:10:16.881304+07:00]
  * `tsnumber`: **177547** | Workcenter: `M55GD1OT` | Durasi: `5849`s | [2026-09-26 18:10:11.954392+07:00 s.d. 2026-09-26 19:47:41.195349+07:00]
- **Bukti & Analisis**: Overlap pada workcenter yang sama dengan durasi signifikan.
- **Pilihan untuk Supervisor**: Memerlukan konfirmasi fisik: apakah salah satu order salah input atau waktu aktual perlu disesuaikan.

### Kasus BPN-C48 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000132718` | **Operation**: `10`
- **Max Overlap**: `1692.65` detik
- **Detail Record**:
  * `tsnumber`: **177557** | Workcenter: `M55T31OT` | Durasi: `1714`s | [2026-09-26 18:12:00.880672+07:00 s.d. 2026-09-26 18:40:34.964130+07:00]
  * `tsnumber`: **177559** | Workcenter: `M55CP1OT` | Durasi: `14702`s | [2026-09-26 18:12:22.310295+07:00 s.d. 2026-09-26 22:17:24.404471+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C49 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000132713` | **Operation**: `10`
- **Max Overlap**: `1861.04` detik
- **Detail Record**:
  * `tsnumber`: **177560** | Workcenter: `M55CP1OT` | Durasi: `14687`s | [2026-09-26 18:12:35.652601+07:00 s.d. 2026-09-26 22:17:22.160524+07:00]
  * `tsnumber`: **177567** | Workcenter: `M55CP1OT` | Durasi: `8`s | [2026-09-26 18:40:16.681749+07:00 s.d. 2026-09-26 18:40:24.426794+07:00]
  * `tsnumber`: **177569** | Workcenter: `M55T31OT` | Durasi: `1861`s | [2026-09-26 18:40:21.994417+07:00 s.d. 2026-09-26 19:11:23.034413+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C50 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000131647` | **Operation**: `150`
- **Max Overlap**: `40.14` detik
- **Detail Record**:
  * `tsnumber`: **177574** | Workcenter: `M55T31OT` | Durasi: `44`s | [2026-09-26 19:11:10.781206+07:00 s.d. 2026-09-26 19:11:54.506815+07:00]
  * `tsnumber`: **177575** | Workcenter: `M55CP3OT` | Durasi: `42`s | [2026-09-26 19:11:14.364161+07:00 s.d. 2026-09-26 19:11:56.384110+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C51 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000131647` | **Operation**: `160`
- **Max Overlap**: `1741.42` detik
- **Detail Record**:
  * `tsnumber`: **177576** | Workcenter: `M55CP3OT` | Durasi: `1749`s | [2026-09-26 19:11:48.132466+07:00 s.d. 2026-09-26 19:40:57.225270+07:00]
  * `tsnumber`: **177577** | Workcenter: `M55T31OT` | Durasi: `1741`s | [2026-09-26 19:11:52.119608+07:00 s.d. 2026-09-26 19:40:53.537994+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).

### Kasus BPN-C52 — Pola: WORKCENTER_TRANSITION
- **Operator**: `11009630` | **Order**: `1000131647` | **Operation**: `160`
- **Max Overlap**: `3781.83` detik
- **Detail Record**:
  * `tsnumber`: **177582** | Workcenter: `M55T31OT` | Durasi: `9`s | [2026-09-26 19:40:58.541118+07:00 s.d. 2026-09-26 19:41:07.579274+07:00]
  * `tsnumber`: **177583** | Workcenter: `M55T31OT` | Durasi: `3785`s | [2026-09-26 19:40:59.869380+07:00 s.d. 2026-09-26 20:44:04.663511+07:00]
  * `tsnumber`: **177584** | Workcenter: `M55CP3OT` | Durasi: `7984`s | [2026-09-26 19:41:02.837500+07:00 s.d. 2026-09-26 21:54:06.976079+07:00]
- **Bukti & Analisis**: Operator berganti workcenter pada order & operation yang sama, terjadi tumpang tindih waktu di stasiun kerja.
- **Pilihan untuk Supervisor**:
  1. **Option A**: Potong checkout record pertama agar sejajar dengan checkin record kedua (Handoff bersih, tidak ada jam hilang).
  2. **Option B**: Salah satu record dibatalkan (jika salah input workcenter).
