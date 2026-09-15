---
tags: [concept, tooling, domain/ops]
updated: 2026-07-27
---

# Batas akurasi graph codebase-memory-mcp (cbm) di repo ini

> Catatan menetap. Kalau kamu memakai cbm (`search_graph`, `trace_path`, `query_graph`,
> `get_code_snippet`) untuk menavigasi kode MPS2 — baca ini dulu. Graph berguna untuk
> **penemuan** (discovery), TIDAK bisa dipercaya sendirian untuk **impact analysis**.

## Aturan satu kalimat

**Untuk pertanyaan "siapa memanggil X" / "apa dampak mengubah X" di backend, graph WAJIB
divalidasi silang ke Grep/sumber — dua mode gagal terverifikasi di bawah.**

Nama project cbm untuk repo ini: **`D-website-MPS2`**. Index penuh 2026-07-27:
7187 node / 15673 edge, status `indexed` (bukan degraded).

## Cacat 1 — handler `exports.X = <fn>` tidak jadi node (JS)

Extractor **tidak** membuat node untuk handler yang dideklarasikan sebagai **assignment
member-expression ke fungsi**:

```js
exports.create = async (req, res) => { ... }   // ❌ TIDAK jadi node
exports.remove = function (req, res) { ... }    // ❌ TIDAK jadi node
```

Ia **membuat** node untuk pola lain:

```js
function helper() { ... }                       // ✅ node
const helper = async () => { ... }              // ✅ node
exports.group = { create: async () => {} }      // ✅ 'create' jadi node (method object-literal)
```

Contoh terverifikasi: `apps/api/controllers/timesheet_transactionController.js` punya 23
handler `exports.*` (`create`, `checkout`, `postToSap`, `remove`, `partialUpdate`, dll) —
**nol** muncul sebagai node. Dump mentah file itu (22 node) hanya berisi 13 helper internal
+ 7 Variable module-level + Module + File. Sebaliknya `processControlController.js` memakai
object-literal (`exports.categories = { create: ... }`) → `create`-nya tertangkap.

**Skala di MPS2: 214 handler pola `exports.X = <fn>` di 15 file controller** tidak terlihat
sebagai node — mis. `sowController` (74), `sowScheduleController` (38), `timesheet` (23),
`toolsController` (16). Justru handler inilah yang memuat operasi tulis DB & logika bisnis.

Konsekuensi:
- Operasi INSERT/UPDATE ke tabel (mis. `timesheet_transaction`) "terlipat" ke node **Module**,
  tak bisa ditelusuri per-fungsi.
- Tidak ada edge `HANDLES`/`CALLS` masuk/keluar untuk handler-handler itu. (Edge `HANDLES`=152
  yang ada hanya menautkan handler bergaya object-literal/`const` ke Route.)
- `search_graph`/`trace_path` per-nama handler route = nihil.

## Cacat 2 — CALLS lintas-file Python bisa hilang (lebih serius)

`mark_local_timesheet_rejected` (`jobs/sap_staging/sap_staging_common.py`) **ADA** sebagai
node. Pemanggilnya `post_one` (`jobs/sap_staging/post_sap_staging.py`, mulai baris 427) juga
**ADA** sebagai node, dan memanggil fungsi itu **2×** (baris 458 & 489; import di baris 21).

`trace_path(mark_local_timesheet_rejected, direction=inbound, mode=calls)` → `callers: []`.
Query semua edge masuk: hanya `USAGE` (dari Module, yaitu import) + `DEFINES` (dari File).
**Tidak ada edge `CALLS` dari `post_one`** — padahal kedua node ada dan import terekam.

Ini lebih serius karena tool mengklaim *"type-aware LSP call/usage resolution (per-file +
cross-file)"*. Di sini resolusi cross-file gagal membentuk CALLS meski binding import
tertangkap sebagai USAGE.

## Cara pakai cbm dengan aman di repo ini

- ✅ Discovery: cari Route, struktur, simbol, arsitektur — andal.
- ⚠️ Impact analysis / caller tracing: **selalu** cross-check `Grep` ke sumber sebelum
  menyimpulkan. Jangan pernah klaim negatif ("tak ada yang memanggil X", "dead code") dari
  graph saja — selaras aturan kerja user.
- Bug hulu sudah didraft (belum di-submit): repro minimal di luar repo, tidak memakai kode MPS2.

## Asal-usul

Sesi kalibrasi index cbm 2026-07-27 — lihat [[log/2026-07-27-cbm-index-kalibrasi]] (log belum
ditulis). Dokumen ini seharusnya tercapai dari [[00-INDEX]]; format ikut [[KONVENSI]].
