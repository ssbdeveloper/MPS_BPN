---
type: concept
tags: [ews, dashboard, oee, ole, keputusan, domain/ews]
updated: 2026-07-27
---

# KPI Proxy Waktu vs Dashboard OEE ISO Penuh

> Keputusan sadar: MPS2 memakai **proxy waktu** untuk OEE/OLE (lewat EWS), BUKAN
> model ISO 22400-2 A×P×Q penuh. Note ini merekam keputusan itu + apa yang ikut
> terparkir, supaya desain penuhnya bisa diambil lagi dari git bila dibutuhkan.

## Keputusan

Model **OEE/OLE ISO 22400-2 (Availability × Performance × Quality) penuh TIDAK
diadopsi.** EWS memilih **proxy waktu** secara sadar — lihat [[EWS_PLAN]] §2:

- `oee` = run(M1,M2 ∪ productive) / denominator → *"proxy waktu, bukan OEE klasik"*.
- `ole` = working / available per operator (praktis = Labor Availability saja).

Alasannya: proxy cukup untuk sinyal Early-Warning harian dari data yang sudah ada
(`mch_transaction`, `timesheet`), tanpa membangun star-schema fact/dim + rule
engine penuh.

## Yang ikut terparkir bersama keputusan ini

Dashboard suite ISO penuh membawa 4 KPI lain yang **tak punya rumah** dan ikut
diparkir sadar bersama keputusan proxy:

- **OTE** — Overall Throughput Effectiveness (bottleneck-driven).
- **Overtime Readiness** — dashboard keputusan lembur 4-gate.
- **Schedule Performance** — adherence/slippage, baseline MS Project vs actual.
- **Order/Job Performance** — cost variance, EAC per order.

## OTIF — DIPISAHKAN (backlog terbuka, bukan bagian keputusan proxy)

OTIF **bukan varian OEE** — ini metrik **pengiriman** (On-Time In-Full), tidak
tergantung keputusan proxy di atas. **Computable hari ini** dari `receiving_orders`
→ `shipping_records`, **kecuali** kolom `due_date` (janji customer) belum ada.
→ Perlakukan sebagai **backlog terbuka** (bukan "terparkir"): kalau mau diaktifkan,
tambah `due_date` + hitung On-Time, catat barisnya di [[PLANNING]].

## Ambil desain penuhnya dari git (bila suatu saat dibutuhkan)

Dua file spec diparkir di `_isolasi/` (kandidat hapus ≥ 2026-09-01 — lihat
[[log/2026-07-11-md-cleanup]]). Keduanya ter-track git, jadi aman diambil lagi:

```bash
# commit b2208c8 (2026-07-11, commit isolasi)
git show b2208c8:docs/_isolasi/MPS_DASHBOARD_SPEC.md        > SPEC.md
git show b2208c8:"docs/_isolasi/MPS_Dashboard_Task_Spec.md" > TASK_SPEC.md
```

- `MPS_DASHBOARD_SPEC.md` — versi MPS2-grounded: data model + rule engine ISO +
  **§13 audit skema nyata + Gap Register G1–G12** (keeper bila kelak diselamatkan).
- `MPS_Dashboard_Task_Spec.md` — versi abstrak: Six Big Losses, KPI hierarchy,
  checklist validasi.

## Catatan: G1 sudah terpecahkan

§13 spec (audit 2026-04-29) menandai **G1 — `mch_productiondata` kosong (0 baris)**
sebagai blocker terbesar semua KPI mesin. Per [[EWS_PLAN]] tabel itu **kini live**
(memberi makan `oee` / `accuracy_machine` / `adoption_machine`). Blocker terbesar
dashboard sudah hilang; karena itu §13 audit kini sebagian usang.

## Terkait

[[EWS_PLAN]] · [[log/2026-07-11-md-cleanup]] · [[PLANNING]]
