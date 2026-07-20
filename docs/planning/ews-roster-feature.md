---
type: design
status: draft
tags: [ews, roster, adoption-labour, planning]
updated: 2026-07-20
---

# Rancangan Fitur Roster EWS — Override Foreman + Adoption Mode A

> RANCANGAN untuk direview sebelum implementasi bertahap. **Belum ada kode/skema/migrasi.**
> Klaim tentang kode/data existing ditandai **[READ]** (diverifikasi sesi ini) / **[INFERRED]**.
> Konsep dasar: [[concepts/ews-roster]].

---

## 0. Keputusan fondasi (FINAL)

**Adoption_labour = Mode A (kepatuhan jadwal).** Jadwal menentukan siapa diukur; absen (recorded=0)
MASUK denominator dan menarik adoption turun; yang tak dijadwalkan tak diukur. **Konfirmasi kode =
Mode A [READ]** `calculateAdoptionLabourFromRoster:711-747` (denom = Σ expected atas `SCHEDULED`,
absen di penyebut).

---

## 0.5 Keputusan crux (review 2026-07-20) — DIKUNCI

| # | Keputusan | Status |
|---|---|---|
| **1** | Override = **query-time** via VIEW `ews.roster_effective`; `shift_roster` immutable. 2 pembaca fungsional (§3.0) | **DIKUNCI** |
| **2** | Half-day = **jam VARIABEL → std custom per entry** (bukan shift `SAT_HALF`). Extra-workday & std-override sama-sama butuh kolom `standard_hours` | **DIKUNCI** |
| **3** | Shift-lock pakai std shift terkunci apa adanya (DAY 8h/NIGHT 7h) — bukan distorsi | **DIKUNCI** |
| **4** | Horizon 14→30 = **fase terakhir**, setelah mekanisme override ada | **DIKUNCI** |
| **5** | Urutan: shift-lock (additive) dulu → override formula-touching (std-override, extra-workday) | **DIKUNCI** |
| **6** | **TIGA jenis override** (bukan dua) — tambah **std-override** | **BARU, DIKUNCI** |
| **7** | Penyimpanan = **DUA tabel** — `roster_extra_workday` (ada `shift_code`), `roster_std_override` (tanpa) | **DIKUNCI** |
| **8** | Urutan fase: **F1 shift-lock → F2 std-override → F3 extra-workday → F4 horizon** | **DIKUNCI** |
| **9** | Plafon `standard_hours` std-override = **maks `clock_hours` shift terkait** (ON) | **DIKUNCI** |

### Tiga jenis override
1. **Extra-workday** — masuk di hari default OFF. Foreman pilih shift (DAY/NIGHT) + jam custom. → **baris BARU** (hari tanpa baris auto).
2. **Shift-lock** — kunci DAY/NIGHT N minggu, kebal rotasi. → **ganti shift** baris auto.
3. **Std-override (BARU)** — ubah jam pada hari yang SUDAH dijadwalkan (mis. DAY penuh → setengah). Berlaku hari apa saja termasuk hari berjalan. → **ganti std** baris auto.

---

## 1. Peta existing vs baru

