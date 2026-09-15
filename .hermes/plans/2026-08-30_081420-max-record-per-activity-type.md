# Max Record Duration per Activity Type (No Limit / nilai) — Implementation Plan

**Goal:** `max_record_minutes` yang sekarang cuma 3 kategori (VA/NNVA/NVA) dipecah jadi
**per jenis aktivitas**: sumber MCH di-kunci per `mch_statustypes.statusid`, sumber TIMESHEET
di-kunci per `timesheet_transaction.activitytype`. Setiap jenis bisa diset **angka menit**
atau **"No Limit"** (tidak pernah dipotong).

**Arsitektur:** tetap satu tempat penyimpanan `plant_config.sap_rules` (JSONB) + normalisasi
kembar di 3 pembaca (controller JS, python staging, dashboard rekonsiliasi). Cap di-apply di
titik yang SAMA seperti sekarang (tidak ada perubahan alur pipeline). "No Limit" = cap NULL →
`LEAST(x, NULL)` di Postgres mengabaikan NULL → nilai asli lolos utuh.

**Tech stack:** Express (apps/api), React+Vite (apps/web), Python psycopg2 (jobs/sap_staging),
PostgreSQL JSONB.

---

## 0. Keputusan user (2026-08-30)

| # | Keputusan | Pilihan |
|---|---|---|
| 1 | Kunci MCH | **1a** — per `statusid` (19 baris relevan) |
| 2 | Default kategori VA/NNVA/NVA | **menunggu** (user minta penjelasan beda 2a vs 2b) |
| 3 | Arti "No Limit" | **3a** — hanya bebas dari cap; break hours (non-produktif), gate kelayakan, `end_effective` TETAP berlaku |
| 4 | Tata letak UI | **4a** — section full-width paling bawah + 2 tab (Machine Hours / Timesheet) |
| 5 | Repo | **5a** — kerjakan di `D:\website\MPS2`, lalu port bersih ke `D:\website\MPS\MPS2` |
| 6 | Rebuild pending | **6a** — hanya simpan config; rebuild dijalankan user sendiri |
| + | Tambahan user | **Export/rekonsiliasi harus mendukung data TIMESHEET**, bukan MCH saja (lihat §7) |

---

## 1. Kondisi sekarang (verified 2026-08-30, DB BPN 5434)

### 1.1 Rules tersimpan

| DB | `sap_rules.max_record_minutes` |
|---|---|
| BPN (produksi, 5434) | `{"va": 300, "nnva": 150, "nva": 150}` |
| CKP (5441) | `150` (legacy angka tunggal — jalur backward-compat WAJIB tetap jalan) |

### 1.2 Titik apply cap hari ini

| Tempat | File | Ekspresi |
|---|---|---|
| MCH (bundle) | `jobs/sap_staging/stage_sap_timesheet.py` CTE `source_rows` ±line 156 | `LEAST(COALESCE(end_effective, enddatetime), startdatetime + (CASE M1→va / M2|idle-promotable→nnva / ELSE→nva END \|\| ' minutes')::interval)` (3 param `%s`) |
| TIMESHEET (per record) | `jobs/sap_staging/stage_timesheet_transaction.py` CTE `effective` ±line 139 | `LEAST(GREATEST(raw_seconds - break_seconds, 0), CASE WHEN activitytype='' THEN va ELSE nva END * 60)` (2 param) |
| Normalisasi JS | `apps/api/controllers/configRulesController.js:35 normalizeMaxRecordMinutes` | angka legacy → semua kategori |
| Normalisasi Python | `jobs/sap_staging/sap_staging_common.py:78 normalize_max_record_minutes` | idem |
| Rekonsiliasi | `apps/api/controllers/dashboardController.js:1483 loadMaxRecordMinutes`, `:1506 CAP_CUT_SECONDS`, `:1522 END_CAPPED_EXPR` | CASE identik dengan staging (wajib sinkron) |
| FE | `apps/web/src/pages/ConfigurationRulesPage.jsx` (`MAX_RECORD_KEYS` :47, `MaxRecordRow` :103, render :468-506) | 3 baris input di rail kanan |

### 1.3 Master data (yang akan jadi baris konfigurasi)

`mch_statustypes` (22 baris) — statusid → activitytype → kategori sekarang:

