---
status: review
tags: [design, salvaging]
created: 2026-07-11
---

# Salvage Flow — Design Document

> Status: **DRAFT untuk review** · Dibuat 2026-07-11
> Scope: menyambungkan alur bisnis salvaging end-to-end di MPS2 (internal SSB, single-tenant).
> Tidak membuat aplikasi baru — extend MPS2 yang sudah ada.

---

## 1. Tujuan & Ruang Lingkup

Menyatukan modul-modul yang **sudah ada tapi terpisah** menjadi satu alur berurutan yang bisa dijawab dengan satu pertanyaan: *"Komponen ini sekarang di tahap mana?"*

Alur bisnis:

```
Kedatangan → QC Inspection → Scope of Work → Quote ke customer
   → Approval → Pengerjaan lapangan (Timesheet) → Component Tracking (Kanban)
   → Scheduling → Shipping
```

### Yang sudah ada (reuse)
| Tahap | Modul MPS2 |
|---|---|
| Kedatangan | `receiving_orders` / `receiving_components` + `ReceivingShipmentPage` |
| Scope of Work | `sow`, `sow_standard`, SOW Management (PE) |
| Timesheet | `timesheet_transaction` |
| Component tracking | `buffer_transaction`, kanban MV `mv_kanban_order_board` |
| Scheduling | `sow_schedule*`, `SowSchedulingPage` |
| Shipping | `shipping_records` |

### Yang baru (greenfield)
1. **Salvage lifecycle** — status yang membentang di seluruh alur (tulang punggung).
2. **QC Inspection** — inspeksi komponen saat datang.
3. **Quotation** — penawaran harga ke customer.

---

## 2. Temuan Kunci dari Model Data Existing

- **Tidak ada satu primary key** yang membentang di seluruh alur. Pengikat de-facto:
  - `order_no` (+ `operation_no`) — dinormalisasi `LTRIM(order_no,'0')` di sow/timesheet/buffer/kanban.
  - `ssbr_ident` (UNIQUE di `receiving_orders`) — pengikat balik ke kedatangan fisik.
- Hubungan receiving ↔ order **bukan FK**, tapi string-transform join: `REPLACE(production_order,'-','000')` lalu strip nol. Rapuh — harus diperbaiki jadi relasi eksplisit.
- **Struktur dua tingkat (sesuai realitas SSB):**
  - `ssbr_ident` men-tag **1 komponen fisik** yang datang.
  - Komponen itu dibongkar jadi **beberapa pecahan** (`receiving_components` part_level 2), **masing-masing punya `production_order` = `order_no`** sendiri untuk perbaikan.

---

## 3. Keputusan Arsitektur: Lifecycle Dua Tingkat

Anchor **tidak tunggal**. Ada dua tier karena bisnisnya dua tingkat:

### Tier A — Component Journey
- **Anchor:** `receiving_components.id` dengan `part_level = 1` (komponen induk). Satu ssbr = satu journey.
- **Yang di-track:** perjalanan komponen utuh yang di-quote & di-ship ke customer.
- **Stages:**

```
RECEIVED → QC_INSPECT → BREAKDOWN → SOW_DRAFT → QUOTED
   → QUOTE_APPROVED → IN_PROGRESS → REASSEMBLED → READY_SHIP → SHIPPED
   (cabang: QUOTE_REJECTED, RETURNED_AS_IS, SCRAPPED)
```

### Tier B — Repair Task
- **Anchor:** `receiving_components.id` dengan `part_level = 2` (pecahan), yang punya `production_order`.
- **Yang di-track:** tugas perbaikan per pecahan — tempat SOW, timesheet, kanban, buffer bekerja.
- **Stages:**

```
SOW_PLANNED → SCHEDULED → IN_PROGRESS → REPAIR_DONE → QC_FINAL → PASSED
   (cabang: REWORK, SCRAPPED)
```

### Rollup Tier B → Tier A
Stage induk sebagian **diturunkan** dari anak-anaknya (tidak diketik manual):
- Induk `IN_PROGRESS` bila **ada** pecahan yang `IN_PROGRESS`.
- Induk boleh `READY_SHIP` **hanya bila SEMUA** pecahan `PASSED`.
- Stage yang murni Tier A (QC_INSPECT, QUOTED, QUOTE_APPROVED, SHIPPED) di-set eksplisit oleh aksi user.

