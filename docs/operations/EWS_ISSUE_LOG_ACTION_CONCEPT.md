# EWS — Issue Log & Action Table: Cara Kerja + Konsep Ulang

> Dokumen ini menjelaskan **cara kerja sekarang** (as-is) lalu menyediakan bagian
> **LOGIC yang bisa kamu edit**. Edit bagian bertanda ✏️, lalu aku implementasikan.
> Referensi kode disertakan (`file:line`) supaya perubahan mudah ditelusuri.

---

## 1. Peta cepat (siapa menghasilkan apa)

```
KPI detail (source_detail: by_machine / by_operator / by_error_type)
        │  dihitung backend: /ews/kpi/:type/detail
        ▼
[FE] buildActionRows()      → satu baris per entitas (mesin/operator/kategori error)
        │  tandai row.isIssue (gate eskalasi)
        ▼
[FE] buildIssuePayloads()   → hanya isIssue, key stabil (tanpa jam) → payload
        │  POST /ews/actions/sync
        ▼
[BE] syncActions()          → UPSERT ke ews.action_table (ON CONFLICT issue_key)
        │  issue BARU → enqueue TTS
        ▼
[BE] getActions()           → baca action_table + hitung escalation_level saat baca
        │  GET /ews/actions
        ▼
[FE] buildIssueRows()       → render "Issue Log" + tombol Resolve
        │  PUT /ews/actions/:id/resolve
        ▼
[BE] resolveAction()        → set Closed + tulis ews.action_history
```

**Poin paling penting (dan paling mungkin ingin kamu ubah):**
> **Issue di-generate di FRONTEND, saat halaman detail dibuka.** Job snapshot/adoption
> **tidak** membuat issue sendiri. Artinya: kalau tak ada yang membuka halaman EWS detail,
> **tidak ada issue yang tercatat**. (Lihat §6 — ini kelemahan utama untuk sebuah *Early
> Warning System*.)

---

## 2. Sumber data → baris aksi (`buildActionRows`)

File: `apps/web/src/pages/EwsDetailPage.jsx:482`. Dispatch per KPI:

| KPI | Sumber breakdown | Fungsi | Satu baris = |
|-----|------------------|--------|--------------|
| uptime | `source_detail.by_machine` | `buildUptimeRows` (`:362`) | 1 mesin |
| accuracy | `source_detail.by_error_type` | `buildAccuracyRows` (`:387`) | 1 kategori error |
| adoption | `source_detail.by_machine` | `buildAdoptionRows` (`:418`) | 1 mesin |
| oee | `source_detail.by_machine` | `buildOeeRows` (`:440`) | 1 mesin |
| ole | `source_detail.by_operator` | `buildOleRows` (`:461`) | 1 operator |

Tiap baris berisi: `area, metric, detail, severity (Normal/Watch/Critical), errorType,
action (saran teks), pic, sortValue, isIssue`.

### ✏️ LOGIC A — Aturan `isIssue` (gate: baris mana yang jadi issue)
Ini yang menentukan apa yang naik ke Issue Log. **Edit kolom "Aturan baru" bila mau ubah.**

| KPI | Aturan sekarang | Aturan baru (edit di sini) |
|-----|-----------------|----------------------------|
| uptime | `max_consecutive_fail >= 6` (offline nyata, bukan blip) | |
| accuracy | KPI status `critical`/`watch` **DAN** `minimum_sample_met` | |
| adoption | KPI status `critical`/`watch` | |
| oee | status entitas `critical`/`watch` (per mesin) | |
| ole | status entitas `critical`/`watch` (per operator) | |

### ✏️ LOGIC B — Severity per baris
Sekarang: uptime `real?Critical:Watch`; accuracy/adoption `kpiStatus==critical?Critical:Watch`;
oee/ole `sevFromStatus(status)`.
- Aturan severity yang kamu mau: _______________________________________________

### ✏️ LOGIC C — Teks `action` (saran tindakan) & `pic` default
Sekarang di-hardcode per KPI (mis. uptime real → "Cek power/network device, restart HMI, notify IT").
- Perubahan teks/PIC per kategori: _____________________________________________

---

## 3. Pembentukan payload issue (`buildIssuePayloads`)
File: `EwsDetailPage.jsx:497`. Hanya baris `isIssue`, **maks 15**.

### ✏️ LOGIC D — Kunci dedup (`issue_key`) — SANGAT PENTING
```
issue_key = `${kpi.key}:${bizDate}:${row.scope}:${entity}`
```
- **Tanpa jam** → re-sync meng-UPDATE baris yang sama (bukan bikin baru tiap refresh).
- `bizDate` = business date (shift-aware). `scope` = machine/operator/error_type. `entity` = id/area.
- Konsekuensi: **satu issue per (KPI, hari, entitas)**. Kalau mesin X gagal 3× dalam sehari → tetap 1 baris (ter-update), bukan 3.
- ✏️ Apakah grain ini benar? Mau **per shift** (tambah shift ke key)? Per kejadian? Edit:
  - Grain issue baru: __________________________________________________________
- ✏️ Batas 15 issue/sync — mau diubah? ______________

### Kolom payload lain
`scope_type, scope_key, machine_id, issue_description = "{area}: {detail}", error_type, pic,
action_taken, severity, status='Open', created_date, detail_json{area,metric,scope,entity_id,kpi_value,kpi_status}`.

---

## 4. Persistensi backend (`ews.action_table`)

Endpoint: `apps/api/routes/ews.js` → `getActions`, `syncActions`, `resolveAction`.