| statusid | description | activitytype | kategori | dipakai staging? |
|---|---|---|---|---|
| 1 | Productive | M1 | VA | ya |
| 6,7,8,9,10 | Load, Setting, Measure, Unload, Preventive | M2 | NNVA | ya |
| 2 | Idle | 1670 | NVA (≤300s setelah Productive → dipromosikan NNVA) | ya |
| 5 | Unidentified | 1670 | NVA | ya, **hanya ≤60 detik** |
| 3, 11 | Downtime, Breakdown | 1650 | NVA | 3 **TIDAK** (gate `statusid NOT IN (0,3,4)`), 11 ya |
| 0, 4 | Off, No Job | 1670 | NVA | **TIDAK** (gate) |
| 12..21 | Coffee Break/Lunch, Daily PM, Tool Preparation, Labour Necessity, Jig Fixtures, Waiting for Engineer, Waiting for Inspection, Waiting for NCR, Wait For Handling, Wait For Material | 1520,1660,1620,1640,1610,1570,1580,1560,1590,1550 | NVA | ya |

→ **19 statusid relevan** untuk konfigurasi (semua kecuali 0, 3, 4).

`ews.activity_type_ref` (17 kode, semua `is_unproductive=true`) + 1 baris sintetis
"(productive)" untuk `activitytype` kosong → **18 baris** konfigurasi TIMESHEET.

### 1.4 Data 30 hari terakhir (BPN) — jenis mana yang benar-benar kena cap

MCH (durasi mentah `coalesce(end_effective, enddatetime) - startdatetime`):

| statusid | description | rows | jam | >90 mnt | maks (mnt) |
|---|---|---|---|---|---|
| 1 | Productive | 14.090 | 1.481,9 | 52 | 2.246 |
| 2 | Idle | 12.787 | 195,1 | 10 | 1.238 |
| 5 | Unidentified | 13.431 | 14,3 | 0 | 44 |
| 7 | Setting | 3.109 | 727,5 | 15 | 1.239 |
| 8 | Measure | 4.213 | 586,9 | 6 | 1.239 |
| 12 | Coffee Break / Lunch | 911 | 387,4 | 9 | 2.878 |
| 20 | Wait For Handling | 695 | 276,6 | 14 | 1.400 |
| 6 / 9 / 10 | Load / Unload / Preventive | 571 / 452 / 17 | 78,9 / 53,4 / 0,0 | 0 | ≤87 |
| 11 | Breakdown | 16 | 14,1 | 4 | 237 |
| 13..19, 21 | sisanya | 141..10 | ≤101,3 | 0-1 | ≤2.426 |
| (0, 3, 4) | Off/Downtime/No Job — tidak di-stage | 1.793/154/3.857 | 4.618/1.722/11.105 | — | — |

TIMESHEET:

| activitytype | description | rows | jam | >90 mnt | maks (mnt) |
|---|---|---|---|---|---|
| (kosong) | productive / kerja order | 8.040 | 8.480,1 | **1.714** | 1.474 |
| 1520 | Coffee Breaks | 2.961 | 548,4 | 5 | 1.450 |
| 1510 | Briefing | 1.796 | 559,9 | 4 | 1.453 |
| 1530 | Housekeeping | 1.735 | 359,8 | 5 | 913 |
| 1620 | Tool Preparation | 1.530 | 544,0 | 17 | 1.456 |
| 1670 | Waiting for Job | 1.243 | 1.825,5 | **310** | 768 |
| 1590 | Waiting for Handling | 898 | 726,2 | 82 | 5.388 |
| 1660 | Daily PM | 797 | 177,9 | 9 | 355 |
| 1540 | Training | 210 | 320,7 | 102 | 241 |
| 1650 | Machine/Electricity Breakdown | 166 | 342,4 | 75 | 1.610 |
| 1640, 1580, 1630, 1610, 1570, 1680, 1550, 1560 | sisanya | 157..2 | ≤60,3 | ≤8 | ≤177 |

**Kesimpulan data:** yang paling terpengaruh cap = TIMESHEET productive (1.714 record >90 mnt),
TIMESHEET 1670 Waiting for Job (310), 1540 Training (102), 1590 (82), 1650 (75), lalu MCH
statusid 1 (52) & 2/7/12/20. Jenis dengan `>90 mnt = 0` (MCH 5,6,9,10,13,14,16,19 dan
TIMESHEET 1570,1550,1560) praktis tidak terpengaruh apa pun nilainya.

---

## 2. Desain

### 2.1 Struktur JSON baru (`plant_config.sap_rules.max_record_minutes`)

```json
{
  "va": 300,
  "nnva": 150,
  "nva": 150,
  "mch": { "1": 300, "2": null, "7": 120, "12": 30 },
  "timesheet": { "": 480, "1520": 30, "1670": null }
}
```