> **Kenapa bukan anchor tunggal:** satu kiriman sering berisi pecahan dengan tahap berbeda (2 pecahan sudah `PASSED`, 1 masih `IN_PROGRESS`). Anchor tunggal (per ssbr atau per order) tidak bisa merepresentasikan ini tanpa kehilangan informasi.

---

## 4. Skema Tabel Baru

Semua di schema `public` (konsisten dgn tabel lain), migration di `database/migrations/api/`.

### 4.1 `salvage_stage` — tulang punggung lifecycle

```sql
CREATE TABLE salvage_stage (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    receiving_component_id INTEGER NOT NULL UNIQUE
                          REFERENCES receiving_components(id) ON DELETE CASCADE,
    tier                  SMALLINT NOT NULL CHECK (tier IN (1, 2)),  -- 1=component journey, 2=repair task
    stage                 VARCHAR(30) NOT NULL,   -- lihat enum §3
    stage_entered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_derived            BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE bila stage hasil rollup, bukan set manual
    blocked               BOOLEAN NOT NULL DEFAULT FALSE, -- flag "tertahan" (mis. tunggu part)
    blocked_reason        TEXT,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_salvage_stage_stage ON salvage_stage(stage);
CREATE INDEX idx_salvage_stage_tier  ON salvage_stage(tier);
```

### 4.2 `salvage_stage_history` — audit perpindahan tahap

```sql
CREATE TABLE salvage_stage_history (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    receiving_component_id INTEGER NOT NULL REFERENCES receiving_components(id) ON DELETE CASCADE,
    from_stage            VARCHAR(30),
    to_stage              VARCHAR(30) NOT NULL,
    changed_by            VARCHAR(100),        -- x-user-id
    note                  TEXT,
    changed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_salvage_hist_comp ON salvage_stage_history(receiving_component_id);
```

### 4.3 QC Inspection

```sql
CREATE TABLE qc_inspection (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    receiving_component_id INTEGER NOT NULL REFERENCES receiving_components(id) ON DELETE CASCADE,
    inspection_type       VARCHAR(20) NOT NULL DEFAULT 'incoming', -- 'incoming' | 'final'
    inspector             VARCHAR(100),
    started_at            TIMESTAMPTZ DEFAULT NOW(),
    completed_at          TIMESTAMPTZ,
    overall_result        VARCHAR(20),  -- 'repairable' | 'scrap' | 'return_as_is' | 'pass' | 'fail'
    summary_note          TEXT,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE qc_finding (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inspection_id         BIGINT NOT NULL REFERENCES qc_inspection(id) ON DELETE CASCADE,
    checklist_item        VARCHAR(200),        -- item template checklist
    condition             VARCHAR(30),         -- 'good' | 'worn' | 'damaged' | 'missing' | 'broken'
    severity              SMALLINT,            -- 1..5
    finding_note          TEXT,
    suggested_operation   VARCHAR(200),        -- calon operasi SOW (jadi input §6)
    photo_path            TEXT,                -- upload multer → apps/api/uploads/qc/
    created_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_qc_finding_inspection ON qc_finding(inspection_id);
```

### 4.4 Quotation

```sql
CREATE TABLE quotation (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    quote_number          VARCHAR(50) NOT NULL UNIQUE,   -- di-generate: QT-YYYYMM-####
    receiving_order_id    INTEGER NOT NULL REFERENCES receiving_orders(id) ON DELETE RESTRICT,
    customer_id           INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    status                VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft|sent|approved|rejected|revised
    currency              VARCHAR(3) NOT NULL DEFAULT 'IDR',
    labour_subtotal       NUMERIC(15,2) DEFAULT 0,
    parts_subtotal        NUMERIC(15,2) DEFAULT 0,
    margin_pct            NUMERIC(5,2) DEFAULT 0,
    tax_pct               NUMERIC(5,2) DEFAULT 0,
    grand_total           NUMERIC(15,2) DEFAULT 0,
    valid_until           DATE,
    approved_by           VARCHAR(100),
    approved_at           TIMESTAMPTZ,
    revision_no           SMALLINT NOT NULL DEFAULT 0,
    note                  TEXT,
    created_by            VARCHAR(100),
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE quotation_line (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    quotation_id          BIGINT NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
    line_type             VARCHAR(10) NOT NULL CHECK (line_type IN ('labour','part','misc')),
    receiving_component_id INTEGER REFERENCES receiving_components(id) ON DELETE SET NULL,
    source_op_id          BIGINT,              -- ref sow.idsow bila labour dari SOW operation
    description           VARCHAR(300) NOT NULL,
    qty                   NUMERIC(12,2) DEFAULT 1,
    unit                  VARCHAR(20),         -- 'hour' | 'pcs'
    unit_price            NUMERIC(15,2) DEFAULT 0,
    line_total            NUMERIC(15,2) DEFAULT 0,
    created_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_quote_line_quote ON quotation_line(quotation_id);
```