### `syncActions` (`ewsController.js:1044`) — UPSERT
```sql
INSERT INTO ews.action_table (...) VALUES (...)
ON CONFLICT (issue_key) DO UPDATE SET issue_description, action_taken, pic, severity, ... 
  last_updated = CASE WHEN action_status='Closed' THEN last_updated ELSE now() END
RETURNING *, (xmax = 0) AS was_inserted
```
- **Upsert by `issue_key`** → tak ada duplikat.
- Issue yang **status `Closed`** tidak di-bump `last_updated` (tetap tertutup walau di-sync ulang).
  - ✏️ **Perhatian:** issue Closed **tidak otomatis dibuka lagi** walau masalahnya muncul lagi
    di hari yang sama (key sama). Mau **re-open** kalau masih bermasalah? Aturan: __________
- Issue **baru** (`was_inserted` via `xmax=0`) → **enqueue TTS** (`ewsTtsNotifier.enqueueIssueTts`).
  - ✏️ Kapan TTS berbunyi (hanya Critical? semua?): _______________________________

### Kolom `ews.action_table` (inti)
`action_id (PK), issue_key (unik), kpi_type, scope_type, scope_key, machine_id,
issue_description, status_reason, error_type, action_taken, pic, severity,
action_status (Open/Closed), action_date, solved_date, escalation_level, due_at,
last_updated, updated_by, detail_json`.

### `ews.action_history` — jejak audit
Baris per perubahan status: `action_id, old_status, new_status, changed_by, notes`.

---

## 5. Eskalasi & Resolve

### ✏️ LOGIC E — Eskalasi (dihitung saat BACA di `getActions:234`)
```sql
CASE
  WHEN action_status = 'Closed' THEN 'Closed'
  WHEN severity='Critical' AND action_date < now() - interval '3 hours' THEN 'Plant Manager'
  WHEN severity='Critical' AND action_date < now() - interval '1 hour'  THEN 'Supervisor/Foreman'
  ELSE COALESCE(escalation_level, 'PIC Monitor')
END
```
> Ada versi kembar di FE `escalationLevel()` (`EwsDetailPage.jsx:528`) — **aturan harus sama**.
- Non-Critical selalu "PIC Monitor" (tak pernah eskalasi). ✏️ Mau Watch juga eskalasi? __________
- Ambang waktu (1 jam → Supervisor, 3 jam → Plant Manager). ✏️ Ambang baru: __________
- ✏️ `due_at` ada di tabel tapi belum diisi otomatis. Mau SLA per severity → isi `due_at`? __________

### Resolve (`resolveAction:1144`)
`PUT /ews/actions/:id/resolve` → `action_status='Closed'`, `solved_date=now()`,
`escalation_level='Closed'`, tulis `action_history`.
- ✏️ Butuh status lain (mis. `In Progress`, `Acknowledged`)? Alur status baru: __________
- ✏️ Butuh field catatan/PIC saat resolve? __________

---

## 6. Kelemahan sekarang (kandidat konsep ulang) — ✏️ pilih yang mau diperbaiki

- [ ] **Generate di FE, saat dibuka saja.** EWS tak mencatat issue kalau tak ada yang buka
  halaman. → Pindahkan generasi issue ke **backend job** (mis. di `ewsSnapshotJob`) agar
  issue tercatat otomatis tiap snapshot, independen dari UI? **(rekomendasiku)**
- [ ] **Threshold tersebar & hardcode di FE.** → Pindah ke tabel config (`ews.kpi_threshold`
  atau tabel baru `ews.issue_rule`) agar bisa diubah tanpa deploy?
- [ ] **Issue Closed tak re-open** walau masalah kambuh di hari sama (key sama).
- [ ] **Grain per (KPI, hari, entitas)** — hilang info berapa kali/berapa lama kejadian.
- [ ] **Dua sumber kebenaran eskalasi** (FE `escalationLevel` + SQL di `getActions`) — rawan drift.
- [ ] **`due_at`/SLA belum dipakai.**
- [ ] Lainnya: _______________________________________________________________

---

## 7. Desain BARU yang kamu inginkan — ✏️ TULIS DI SINI

> Isi bebas. Setelah ini kufinalkan jadi rencana implementasi + kukerjakan.

**7.1 Di mana issue di-generate?** (FE saat dibuka / backend job otomatis / keduanya)
```
...
```

**7.2 Aturan "jadi issue" per KPI** (ganti tabel LOGIC A)
```
...
```

**7.3 Grain & dedup issue** (per hari / per shift / per kejadian)
```
...
```

**7.4 Alur status & eskalasi** (status yang ada, ambang waktu, PIC, SLA/due_at)
```
...
```

**7.5 TTS / notifikasi** (kapan bunyi, untuk siapa)
```
...
```

**7.6 Lain-lain**
```
...
```

---

## 8. Referensi file
- FE logika issue/action: `apps/web/src/pages/EwsDetailPage.jsx`
  (`buildActionRows:482`, `buildIssuePayloads:497`, `escalationLevel:528`, `buildIssueRows:539`, `loadIssueLog:1606`)
- BE endpoint: `apps/api/routes/ews.js:11-13`
- BE handler: `apps/api/controllers/ewsController.js` (`getActions:~215`, `syncActions:1044`, `resolveAction:1144`)
- TTS: `apps/api/services/ewsTtsNotifier.js`
- Tabel: `ews.action_table`, `ews.action_history` (+ `ews.tts_notification`)