- `va` / `nnva` / `nva` = **default per kategori** (dipakai kalau jenisnya tidak punya entry).
  Struktur lama tetap valid → **tanpa migrasi DB**, config BPN & CKP sekarang langsung jalan.
- `mch` = map `statusid` (string) → menit. `timesheet` = map `activitytype` → menit,
  key `""` = productive (kerja order).
- **`null` = No Limit** (tidak pernah dipotong). Beda dengan key yang TIDAK ADA
  (= pakai default kategori) — di JSONB dua hal ini bisa dibedakan:
  `jsonb_typeof(x->'k')` = `'null'` untuk null eksplisit, `NULL` (SQL) untuk key hilang.
- Legacy `max_record_minutes: 150` (CKP) → normalizer memetakan ke ketiga kategori,
  `mch`/`timesheet` kosong → perilaku HARI INI persis sama (zero-behaviour-change default).

### 2.2 Resolusi cap per record (satu aturan, dipakai 3 tempat)

```
MCH:
  cap = mch[statusid]                jika key ada  (null → No Limit)
      = va                           jika status_activitytype = 'M1'
      = nnva                         jika 'M2' atau idle-promotable (statusid 2 ∧ prev 1 ∧ ≤300s)
      = nva                          selain itu

TIMESHEET:
  cap = timesheet[activitytype]      jika key ada  (key '' untuk productive; null → No Limit)
      = va                           jika activitytype kosong
      = nva                          selain itu
```

Catatan idle-promotable: kalau `mch["2"]` diset, nilai itu berlaku untuk SEMUA statusid 2
(termasuk yang dipromosikan ke M2). Praktis tidak bermasalah — idle yang dipromosikan
selalu ≤300 detik (5 menit), jadi cap ≥5 menit tidak pernah menyentuhnya.

### 2.3 SQL: cap dari JSONB (bukan CASE panjang 19 cabang)

Tambah SATU parameter JSONB `rules_json` (sudah dinormalisasi di Python/JS), lalu:

```sql
-- fragmen cap menit untuk MCH (dipakai di source_rows)
CASE
  WHEN jsonb_typeof(%(rules)s::jsonb -> 'mch' -> statusid::text) = 'null' THEN NULL
  WHEN (%(rules)s::jsonb -> 'mch' ->> statusid::text) ~ '^[0-9]+$'
    THEN (%(rules)s::jsonb -> 'mch' ->> statusid::text)::int
  WHEN status_activitytype = 'M1' THEN %(va)s::int
  WHEN status_activitytype = 'M2'
    OR (statusid = 2 AND previoustatusid = 1
        AND COALESCE(duration_seconds, EXTRACT(EPOCH FROM (enddatetime - startdatetime))) <= 300)
    THEN %(nnva)s::int
  ELSE %(nva)s::int
END
```

`LEAST(COALESCE(end_effective, enddatetime), startdatetime + (cap || ' minutes')::interval)`
→ kalau cap NULL, `startdatetime + NULL` = NULL, dan **LEAST mengabaikan NULL** → hasil =
`COALESCE(end_effective, enddatetime)` (tidak dipotong). Ini yang membuat "No Limit" bekerja
tanpa cabang tambahan. **WAJIB diverifikasi dengan query nyata sebelum lanjut** (Task 1).

TIMESHEET sama polanya dengan key `COALESCE(activitytype,'')`:
`LEAST(GREATEST(raw_seconds - break_seconds, 0), cap * 60)` → cap NULL = tanpa potongan.

> Catatan: `stage_sap_timesheet.py` sekarang memakai placeholder posisional `%s` dengan
> urutan param yang ketat (12 param, lihat `references/sap-staging-break-verification.md`).
> Menambah param JSONB berarti **menyisipkan 1 nilai di posisi yang tepat**; kalau ragu,
> ubah query ini ke named placeholder `%(name)s` sekalian (psycopg2 mendukung, tapi harus
> konsisten SATU gaya per query — campur posisional & named = error).

### 2.4 Endpoint katalog jenis aktivitas (baru)

`GET /config/activity-catalog` → sumber baris UI, dibaca dari master (bukan hardcode):

```json
{
  "data": {
    "mch": [ { "statusid": 1, "description": "Productive", "activitytype": "M1",
               "category": "va", "staged": true } ],
    "timesheet": [ { "activitytype": "", "description": "Productive (order work)", "category": "va" },
                   { "activitytype": "1520", "description": "Coffee Breaks", "category": "nva" } ]
  }
}
```