### 4.5 (opsional) FK eksplisit receiving → sow
Ganti string-transform join dengan kolom eksplisit di `receiving_components`:
```sql
-- production_order sudah ada; tambahkan flag agar link ke sow.order_no jelas.
-- TIDAK menambah FK keras (order_no bisa belum ada saat komponen baru datang).
-- Sebagai gantinya: view penghubung (lihat §5).
```

---

## 5. View Penghubung

```sql
CREATE OR REPLACE VIEW v_salvage_flow AS
SELECT
  ro.ssbr_ident,
  ro.customer_id,
  rc.id                AS receiving_component_id,
  rc.part_level,
  rc.part_description,
  rc.production_order,
  ss.tier,
  ss.stage,
  ss.stage_entered_at,
  ss.blocked,
  -- link ke sow via normalisasi order (dipertahankan sementara, lalu diganti kolom eksplisit)
  s.idsow,
  s.status             AS sow_status,
  s.progress           AS sow_progress
FROM receiving_components rc
JOIN receiving_orders ro       ON ro.id = rc.receiving_order_id
LEFT JOIN salvage_stage ss     ON ss.receiving_component_id = rc.id
LEFT JOIN sow s
       ON LTRIM(REPLACE(rc.production_order,'-','000'),'0') = LTRIM(s.order_no,'0');
```

---

## 6. Bagaimana Modul Existing Melapor ke Lifecycle

Prinsip: **modul yang sudah ada tidak dirombak**, hanya menembakkan update stage.

| Aksi existing | Efek ke lifecycle |
|---|---|
| Buat `receiving_order` + components | Insert `salvage_stage` = `RECEIVED` (Tier A induk), pecahan menyusul saat breakdown |
| Selesai QC inspection (`qc_inspection.completed_at`) | Tier A → `QC_INSPECT` selesai → `SOW_DRAFT` (bila repairable) |
| SOW operation dibuat untuk `order_no` | Tier B pecahan → `SOW_PLANNED` |
| `sow_schedule` assign | Tier B → `SCHEDULED` |
| Timesheet check-in (`timesheet_transaction`) pertama utk order | Tier B → `IN_PROGRESS`; rollup Tier A → `IN_PROGRESS` |
| `sow.status='FINISH'` / buffer `out` | Tier B → `REPAIR_DONE` |
| QC final pass | Tier B → `PASSED` → cek rollup induk |
| Semua pecahan `PASSED` | Tier A → `READY_SHIP` |
| `shipping_records` dibuat | Tier A → `SHIPPED` |

Mekanisme: **hook di controller** (paling eksplisit & mudah di-debug) — bukan trigger DB. Setiap controller yang relevan memanggil helper `salvageStage.transition(componentId, toStage, {by, note})` yang juga menulis `salvage_stage_history`. Rollup dihitung di helper yang sama.

> Alternatif trigger DB ditolak: lebih sulit di-trace, dan logika rollup (butuh agregasi anak) lebih bersih di layer aplikasi.

---

## 7. API Baru

Base path baru di `server.js`:

| Method | Path | Fungsi |
|---|---|---|
| GET | `/salvage-flow/board` | Data Flow Board (grouped by stage / by ssbr) |
| GET | `/salvage-flow/component/:id` | Detail lifecycle 1 komponen + history + anak |
| POST | `/salvage-flow/component/:id/transition` | Pindah stage manual (validasi transisi) |
| GET/POST | `/qc/inspection` | List / buat inspeksi |
| GET | `/qc/inspection/:id` | Detail + findings |
| POST | `/qc/inspection/:id/finding` | Tambah finding (+ upload foto) |
| POST | `/qc/inspection/:id/complete` | Selesaikan inspeksi → set overall_result → transisi stage |
| GET/POST | `/quotation` | List / buat quote |
| POST | `/quotation/from-sow/:orderNo` | Generate draft quote dari SOW (labour = std_hours × rate) |
| POST | `/quotation/:id/approve` | Approve → transisi Tier A `QUOTE_APPROVED` |
| GET | `/quotation/:id/pdf` | Cetak PDF |

