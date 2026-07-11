---
type: concept
tags: [data-model, salvaging]
updated: 2026-07-11
---

# Tulang Punggung Data: order_no + ssbr_ident

Tidak ada satu primary key yang membentang di seluruh alur bisnis. Dua pengikat longgar:

- **`order_no` (+ `operation_no`)** — spine de-facto untuk `sow`, `timesheet_transaction`,
  `buffer_transaction`, kanban MV. Selalu dibandingkan setelah normalisasi
  `LTRIM(order_no,'0')`. Index fungsional `ltrim(...)` adalah yang terpanas di DB.
- **`ssbr_ident`** (`receiving_orders`, UNIQUE) — tag **1 komponen fisik** yang datang.
  `sow.ssbr_id` / `buffer.ssbr_id` / `timesheet.ssbr_id` menunjuk ke sini.

**Struktur dua tingkat (realitas bisnis salvaging SSB):**
1 komponen datang (ssbr_ident) → dibongkar jadi beberapa pecahan → **tiap pecahan punya
`production_order` (= order_no) sendiri** untuk perbaikan. `receiving_components`
part_level 1 = induk, part_level 2 = pecahan.

**Jebakan yang harus diingat:**
- Receiving ↔ sow adalah **string-transform join**, bukan FK:
  `REPLACE(production_order,'-','000')` lalu strip nol. Rapuh — target hardening.
- `order_no` SAP baru lahir SETELAH SOW/quote — jadi anchor lifecycle awal (Received/QC/
  Quote) harus komponen, bukan order. Ini dasar desain lifecycle 2-tingkat di
  [[salvaging/SALVAGE_FLOW_DESIGN]].
- Tabel `mst_job` yang disebut dokumentasi lama TIDAK ada di produksi.

**Terhubung:** [[concepts/payroll-data-path]] · [[salvaging/SALVAGE_FLOW_DESIGN]]

**Asal-usul:** eksplorasi model data sesi salvaging (2026-07-11, pra-design) ·
[[operations/database/receiving_planning|receiving_planning]]