- `mch` dari `mch_statustypes` (`staged=false` untuk statusid 0/3/4 — gate staging),
  `category` diturunkan dari activitytype (M1→va, M2→nnva, else nva).
- `timesheet` dari `ews.activity_type_ref` + satu baris sintetis `""`.
- Read-only, tidak masuk RBAC manifest (konvensi: manifest write-only).

### 2.5 UI (ConfigurationRulesPage)

- Card "Max Record Duration" **pindah dari rail kanan ke section full-width paling bawah**
  (`xl:col-span-12`) karena isinya jadi 19 + 18 baris. Rail kanan menyisakan Rebuild Pending
  + General Settings (dekoratif, jangan disentuh).
- Di dalamnya: segmented control 2 tab — **Machine Hours (by status)** / **Timesheet (by activity type)**
  (gaya tab existing: container `bg-slate-100 p-1 rounded-lg`, pill aktif `bg-white shadow-sm
  text-[#0077b6]`, TANPA `transition-all`).
- Baris konfigurasi (komponen baru `MaxRecordTypeRow`): `[description]` + chip kode
  (`M1`/`1520`/`statusid 7`) + badge kategori (VA/NNVA/NVA) + **toggle "No Limit"** +
  input menit (disabled saat No Limit) + tombol kecil "Default" (hapus entry → ikut default kategori,
  input menampilkan nilai default sebagai placeholder abu).
- Grup di dalam tab pakai label uppercase kecil (`Productive` / `Unproductive`) seperti sekarang.
- Baris "Default per category" (VA/NNVA/NVA) tetap ada di atas kedua tab — 3 input existing.
- Baris `staged=false` (statusid 0/3/4) **tidak ditampilkan** (tidak pernah dikirim ke SAP →
  konfigurasinya menyesatkan).
- Tanpa banner/help text baru (konvensi user), badge existing "applied in SAP staging" tetap.

---

## 3. Rencana langkah (bite-sized, TDD)

### Task 0 — Cek asumsi Postgres: LEAST + NULL

**Objective:** pastikan "No Limit" = cap NULL benar-benar tidak memotong.

```sh
cd /d/website/MPS2 && export DBQ_DSN="postgresql://tag:%40dminta9@127.0.0.1:5434/ptssb"
uv run --with 'psycopg[binary]' python <skill_dir>/scripts/dbq.py <<'EOF'
select least(timestamp '2026-01-01 10:00', timestamp '2026-01-01 08:00' + (null || ' minutes')::interval) as no_limit_end,
       least(3600::bigint, null::bigint * 60) as no_limit_seconds;
EOF
```
Expected: `no_limit_end = 2026-01-01 10:00`, `no_limit_seconds = 3600`.
Kalau TIDAK sesuai → ganti desain "No Limit" jadi sentinel besar (mis. 100000 menit).

### Task 1 — Normalizer JS + test

**Files:** modify `apps/api/controllers/configRulesController.js`
(`normalizeMaxRecordMinutes` :35, komentar header :3-14), test baru
`apps/api/scripts/test_config_rules_normalize.js` (temp, hapus setelah dipakai).

Bentuk baru:

```js
const MAX_RECORD_KEYS = ["va", "nnva", "nva"];
const MAX_RECORD_DEFAULT = 90;

function parseMinutes(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

// map per jenis: nilai integer >=1, atau null = No Limit. Key yang tidak valid dibuang.
function normalizeTypeMap(raw, keyRe) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const k = String(key);
    if (!keyRe.test(k)) continue;
    if (value === null) { out[k] = null; continue; }   // No Limit
    const n = parseMinutes(value);
    if (n !== null) out[k] = n;                        // angka valid; sampah => entry dibuang
  }
  return out;
}

function normalizeMaxRecordMinutes(raw) {
  if (raw && typeof raw === "object") {
    const out = {};
    for (const key of MAX_RECORD_KEYS) out[key] = parseMinutes(raw[key]) ?? MAX_RECORD_DEFAULT;
    out.mch = normalizeTypeMap(raw.mch, /^\d+$/);          // statusid
    out.timesheet = normalizeTypeMap(raw.timesheet, /^\d*$/); // activitytype, '' = productive
    return out;
  }
  const minutes = parseMinutes(raw) ?? MAX_RECORD_DEFAULT;
  return { va: minutes, nnva: minutes, nva: minutes, mch: {}, timesheet: {} };
}
```