| Kapabilitas | Status | Bukti |
|---|---|---|
| Shift DAY/NIGHT + jam + std | ADA [READ] | `operator_shift` DAY 8h / NIGHT 7h |
| 2-crew auto-flip mingguan | ADA [READ] | `rotation_config` + `rosterGenerator.js:9-58` |
| Aturan hari kerja per-dow | ADA [READ] | `roster_workday_rule` (PK `day_of_week`) |
| Assign crew A/B | ADA [READ] | `operator_rotation_group` |
| Generate forward-only 14 hari | ADA [READ] | `ewsRosterGenerateJob.js` `DO NOTHING` |
| Edit status manual | ADA, UPDATE-only [READ] | `updateStatus:63-88` |
| **Extra-workday** (#1) | BARU | tak ada tabel/endpoint |
| **Shift-lock** (#2) | BARU | tak ada tabel lock (17 tabel `ews`, tak ada override) [READ] |
| **Std-override** (#3) | BARU | tak ada; std hanya bisa lewat generate saat ini |
| Horizon ~1 bulan | BARU (fase terakhir) | sekarang 14 hari [READ] |

---

## 2. Model penyimpanan override

Batasan [READ]: `shift_roster` beku, generate `DO NOTHING`, never-regenerate terkunci. **Query-time
(crux #1): override tak menulis `shift_roster` — hidup di tabel sendiri, diterapkan saat baca.**

### 2a. Shift-lock — tabel `operator_shift_lock`
`(serialnumber, locked_shift, effective_from, lock_weeks, created_by, cancelled_at)`. Lock habis di
**batas minggu** (`effective_from + lock_weeks×7`, disnap ke `week_start_dow`).

### 2b. Extra-workday (#1) vs Std-override (#3) — satu tabel atau dua?

**Analisa operasi:** extra-workday menaruh baris **BARU** (hari OFF, tak ada baris auto);
std-override **mengubah std baris ADA** (hari kerja, ada baris auto). Kunci: sebuah `(operator,
tanggal)` **ATAU** OFF **ATAU** kerja — jadi keduanya **mutually exclusive per (operator, tanggal)**.
Maka satu tabel **BISA** menampung keduanya, dibedakan "ada/tidak baris auto".

| Opsi | Bentuk | Trade-off |
|---|---|---|
| **Dua tabel** `roster_extra_workday(serialnumber, business_date, shift_code, standard_hours, note, added_by, cancelled_at)` + `roster_std_override(serialnumber, business_date, standard_hours, note, added_by, cancelled_at)` | Kolom minimal per tabel (extra butuh `shift_code`, std-override tidak); intent eksplisit; audit bersih; 2 alur UI cocok (tambah operator vs edit jam) | ✅ jelas & aman. ❌ 2 objek, 2 endpoint, 2 cabang di VIEW |
| **Satu tabel** `roster_day_override(serialnumber, business_date, shift_code NULL, standard_hours, note, added_by, cancelled_at)` | VIEW branch: ada baris auto → std-override (`shift_code` diabaikan); tak ada → extra-workday (`shift_code` dipakai) | ✅ separuh objek, 1 endpoint. ❌ semantik implisit (arti baris = tergantung ada/tidaknya auto); `shift_code` nullable membingungkan; kalau status OFF/kerja tanggal itu berubah, arti baris ikut flip |

**Keputusan [DIKUNCI]: DUA tabel** — intent eksplisit, kolom minimal, sejalan dgn 2 alur UI berbeda dan 2
profil validasi berbeda (§7).

**Std custom [crux #2]:** baik extra-workday maupun std-override memakai kolom `standard_hours` bebas
(jam variabel — half-day tak selalu 4h). `operator_shift` hanya DAY 8h/NIGHT 7h [READ], jadi jam
non-standar wajib lewat kolom ini, bukan definisi shift baru.

---

## 3. Interaksi override × generator — query-time via VIEW 3-lapis

### 3.0 Pembaca `shift_roster` [READ, grep repo-wide]
**Fungsional = 2:** (1) `getRoster` ewsRosterController.js:45; (2) adoption ewsCalculator.js:718 +
dispatcher EXISTS :1004. **Penulis:** rosterGenerator :53 (INSERT), updateStatus :75 (UPDATE).
**Metadata saja:** ewsController :1109. **Tak baca:** getTrend (`kpi_snapshot`), snapshot job (lewat
adoption), SAP/ETL (Python, 0 match), frontend (lewat API). → 2 pembaca → query-time bersih; keduanya
baca **VIEW**, bukan tabel, agar logika override tak diduplikasi.

### 3.1 Bentuk VIEW `roster_effective` (RANCANGAN, bukan kode final)

Tiga lapis menimpa baris auto (lock ganti shift, std-override ganti std) + satu UNION (extra-workday
menambah baris):

```
roster_effective(business_date) =
  -- baris AUTO (hari kerja) + lock + std-override
  SELECT r.serialnumber, r.business_date, r.status,
         COALESCE(lk.locked_shift, r.scheduled_shift)                   AS eff_shift,
         COALESCE(sov.standard_hours,          -- 1) std-override (menang)
                  os_lk.standard_hours,        -- 2) jika lock: std dari operator_shift[locked_shift]
                  r.scheduled_standard_hours)  -- 3) beku (tanpa lock/override)
                                                                        AS eff_std
  FROM ews.shift_roster r
  LEFT JOIN operator_shift_lock  lk    ON lk.serialnumber=r.serialnumber
                                       AND r.business_date BETWEEN lk.effective_from AND <lock_end>
                                       AND lk.cancelled_at IS NULL
  LEFT JOIN operator_shift       os_lk ON os_lk.shift_code = lk.locked_shift
  LEFT JOIN roster_std_override  sov   ON sov.serialnumber=r.serialnumber
                                       AND sov.business_date=r.business_date AND sov.cancelled_at IS NULL
  UNION ALL
  -- baris EXTRA-WORKDAY (hari OFF, tak ada baris auto)
  SELECT ex.serialnumber, ex.business_date, 'SCHEDULED' AS status,
         ex.shift_code AS eff_shift, ex.standard_hours AS eff_std
  FROM roster_extra_workday ex
  WHERE ex.cancelled_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM ews.shift_roster r2
                    WHERE r2.serialnumber=ex.serialnumber AND r2.business_date=ex.business_date)
```

- **`NOT EXISTS`** menjaga extra-workday hanya menambah baris di hari tanpa baris auto (hindari
  duplikat PK / dobel-hitung). Kalau tanggal kelak jadi hari kerja (baris auto lahir), extra-workday
  otomatis gugur (auto menang) — edge yang harus disadari.
- Generator `rosterGenerator.js` **tidak berubah**; hanya menulis baris auto. Freeze +
  never-regenerate utuh.

### 3.2 Presedensi std (crux validasi)
`eff_std = COALESCE( std-override , std-dari-operator_shift[locked_shift] , scheduled_standard_hours-beku )`.
**Penting [READ konfirmasi]:** saat lock aktif, std WAJIB dihitung ulang dari `operator_shift[locked_shift]`
(lapis 2), **bukan** `scheduled_standard_hours` beku — kalau lock ganti shift ke DAY tapi std beku masih
NIGHT 7h = salah. `eff_shift` di-COALESCE terpisah (lock ganti shift). Jadi lock menimpa **shift DAN std**,
std-override menimpa **std** di atas segalanya.

### 3.3 Bentrok lock × std-override (operator+tanggal sama)
Bisa terjadi & **komposabel, bukan destruktif:** lock set shift (mis. DAY), std-override set jam (mis. 4h).
`eff_shift` = DAY (dari lock); `eff_std` = 4h (std-override menang atas std-DAY-8h). Presedensi §3.2 sudah
menanganinya — std-override selalu di atas.

### 3.4 Performa [READ EXPLAIN]
Basis (`shift_roster` JOIN `operator_shift`, satu tanggal `business_date=2026-07-20`): **Execution 0.76 ms**,
`Index Scan idx_ews_shift_roster_date` (91 baris), `operator_shift` di-Memoize (89 hit/2 miss),
`Buffers shared hit=10` (nol disk). Lapis override yang ditambah = LEFT JOIN ke tabel kecil terindeks +
UNION extra-workday terindeks `business_date` → tambahan **negligible** SELAMA:
- pembaca **selalu filter `business_date`** (predicate pushdown ke tiap cabang UNION);
- tabel override berindeks `(serialnumber, business_date)`; `operator_shift_lock` berindeks `serialnumber` (+ rentang tanggal).
Beda dari SOW 66s→665ms: di sana fan-out join tabel besar; di sini ≤91 baris/tanggal + override kecil, semua
index+date-filtered. **Wajib:** jalankan `EXPLAIN ANALYZE` pada VIEW nyata di Fase 1 sebelum merge (VIEW belum ada, jadi ini estimasi terkalibrasi basis, bukan VIEW final).

---

## 4. Dampak denominator adoption (Mode A)

Kedua pembaca beralih baca `roster_effective`. Rumus adoption tak berubah; yang berubah = INPUT.

| Override | Efek denominator | Fase |
|---|---|---|
| **Shift-lock** | Headcount tetap; std mengikuti shift terkunci (8↔7) + split day/night pindah. **Bounded & benar** (crux #3) | **1 (additive, validasi ringan)** |
| **Std-override** | **Ubah expected/std** untuk operator-hari yang ditandai (mis. 8→4 → expected turun) | **formula-touching (validasi angka)** |
| **Extra-workday** | **Menambah operator** ke denominator hari OFF; absen menurunkan adoption | **formula-touching (validasi angka)** |

---

## 5. UI foreman (EwsRosterConfigPage)

**Sudah ada [READ]:** toggle workday, assign crew, generate, panel read-only.

**Tambah (alur, bukan kode):**
- **Shift-lock:** operator → shift terkunci + durasi (N minggu) → simpan → "kebal rotasi s/d <tgl>" +
  preview komposisi shift crew (deteksi crew campur, edge 2).
- **Std-override (#3):** operator → pilih **tanggal kerja yang sudah dijadwalkan** (termasuk **hari
  ini**) → set jam custom → simpan. Skenario pemicu: foreman baru dapat kabar bawahan masuk setengah
  hari, set saat itu juga. Tampilkan std lama → std baru.
- **Extra-workday (#1):** operator → tanggal OFF → shift + jam → simpan. **Konfirmasi ganda +
  peringatan konsekuensi** (§6 edge 4).
- **Batalkan sebelum hari-H** (semua override): daftar override mendatang + tombol Batalkan
  (`cancelled_at`). Query-time → batal = baris hilang dari `roster_effective`, `shift_roster` tak
  tersentuh. **Nonaktif untuk tanggal < hari ini** (jangan ubah sejarah).
- **Indikator:** badge "extra"/"lock"/"jam custom" pada baris hasil override.

---

## 6. Edge cases & risiko

| # | Kasus | Apa salahnya | Cara cegah |
|---|---|---|---|
| 1 | Lupa set extra-workday | Sabtu kosong padahal ada yang kerja → tak terukur adoption. **Jam TETAP ke SAP** [READ: `stage_machinehours` baca `mch_transaction`, bukan roster] | Preview: log di hari OFF tanpa jadwal → "tandai?" |
| 2 | Shift-lock bentrok flip | Crew campur shift [INFERRED] | Preview komposisi shift saat lock |
| 3 | Override diset lalu regenerate | **Tak terjadi** — query-time, `shift_roster` tak ditulisi | (teratasi arsitektur) |
| **4** | Extra-workday ditandai lalu bolos | Adoption turun. **Mode A benar — disengaja.** TAPI akurasi adoption kini **bergantung disiplin foreman**; asal-tandai = **phantom absent lewat UI** (seperti 07-25, tapi via fitur) | Konfirmasi ganda + peringatan; bisa dibatalkan sebelum hari-H; audit `added_by`/`cancelled_at` |
| 5 | Lock habis tengah minggu | Operator balik crew-shift mid-week | Habis di **batas minggu** |
| 6 | Std-override jam variabel | `operator_shift` cuma 8/7 [READ] | kolom `standard_hours` custom [crux #2] |
| **7** | **Std-override menaikkan std tak masuk akal** (mis. set 20h) | Denominator melar → adoption palsu tinggi | Validasi input: `0 < standard_hours ≤ clock_hours` shift terkait |
| 8 | Batalkan override setelah hari lewat | Ubah sejarah adoption | UI nonaktifkan batal untuk tanggal < hari ini |
| **9** | **Std-override + shift-lock di (op,tgl) sama** | Bingung mana menang | Presedensi §3.2/3.3: std-override menang untuk std; lock untuk shift. Komposabel, bukan bentrok |

---

## 7. Urutan implementasi bertahap

| Fase | Isi | Profil risiko |
|---|---|---|
| **1 — Shift-lock** | `operator_shift_lock` + VIEW `roster_effective` (lapis lock) + 2 pembaca beralih ke VIEW + UI lock | **Additive.** Denom berubah bounded (std ikut shift). Validasi ringan: total ~stabil, cek split day/night. `EXPLAIN ANALYZE` VIEW nyata di sini |
| **2 — Std-override** | `roster_std_override` + perluas VIEW (lapis std-override) + endpoint set/batal + UI | **Formula-touching.** Ubah expected. **Validasi angka sebelum/sesudah** pada operator-hari sampel. **Tak butuh perubahan dispatcher** (modifikasi baris auto yang SUDAH memicu roster path) → lebih sederhana dari extra-workday |
| **3 — Extra-workday** | `roster_extra_workday` + perluas VIEW (UNION extra) + **dispatcher cek `roster_effective`** (§8) + endpoint + UI (konfirmasi ganda) | **Formula-touching + menambah baris.** Validasi angka. Butuh perbaikan dispatcher §8 |
| **4 — Horizon 14→30** | Ubah `EWS_ROSTER_FORWARD_DAYS` | Aman setelah override ada (crux #4). Terakhir |

**Rekomendasi urutan formula-touching: std-override (Fase 2) SEBELUM extra-workday (Fase 3)** — std-override
lebih sederhana (tak menambah baris, tak perlu ubah dispatcher). Urutan Fase 2/3 tetap keputusan owner
(dua-duanya formula-touching, independen). VIEW dibangun bertahap: lapis lock (F1) → std-override (F2) →
UNION extra (F3); pembaca cukup sekali dialihkan ke VIEW di F1.

---

## 8. Kontradiksi dengan fitur existing

1. **`updateStatus` UPDATE-only [READ:63-88]** → tak dipakai untuk 3 override (kita pakai tabel override +
   query-time). Endpoint baru = set/batal tiap override.
2. **Never-regenerate + freeze [READ]** → dijaga penuh (crux #1): override tak menulis `shift_roster`.
3. **Dispatcher `EXISTS shift_roster` [READ:1004]** → dengan query-time, **extra-workday** tak menambah
   baris ke `shift_roster` → Sabtu yang cuma punya extra-workday bisa salah jatuh ke fallback. **→
   dispatcher harus cek `roster_effective`, bukan `shift_roster` mentah (Fase 3).** **Std-override TIDAK
   kena** — ia memodifikasi baris auto yang sudah ada, hari itu sudah punya baris → dispatcher sudah benar.
4. **Cleanup hard-cutoff Sabtu OFF (sesi ini) [READ]** → extra-workday = mekanisme SAH menaruh operator di
   Sabtu ke depan. Komplementer. Jangan hidupkan half-day lama massal via ini (keputusan kebijakan).
5. **Fallback longgar** [READ:553] tetap isu terpisah di backlog (titik singgung §3/§8.3).

---

## 9. Titik singgung (DI LUAR lingkup — jangan digabung)

- **Lembur = SAP, bukan roster [READ].** 3 override tak menghitung/mengubah lembur; jam tetap ke SAP.
- **Per-plant config** = backlog terpisah (4 plantid, TZ global [READ]). Kalau kelak per-plant, tabel
  override + VIEW harus di-scope per plant.

---

## 10. Pertanyaan terbuka

**Tidak ada — semua terkunci (crux #1–#9, §0.5).** Item §10 sebelumnya sudah diputuskan: dua tabel;
urutan F2 std-override → F3 extra-workday; plafon std-override = `clock_hours` shift terkait.

---

## 11. Rincian Fase 1 — Shift-lock (RANCANGAN, belum kode/migrasi)

> Semua di bawah = spesifikasi untuk direview. DDL/SQL ditulis sebagai **artefak review di dokumen
> ini**, bukan file migrasi/kode. Commit-and-stop: Fase 1 selesai setelah 11.1–11.5 lulus.

### 11.1 DDL `operator_shift_lock`
```sql
CREATE TABLE ews.operator_shift_lock (
  id             bigserial PRIMARY KEY,
  serialnumber   text    NOT NULL,
  locked_shift   text    NOT NULL REFERENCES ews.operator_shift(shift_code),   -- DAY | NIGHT
  effective_from date    NOT NULL,
  lock_weeks     integer NOT NULL CHECK (lock_weeks > 0),
  created_by     text    NOT NULL,
  cancelled_at   timestamptz,                     -- soft-cancel (lihat catatan)
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ews_shift_lock_op ON ews.operator_shift_lock (serialnumber, effective_from)
  WHERE cancelled_at IS NULL;
```
**Catatan `cancelled_at` (di luar daftar kolom-mu — untuk review):** dibutuhkan §5 "batalkan" + edge 8.
Cancel = set `cancelled_at`; VIEW mengabaikan lock untuk tanggal ≥ hari cancel (forward), tetap berlaku
untuk tanggal lampau (tak korupsi snapshot beku + konsisten tampilan). Alternatif hard-DELETE: mengubah
`eff_shift` historis di getRoster (snapshot KPI beku tetap aman). **Rekomendasi: soft-cancel.**

**Lock habis di batas minggu:** `lock_end_exclusive = week_start(effective_from) + lock_weeks×7`, dengan
`week_start(d) = d − ((extract(dow from d)::int − <week_start_dow> + 7) % 7)`. `<week_start_dow>` dari `rotation_config` (=0 sekarang).

### 11.2 VIEW `ews.roster_effective` (Fase 1 — lock saja)
```sql
CREATE VIEW ews.roster_effective AS
SELECT r.serialnumber, r.business_date, r.status, r.source,
       COALESCE(lk.locked_shift, r.scheduled_shift)               AS eff_shift,
       COALESCE(os_lk.standard_hours, r.scheduled_standard_hours) AS eff_std
FROM ews.shift_roster r
LEFT JOIN ews.operator_shift_lock lk
       ON lk.serialnumber = r.serialnumber
      AND lk.cancelled_at IS NULL
      AND r.business_date >= lk.effective_from
      AND r.business_date <  (
            (lk.effective_from - ((extract(dow from lk.effective_from)::int - 0 + 7) % 7))
            + lk.lock_weeks * 7)
LEFT JOIN ews.operator_shift os_lk ON os_lk.shift_code = lk.locked_shift;
```
- Tanpa lock → `eff_shift = scheduled_shift`, `os_lk` NULL → `eff_std = scheduled_standard_hours` (beku).
- Lock aktif → `eff_shift = locked_shift`, `eff_std = operator_shift[locked_shift].standard_hours`
  (**dihitung ulang, bukan beku** — presedensi §3.2).
- Lock **tak menambah/menghapus baris** → dispatcher `EXISTS shift_roster` tetap benar di Fase 1
  (pindah ke `roster_effective` baru di Fase 3). Fase 2 sisipkan lapis std-override; Fase 3 UNION extra.

### 11.3 Titik alih 2 pembaca (diff rancangan)
1. **getRoster** (ewsRosterController.js:45): `FROM ews.shift_roster r JOIN ews.operator_shift os ON os.shift_code = r.scheduled_shift` → `FROM ews.roster_effective r JOIN ews.operator_shift os ON os.shift_code = r.eff_shift`; ganti `r.scheduled_shift → r.eff_shift`, `r.scheduled_standard_hours → r.eff_std`. Logika attendance/completed via `os` mengikuti `eff_shift`.
2. **adoption roster CTE** (ewsCalculator.js:711-724): sama — `FROM ews.roster_effective r`, join `operator_shift` on `r.eff_shift` (untuk `clock_hours`), `std := r.eff_std`. `expected_so_far` pakai `eff_std`.
3. **dispatcher** (ewsCalculator.js:1004): **TIDAK diubah** di Fase 1 (lock tak menambah baris). Dicatat untuk Fase 3.

### 11.4 Endpoint + UI
- `POST /ews/roster/lock` `{serialnumber, locked_shift, lock_weeks, effective_from?(default today)}` → INSERT. Validasi: `locked_shift ∈ operator_shift` aktif, `lock_weeks>0`, serialnumber ada.
- `POST /ews/roster/lock/:id/cancel` → set `cancelled_at`; nonaktif kalau seluruh rentang lock sudah lampau.
- `GET /ews/roster/locks` → daftar lock aktif (UI + preview).
- **UI** (EwsRosterConfigPage, card baru "Shift-Lock"): cari operator → pilih shift (DAY/NIGHT) → N minggu → simpan → "kebal rotasi s/d `<lock_end>`". Daftar lock aktif + tombol Batalkan. **Preview komposisi shift crew/hari** dari `roster_effective` (deteksi crew campur — edge 2).

### 11.5 Validasi angka sebelum/sesudah (query rancangan)
Jalankan pada rentang uji + ≥1 lock uji, bandingkan baca `shift_roster` (SEBELUM) vs `roster_effective` (SESUDAH):
- **(a) adoption total ~sama, split day/night bergeser:** bentuk mengikuti `calculateAdoptionLabourFromRoster` (denom Σ std `SCHEDULED`, plus `day_pct`/`night_pct`). Ambang lulus: `adoption_pct` total identik ±rounding; hanya split day/night bergeser sesuai jumlah operator yang pindah shift.
- **(b) std lock benar (bukan beku):**
```sql
SELECT r.serialnumber, r.business_date, r.eff_shift, r.eff_std,
       osx.standard_hours AS expect_from_shift
FROM ews.roster_effective r
JOIN ews.operator_shift osx ON osx.shift_code = r.eff_shift
WHERE r.serialnumber = '<operator terkunci>'
  AND r.business_date BETWEEN '<lock_from>' AND '<lock_end>';
-- LULUS: eff_std = expect_from_shift di SEMUA baris (bukan std NIGHT lama saat dikunci ke DAY)
```

### 11.6 Performa Fase 1 [READ EXPLAIN]
Baca rentang **7-hari** (lock disimulasi VALUES + join std): **Execution 1.76 ms**,
`Index Scan idx_ews_shift_roster_date` (501 baris), lock+`operator_shift` nested-loop kecil,
`Buffers shared hit=27` (nol disk). Baca satu-tanggal ≈0.76 ms. **Wajib** `EXPLAIN ANALYZE` pada VIEW
nyata (bukan VALUES) sebelum merge — ambang: <5 ms/baca, index-scan pada `business_date`, tanpa seq scan `shift_roster`.

---

**Terhubung:** [[concepts/ews-roster]] · [[PLANNING]] · `apps/api/services/rosterGenerator.js` · `apps/api/services/ewsCalculator.js` (Mode A :711-747, dispatcher :996-1008) · `apps/api/controllers/ewsRosterController.js` (getRoster :45)
