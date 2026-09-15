-- 2026-09-05 — Mapping operasi SAP -> task MS Project pindah ke tabel milik PPC.
-- Spec: docs/planning/mapping-operasi-sap-tahan-sync.md (revisi 2026-09-05, status active).
--
-- Backfill mencakup DUA populasi leaf (op numeric cocok sow):
--   A. sow_id terisi (aksi /map)          -> 428 aktif + 40 mati
--   B. by-operation_no (impor .mpp)       -> 1.236 aktif + 21 mati
-- ≈1.689 kunci unik (order, op) per 2026-09-05. Task mati TETAP dimasukkan: itulah yang
-- harus muncul sebagai TASK_LOST, bukan dibuang.
--
-- Aturan pilih saat duplikat (order, op): task AKTIF menang -> ber-sow_id -> created_at
-- terbaru (DISTINCT ON). Summary tidak pernah ikut. operation_no non-numeric dilewati.
--
-- Catatan: tabel ms_project_bay_schedule & index uq_ms_project_task_order_op TIDAK disentuh
-- (index parsial lama dibiarkan selama masa transisi, dihapus migrasi terpisah).

create table if not exists sow_operation_task_map (
  order_key      text not null,
  operation_key  integer not null,
  project_id     uuid not null,
  task_id        uuid not null,
  sow_id         integer,
  mapped_by      text,
  mapped_at      timestamptz not null default now(),
  primary key (order_key, operation_key)
);

create index if not exists idx_sow_operation_task_map_task
  on sow_operation_task_map (task_id);

insert into sow_operation_task_map (order_key, operation_key, project_id, task_id, sow_id, mapped_at)
select distinct on (ltrim(t.order_no, '0'), nullif(btrim(t.operation_no), '')::int)
       ltrim(t.order_no, '0'),
       nullif(btrim(t.operation_no), '')::int,
       t.project_id,
       t.task_id,
       t.sow_id,
       t.created_at
  from ms_project_task t
 where not coalesce(t.is_summary, false)
   and t.order_no is not null
   and t.operation_no is not null
   and btrim(t.operation_no) ~ '^[0-9]+$'
   and exists (select 1 from sow s
                where ltrim(s.order_no, '0') = ltrim(t.order_no, '0')
                  and s.operation_no = nullif(btrim(t.operation_no), '')::int)
 order by ltrim(t.order_no, '0'),
          nullif(btrim(t.operation_no), '')::int,
          t.is_active desc,
          (t.sow_id is not null) desc,
          t.created_at desc;