Test wajib (assert sederhana, `process.exitCode`):
1. `150` → `{va:150,nnva:150,nva:150,mch:{},timesheet:{}}`
2. `{va:300,nnva:150,nva:150}` (BPN sekarang) → sama + map kosong
3. `{mch:{"1":300,"2":null,"bogus":5},timesheet:{"":480,"1520":30,"xx":9}}` → key `bogus`/`xx` dibuang, `"2"` = null
4. `{mch:{"1":0}}` → entry dibuang (0 bukan No Limit; No Limit = null)
5. round-trip: `normalizeRules(normalizeRules(x))` idempoten

Run: `cd apps/api && node scripts/test_config_rules_normalize.js` → Expected: `5/5 pass`.

### Task 2 — Normalizer Python + test

**Files:** modify `jobs/sap_staging/sap_staging_common.py` (`normalize_max_record_minutes` :78,
docstring `load_sap_rules` :101). Tambah helper:

```python
def _normalize_type_map(raw, key_pattern) -> dict:
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key, value in raw.items():
        k = str(key)
        if not re.fullmatch(key_pattern, k):
            continue
        if value is None:
            out[k] = None
            continue
        try:
            n = int(value)
        except (TypeError, ValueError):
            continue
        if n >= 1:
            out[k] = n
    return out
```

`normalize_max_record_minutes` mengembalikan
`{"va":..,"nnva":..,"nva":..,"mch":{...},"timesheet":{...}}` — **kunci `va/nnva/nva` tetap ada**
supaya pemanggil lama (`int(max_record.get("va", 90))`) tidak pecah.

Test: `jobs/sap_staging/test_normalize_max_record.py` (5 kasus sama dengan Task 1) →
`uv run python jobs/sap_staging/test_normalize_max_record.py` Expected `5/5 pass`
(+ `python -m py_compile` bersih).

### Task 3 — Apply cap MCH per statusid

**Files:** modify `jobs/sap_staging/stage_sap_timesheet.py` (±line 132-168 + daftar param).

1. Setelah `rules = load_sap_rules(conn)`: `max_record_json = json.dumps(rules["max_record_minutes"])`.
2. Ganti CASE cap dengan fragmen di §2.3 (lookup `mch` dulu, fallback kategori).
3. Sisipkan param JSONB pada posisi yang benar (hitung ulang urutan `%s`; kalau query
   dikonversi ke named placeholder, ubah SEMUA placeholder di query yang sama).
4. Update komentar blok (tanpa menambah prosa AI — deskriptif teknis, gaya file existing).

Verifikasi: `python -m py_compile jobs/sap_staging/stage_sap_timesheet.py`, lalu dry-run
harness Task 5.

### Task 4 — Apply cap TIMESHEET per activitytype

**Files:** modify `jobs/sap_staging/stage_timesheet_transaction.py` (CTE `effective` ±139).

```sql
LEAST(
  GREATEST(raw_seconds - break_seconds, 0),
  (CASE
     WHEN jsonb_typeof(%(rules)s::jsonb -> 'timesheet' -> COALESCE(activitytype,'')) = 'null' THEN NULL
     WHEN (%(rules)s::jsonb -> 'timesheet' ->> COALESCE(activitytype,'')) ~ '^[0-9]+$'
       THEN (%(rules)s::jsonb -> 'timesheet' ->> COALESCE(activitytype,''))::int
     WHEN COALESCE(activitytype,'') = '' THEN %(va)s::int
     ELSE %(nva)s::int
   END) * 60
) AS effective_seconds
```

Perhatian: `activitytype` mentah bisa ada spasi → pakai `BTRIM(COALESCE(activitytype,''))`
konsisten dengan tempat lain di file itu.

### Task 5 — Dry-run harness (tanpa menyentuh plant_config produksi)

**File baru (temp):** `jobs/sap_staging/dryrun_max_record.py`

- monkeypatch: `stage_sap_timesheet.load_sap_rules = lambda conn: FAKE_RULES` dan idem untuk
  modul timesheet → **tidak ada UPDATE ke `plant_config` produksi**.
- Skenario:
  1. `FAKE = {va:300,nnva:150,nva:150}` (BPN sekarang, map kosong) → hasil bundle/rows harus
     **IDENTIK** dengan output sebelum perubahan (baseline no-behaviour-change).
  2. `FAKE + mch:{"1":null}` → total detik statusid 1 naik (record 2.246 mnt tidak dipotong lagi).
  3. `FAKE + mch:{"12":30}` → Coffee Break/Lunch terpotong 30 mnt.
  4. `FAKE + timesheet:{"":null,"1670":30}` → productive utuh, Waiting for Job dipotong.
