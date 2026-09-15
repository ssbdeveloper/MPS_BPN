-- 2026-09-07 — Mapping lanjutan: jadwal mengikuti task yang ditempeli operation_no + order_no
-- (keputusan owner 2026-09-07, jawaban 1b/2a/3b — revisi docs/planning/mapping-operasi-sap-tahan-sync.md).
--
-- Aturan (backfill aman, mapping sehat TIDAK diganggu):
--   carrier terbaik per (order, op) di antara task AKTIF pembawa op+order:
--     (1) task nyata file (local_task_uid NOT NULL) didahulukan — leaf, baru summary
--     (2) orphan DB (tanpa uid) hanya dipakai kalau tidak ada carrier nyata
--   A. mapping -> task aktif ber-uid          : biarkan (READY sehat)
--   B. mapping -> task AKTIF orphan (35)      : pindah ke carrier nyata (uid) + orphan di-nonaktifkan
--      (kasus op 70 -> 'FAB FRAME ASSY 2.1.2.1.9' anak virtual tanpa tanggal)
--   C. mapping -> task MATI / TASK_LOST (24)  : pindah ke carrier aktif nyata kalau ada
--   D. tanpa mapping tapi ada carrier nyata   : INSERT (98)
--   Mapping TIDAK pernah dipindah ke orphan (READY tanpa tanggal = masalah yang sama).
-- Penonaktifan orphan hanya bila: tidak dirujuk mapping lain & tidak punya reservasi bay aktif.

create temp table _map_pick on commit drop as
with cand as (
  select ltrim(t.order_no, '0') as order_key,
         nullif(btrim(t.operation_no), '')::int as operation_key,
         t.task_id, t.is_summary, t.plan_start, t.local_task_uid, t.created_at
    from ms_project_task t
   where t.is_active
     and t.order_no is not null
     and t.operation_no is not null
     and btrim(t.operation_no) ~ '^[0-9]+$'
     and exists (select 1 from sow s
                  where ltrim(s.order_no, '0') = ltrim(t.order_no, '0')
                    and s.operation_no = nullif(btrim(t.operation_no), '')::int)
)
select distinct on (order_key, operation_key)
       order_key, operation_key, task_id,
       (local_task_uid is not null) as has_uid,
       coalesce(is_summary, false) as is_summary
  from cand
 order by order_key, operation_key,
          (local_task_uid is not null) desc,  -- task nyata file lebih dulu
          is_summary asc,                     -- leaf dulu, summary cadangan
          (plan_start is not null) desc,
          created_at asc;

-- Audit: mapping yang akan dipindah (task lama mati ATAU orphan -> carrier nyata berbeda)
create temp table _map_moved on commit drop as
select m.order_key, m.operation_key, m.task_id as old_task_id
  from sow_operation_task_map m
  join _map_pick p on p.order_key = m.order_key and p.operation_key = m.operation_key
  left join ms_project_task ot on ot.task_id = m.task_id
 where m.task_id is distinct from p.task_id
   and p.has_uid
   and (ot.task_id is null or not ot.is_active or ot.local_task_uid is null);

-- B + C: pindahkan mapping ke carrier nyata terbaik
update sow_operation_task_map m
   set task_id = p.task_id,
       project_id = t.project_id,
       sow_id = coalesce(m.sow_id, t.sow_id),
       mapped_by = 'backfill-2026-09-07',
       mapped_at = now()
  from _map_moved mv
  join _map_pick p on p.order_key = mv.order_key and p.operation_key = mv.operation_key
  join ms_project_task t on t.task_id = p.task_id
 where m.order_key = mv.order_key and m.operation_key = mv.operation_key;

-- D: insert mapping baru untuk op yang punya carrier nyata aktif tapi belum di-map
insert into sow_operation_task_map (order_key, operation_key, project_id, task_id, sow_id, mapped_by, mapped_at)
select p.order_key, p.operation_key, t.project_id, p.task_id, t.sow_id, 'backfill-2026-09-07', now()
  from _map_pick p
  join ms_project_task t on t.task_id = p.task_id
 where p.has_uid
   and not exists (select 1 from sow_operation_task_map m
                    where m.order_key = p.order_key and m.operation_key = p.operation_key);

-- Orphan yang kehilangan mapping di-nonaktifkan (hanya bila aman: tidak dirujuk mapping
-- lain & tidak punya reservasi bay aktif). Task orphan = buatan aksi map (asChild), tidak
-- pernah ada di file .mpp, jadi tanpa tanggal selamanya — menonaktifkannya mencegah
-- "READY tanpa tanggal" yang membingungkan.
-- DO block + EXECUTE: tabel ms_project_bay_schedule tidak ada di plant salvaging (BPN);
-- referensi relasi langsung di SQL dievaluasi saat parse, jadi guard harus lewat string.
do $$
declare
  bay_guard text;
begin
  if to_regclass('public.ms_project_bay_schedule') is not null then
    bay_guard := ' and not exists (select 1 from ms_project_bay_schedule b'
              || ' where b.task_id = t.task_id and b.status <> ''CANCELLED'')';
  else
    bay_guard := '';
  end if;
  execute 'update ms_project_task t'
       || '   set is_active = false, updated_at = now()'
       || ' where t.local_task_uid is null'
       || '   and t.is_active'
       || '   and not coalesce(t.is_summary, false)'
       || '   and t.task_id in (select old_task_id from _map_moved)'
       || '   and not exists (select 1 from sow_operation_task_map m2 where m2.task_id = t.task_id)'
       || bay_guard;
end $$;