Konvensi: ikut pola router existing (`apps/api/routes/*.js` + `apps/api/controllers/*Controller.js`), `rbacGuard` untuk semua write, identitas dari header `x-user-id`.

---

## 8. UI — Salvage Flow Board

Halaman baru `/salvage-flow` (module PPC atau module baru "SALVAGE"). Mengikuti Corporate Color System.

```
┌─ Salvage Flow ───────────────────────────── [ Filter: Customer ▾ ] [ Search ssbr ] ┐
│                                                                                      │
│  RECEIVED   QC        SOW/QUOTE   APPROVED   IN PROGRESS   READY SHIP   SHIPPED      │
│  ┌──────┐   ┌──────┐  ┌───────┐   ┌──────┐   ┌─────────┐   ┌────────┐   ┌───────┐    │
│  │BHSG- │   │BWRP- │  │ ...   │   │ ...  │   │ ...     │   │ ...    │   │ ...   │    │
│  │4033  │   │5692  │  │       │   │      │   │         │   │        │   │       │    │
│  │3 part│   │2 part│  │       │   │      │   │ ▓▓▓░ 2/3│   │        │   │       │    │
│  └──────┘   └──────┘  └───────┘   └──────┘   └─────────┘   └────────┘   └───────┘    │
│                                                                                      │
│  Klik kartu → drawer: detail komponen, daftar pecahan + stage Tier B masing-masing,  │
│  history, tombol aksi (Start QC / Generate Quote / Mark Shipped).                    │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- Kartu = 1 komponen induk (ssbr). Badge "2/3" = 2 dari 3 pecahan sudah PASSED.
- Warna aging band (merah/kuning/hijau) berdasarkan `stage_entered_at` — reuse pola kanban.
- Kolom = stage Tier A. Drawer menampilkan Tier B per pecahan.

---

## 9. Rencana Implementasi Bertahap

| Fase | Deliverable | Estimasi relatif |
|---|---|---|
| **1** | Migration `salvage_stage` + `salvage_stage_history` + view + helper `salvageStage.transition` + API `/salvage-flow` + Flow Board (read-only) | Fondasi |
| **2** | QC Inspection: tabel, API, halaman inspeksi, upload foto, complete → transisi | Isi celah |
| **3** | Quotation: tabel, generate-from-SOW, approval, PDF | Isi celah |
| **4** | Hook di controller existing (receiving/sow/timesheet/buffer/shipping) → auto-update stage + rollup | Glue |
| **5** | Perbaiki string-transform join jadi relasi eksplisit (kolom `sow_order_no` di receiving_components, backfill) | Hardening |

Fase 1 wajib duluan — tanpa backbone, QC & Quote hanya jadi pulau baru.

---

## 10. Pertanyaan Terbuka (perlu jawaban sebelum Fase 1)

1. **Rate labour untuk quote** — dari mana? Rate flat per jam, per workcenter, atau per operasi? (`sow_standard.std_hours` sudah ada, tapi tarif Rupiah-nya belum ada di DB.)
2. **Harga parts** — apakah ada master harga part, atau input manual saat quote?
3. **QC checklist** — apakah ada template checklist standar per kategori komponen (Suspension/Engine/dll), atau bebas?
4. **Approval quote** — internal (manajer SSB) approve, atau menunggu balasan customer? Statusnya beda.
5. **Breakdown** — apakah pemecahan komponen jadi pecahan (`part_level 2`) sudah dilakukan di `ReceivingShipmentPage` sekarang, atau harus jadi langkah baru setelah QC?
6. **Module & RBAC** — halaman ini masuk module apa? Perlu guard RBAC baru (`salvage_flow`) atau ikut yang ada?

---

## 11. Yang Sengaja TIDAK Dilakukan

- Tidak membuat aplikasi baru / SaaS multi-tenant (keputusan: internal only).
- Tidak merombak modul existing — hanya menambah hook.
- Tidak mengganti kanban/timesheet/SOW yang sudah jalan.
- Tidak memakai trigger DB untuk rollup (dipilih helper aplikasi).