- Rentang uji: 3 hari yang datanya kaya (mis. `--from 2026-08-20 --to 2026-08-23`).
- Output: tabel `skenario | rows | total_hours | delta vs baseline`.

Expected: skenario 1 delta = 0,0 jam (bukti aman); skenario 2-4 delta sesuai arah.
**Hapus file ini setelah dipakai** (berisi kredensial dari .env saat dijalankan).

### Task 6 — Rekonsiliasi (dashboardController) ikut sinkron

**Files:** modify `apps/api/controllers/dashboardController.js` (`loadMaxRecordMinutes` :1483,
`CAP_CUT_SECONDS` :1506, `END_CAPPED_EXPR` :1522).

- `loadMaxRecordMinutes` pakai normalizer yang sama (export dari configRulesController supaya
  DRY: `const { normalizeMaxRecordMinutes } = require("./configRulesController")`).
- Kedua fragmen SQL: sisipkan lookup `mch` seperti §2.3. Karena keduanya string-interpolasi,
  gunakan **scalar subquery ke plant_config** (pola yang sudah dipakai `BREAK_CUT_SECONDS`)
  daripada meng-inline JSON:
  `(SELECT sap_rules->'max_record_minutes'->'mch' FROM public.plant_config WHERE id=1)`.
- Kolom "Cut (max record)" harus 0 untuk jenis No Limit.

Verifikasi: `node --check`, lalu bandingkan `GET /dashboard/sap-reconciliation-records`
(1 hari) sebelum vs sesudah dengan rules BPN sekarang → **angka tidak boleh berubah**.

### Task 7 — Endpoint katalog

**Files:** modify `apps/api/controllers/configRulesController.js` (+`getActivityCatalog`),
`apps/api/routes/config.js` (registrasi GET), test controller (mock res).

Query:
```sql
SELECT statusid, description, activitytype FROM public.mch_statustypes ORDER BY statusid;
SELECT activitytype, description FROM ews.activity_type_ref ORDER BY activitytype;
```
`staged = statusid NOT IN (0,3,4)`; `category` = M1→va / M2→nnva / else nva.
Kalau schema `ews` tidak ada (CKP?) → tangkap error, balas array timesheet kosong
(FE fallback: tampilkan hanya baris productive).

### Task 8 — FE: state + fetch + payload

**Files:** modify `apps/web/src/pages/ConfigurationRulesPage.jsx`.

- `normalizeMaxRecord` (FE :55) ikut struktur baru (map + null).
- state: `maxRules` (default kategori) + `typeRules` (`{mch:{}, timesheet:{}}`) + `catalog`.
- `loadRules()` fetch `/config/rules` DAN `/config/activity-catalog` paralel (`Promise.all`).
- `handleSave` kirim `max_record_minutes: { ...maxRules, mch, timesheet }`.
- Guard: kalau catalog gagal → tab per-jenis disabled, 3 default tetap bisa disimpan.

### Task 9 — FE: komponen baris + tab

**Files:** modify `ConfigurationRulesPage.jsx` (komponen `MaxRecordTypeRow` baru, render §2.5).

- Toggle No Limit pakai komponen `Toggle` existing (geometri h-6 w-10 + translate-x-4 — jangan
  bikin toggle baru).
- Input disabled saat No Limit (`bg-slate-100 text-slate-400`), placeholder = nilai default kategori.
- Tombol "Default" hapus key dari map (bukan set 0).
- Semua state punya border (konvensi: kalau satu state pakai border, semua pakai border).

Verifikasi: `cd apps/web && npx eslint src/pages/ConfigurationRulesPage.jsx` → 0 error;
`npm run build` SUCCESS.

### Task 10 — Verifikasi end-to-end di browser (dev, tanpa login)

- `sessionStorage.setItem('isVerified','true')` + `authUser` administrator (JANGAN set
  `authPermissions`), buka `/config-rules`.
- Set `mch:{"1":"No Limit"}` + `timesheet:{"1670":30}` → Save → GET ulang → nilai persist
  (`jsonb_pretty(sap_rules)` di DB menunjukkan `"1": null`).
- **JANGAN** klik "Rebuild pending" di produksi tanpa persetujuan user (menyentuh antrian
  PENDING nyata) — cukup verifikasi tulisan config.

### Task 11 — Docs + port ke repo produksi

- `docs/log/2026-08-30-max-record-per-activity-type.md` (frontmatter title/date/tags) + baris di
  `docs/00-INDEX.md`; update `references/sap-staging-config-rules.md` (skill mps2-development)
  bagian struktur JSON + titik apply.
- Port ke `D:\website\MPS\MPS2` = **patch region yang sama, versi TANPA komentar JS/docstring
  Python** (jangan `cp` mentah). Verifikasi: `grep -c '//' <file FE>` = 0, `node --check`,
  `python -m py_compile`.
- Tanpa migrasi SQL (JSONB + normalisasi backward-compatible).

---

## 4. Tests / validation ringkas

| Level | Perintah | Expected |
|---|---|---|
| Postgres asumsi | query Task 0 | LEAST abaikan NULL |
| Normalizer JS | `node apps/api/scripts/test_config_rules_normalize.js` | 5/5 pass |
| Normalizer Python | `uv run python jobs/sap_staging/test_normalize_max_record.py` | 5/5 pass |
| Syntax | `node --check` (2 controller), `python -m py_compile` (3 file) | bersih |
| Controller | test mock res untuk GET/PUT `/config/rules` + `/config/activity-catalog` | 200 + struktur |
| Dry-run staging | `dryrun_max_record.py` skenario 1-4 (BPN, 3 hari) | skenario 1 delta 0 |
| Rekonsiliasi | records 1 hari sebelum vs sesudah (rules lama) | angka identik |
| FE | eslint + `npm run build` + cek browser | 0 error, persist |

---

## 5. Risiko & catatan

1. **Rekonsiliasi vs staging harus SATU arah.** `CAP_CUT_SECONDS`/`END_CAPPED_EXPR` wajib
   diubah bersamaan; kalau tidak, kolom "Cut (max record)" jadi bohong (pernah kena: kolom
   break cut tidak ada → angka menyesatkan).
2. **Urutan parameter `%s` di stage_sap_timesheet.py rapuh** (12 param terdokumentasi).
   Menyisipkan param JSONB salah posisi = query jalan tapi angka ngawur. Mitigasi: konversi
   query itu ke named placeholder, atau tulis ulang daftar param + assert jumlah.
3. **"No Limit" untuk NVA = jam unproduktif besar terkirim ke SAP.** Contoh nyata: TIMESHEET
   1670 Waiting for Job 1.825 jam/30 hari, 310 record >90 mnt; MCH statusid 12 pernah 2.878 mnt
   (48 jam) satu record. Perlu kesadaran bisnis, bukan cuma teknis.
4. **Cap kecil di productive memotong jam yang sah** — statusid 1 pernah 2.246 mnt (37 jam)
   karena record "nyangkut" (HMI putus). Cap VA 300 mnt sekarang justru pengaman; jangan
   diset No Limit tanpa perbaikan `end_effective`.
5. **Rules baru hanya berlaku untuk staging BERIKUTNYA.** Antrian PENDING lama perlu
   `rebuild_pending --from <tanggal>` (tombol di halaman) — POSTED tidak tersentuh.
   Worker tidak perlu restart untuk perubahan rules (script baca DB tiap run), TAPI perlu
   restart kalau file Python-nya berubah → **Task 3/4 mengubah file staging, jadi
   `docker compose restart sap-stage-worker sap-ops-worker` wajib setelah deploy**.
6. **CKP masih legacy `150`** — jalur angka tunggal harus tetap hidup (jangan hapus cabang legacy).
7. statusid 0/3/4 disembunyikan; kalau nanti gate staging berubah, baris ini harus muncul lagi
   (`staged` flag dari katalog, bukan hardcode di FE).

---

## 6. Keputusan yang menunggu user (tulis sebagai `1a 2b 3…`)

Sudah dijawab: 1a, 3a, 4a, 5a, 6a (lihat §0). Sisa: **nomor 2** (default kategori) dan
**nomor 7** (bentuk sheet Records timesheet di export, lihat §7).

2. **Default kategori VA/NNVA/NVA**: (a) tetap ada sebagai fallback untuk jenis yang tidak
   diatur · (b) hapus, semua 37 jenis wajib punya nilai eksplisit

---

## 7. TAMBAHAN USER: rekonsiliasi & export harus mencakup TIMESHEET

### 7.1 Temuan (verified 2026-08-30, dashboardController.js)

Seluruh rekonsiliasi hari ini **MCH_HOURS saja** — `source_system = 'MCH_HOURS'` di-hardcode di:

| Bagian | Line |
|---|---|
| funnel Summary + By Date (`loadSapReconciliationData`) | 1587, 1600, 1610, 1612 |
| sheet Bundles (export) | 1790-1812 |
| sheet Records (export, per segmen MCH) | 1848-1893 |
| day view (level-2 bundle) | 1958-1986 |
| tabel Records paginated (`getSapReconciliationRecords`) | 2020-2056 |
| exclude/unexclude record | 2079-2090, 2127, 2163 |

Akibatnya: 8.040 record productive + ±13.600 record unproduktif TIMESHEET (30 hari BPN)
**tidak pernah tampil** di panel rekonsiliasi maupun file Excel — padahal justru di situ
cap paling banyak menggigit (1.714 record productive >90 mnt).

Beda struktur yang harus dihormati:
- MCH: 1 bundel = banyak segmen (`sap_staging_source` = provenance per `proddataid`).
- TIMESHEET: **1 baris staging = 1 `tsnumber`** — tidak ada tabel provenance, jadi
  "record" = baris staging itu sendiri (`source_key`), tanpa bundling per hari.
- TIMESHEET tidak punya `bucket_start` (NULL by design) → pengelompokan tanggal pakai
  `synthetic_start`/`source_min_start` atau `longdate_checkin` dari sumber.

### 7.2 Task 12 — Records TIMESHEET (API)

**Files:** modify `apps/api/controllers/dashboardController.js`.

1. `TS_RECORD_SELECT` baru: join `sap_timesheet_staging st` (`source_system='TIMESHEET'`)
   ke `timesheet_transaction t` on `t.tsnumber::text = st.source_key`, kolom:
   `tsnumber, pernr, activitytype + description (ews.activity_type_ref), order_no, operation_no,
   workcentercode, checkin, checkout, raw_seconds, break_cut_seconds, cap_cut_seconds,
   recognized_seconds (= st.total_seconds), status, posted_at, sap_response_text`.
2. `break_cut` & `cap_cut` untuk TIMESHEET = versi SQL yang **identik dengan
   stage_timesheet_transaction.py** (break hanya untuk `activitytype <> ''`; cap dari
   lookup `timesheet` → fallback va/nva). Jangan menyalin rumus MCH.
3. `getSapReconciliationRecords` dapat param `source=mch|timesheet|all` (default `all`)
   → UNION ALL dengan kolom seragam (kolom khas MCH diisi NULL untuk timesheet dan
   sebaliknya) + pagination & search tetap server-side.
4. Funnel Summary & By Date: tambah baris/kolom TIMESHEET (rows eligible → staged →
   posted → failed/skipped) di samping MCH, jangan menimpa angka MCH.

### 7.3 Task 13 — Export Excel

**Files:** modify `apps/api/controllers/dashboardController.js` (fungsi export).

- Sheet `Summary` & `By Date`: tambah kolom TIMESHEET (rows, hours, posted, cut).
- Sheet `Records`: **keputusan 7** —
  (a) sheet terpisah `Records (Timesheet)` dengan kolom khas timesheet, atau
  (b) satu sheet `Records` dengan kolom `Source` (MCH/TIMESHEET) dan kolom yang tidak
      relevan dikosongkan.
- PITFALL exceljs: **key kolom duplikat = overwrite senyap** (pernah kena `src_sys`/`src_hrs`)
  → pakai prefix key `ts_*` untuk kolom timesheet.
- Test export: mock `res` = `PassThrough`, cek `buf.subarray(0,2) === 'PK'` +
  `Content-Disposition` + jumlah worksheet.

### 7.4 Task 14 — FE panel rekonsiliasi

**Files:** modify `apps/web/src/pages/**/ReconciliationPanel*` (cari komponen yang memakai
`sap-reconciliation-records`).

- Tambah segmented filter `Source: All / Machine hours / Timesheet` (gaya tab existing).
- Kolom yang tidak relevan per source disembunyikan (bukan ditampilkan kosong) supaya tabel
  tidak melebar tanpa guna; container tetap `max-w-full` (pitfall lama: `max-w-6xl` memotong tabel).
- Baris kena break = latar amber + ikon ⏸ (konsisten dengan yang sudah ada), baris kena cap =
  chip "cap cut Xm".

### 7.5 Catatan penting untuk exclusion

`sap_staging_exclusion.source_system` sekarang hanya diisi `'MCH_HOURS'`, dan guard poster
memeriksa provenance MCH. Menampilkan record TIMESHEET di panel akan memunculkan ekspektasi
tombol Exclude juga jalan di sana. Itu **pekerjaan terpisah** (butuh: dukungan
`source_system='TIMESHEET'` di exclusion + staging `NOT EXISTS` di
stage_timesheet_transaction.py + guard poster) — di plan ini tombol Exclude
**disembunyikan untuk baris TIMESHEET** sampai user memutuskan.

