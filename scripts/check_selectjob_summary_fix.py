"""Self-check listBayScheduleTasks (layar select-job operator), 4 perbaikan:

1. Task SUMMARY tidak boleh hilang dari layar operator.
2. Actual hours dihitung per OPERASI, bukan total order.
3. Jam standar (planhours) bersumber dari SAP (sow.planhours <- ph3_order),
   bukan planned_work_minutes MS Project.
4. Operasi yang TIDAK ADA di SAP tidak boleh muncul (placeholder op '0' lolos
   dari syarat "operation_no tidak kosong" -- '0' bukan string kosong).

Jalankan: uv run --with 'psycopg[binary]' python scripts/check_selectjob_summary_fix.py
Butuh tunnel CKP 5441 hidup + env DBQ_PASS.
"""
import os
import psycopg

ORDER = "1000130219"

VISIBILITY = """
select t.task_name
from ms_project_bay_schedule s
left join ms_project_task t on t.is_active = true and s.project_id is not null and s.task_id is not null
  and t.project_id = s.project_id and t.task_id = s.task_id
where s.status <> 'CANCELLED' and coalesce(s.booking_type, 'ORDER') = 'ORDER'
  and ltrim(s.order_no, '0') = %s
  and upper(s.area_code) = 'AREA-18'
  and (s.task_id is null or upper(coalesce(t.workcenter, '')) = 'C5100BPP')
  and {predicate}
"""

OLD_PRED = "(s.task_id is not null and t.task_id is not null and coalesce(t.is_summary, false) = false)"
NEW_PRED = ("(s.task_id is not null and t.task_id is not null and t.order_no is not null "
            "and nullif(btrim(t.operation_no), '') is not null)")

HOURS = """
select t.operation_no, act.actual_hours
from ms_project_task t
left join lateral (
  select coalesce(sum(coalesce(tt.duration, 0)), 0) as actual_hours
  from timesheet_transaction tt
  where ltrim(tt.order_no, '0') = ltrim(t.order_no, '0')
    and tt.duration is not null and tt.duration > 0
    {op_clause}
) act on true
where ltrim(coalesce(t.order_no, ''), '0') = %s and t.is_active
"""

OLD_OP = ""
NEW_OP = """and (t.task_id is null
       or tt.operation_no = (case when btrim(coalesce(t.operation_no, '')) ~ '^\\d+$'
                                  then btrim(t.operation_no)::integer end))"""

# Jam standar: MSP (lama) vs SAP (baru), memakai lateral std yang sama dengan query asli.
PLAN = """
select t.operation_no, coalesce(t.is_summary, false) as is_summary,
       round(coalesce(t.planned_work_minutes, 0) / 60.0, 2) as msp_h,
       std.planhours as sap_h
from ms_project_task t
left join lateral (
  select w.planhours from sow w
  where ltrim(w.order_no, '0') = ltrim(t.order_no, '0')
    and w.operation_no = (case when btrim(coalesce(t.operation_no, '')) ~ '^\\d+$'
                               then btrim(t.operation_no)::integer end)
  limit 1
) std on true
where ltrim(coalesce(t.order_no, ''), '0') = %s and t.is_active
"""

dsn = os.environ.get(
    "DBQ_DSN",
    "postgresql://tag:%s@127.0.0.1:5441/ptssb" % os.environ["DBQ_PASS"].replace("@", "%40"),
)
with psycopg.connect(dsn) as conn:
    names = lambda p: {r[0] for r in conn.execute(VISIBILITY.format(predicate=p), (ORDER,))}
    old_names, new_names = names(OLD_PRED), names(NEW_PRED)

    hours = lambda c: {r[0]: float(r[1]) for r in conn.execute(HOURS.format(op_clause=c), (ORDER,))}
    old_hours, new_hours = hours(OLD_OP), hours(NEW_OP)

    plan = {r[0]: {"is_summary": r[1], "msp": float(r[2]), "sap": None if r[3] is None else float(r[3])}
            for r in conn.execute(PLAN, (ORDER,))}

# 1. Visibility
assert "FINISH PAINTING" not in old_names, "filter lama seharusnya membuang task summary"
assert "FINISH PAINTING" in new_names, "filter baru harus memunculkan FINISH PAINTING"
assert old_names < new_names, "filter baru harus superset filter lama"

# 2. Actual hours per operasi
assert len(set(old_hours.values())) == 1, "bug lama: semua operasi harusnya menampilkan angka sama"
assert len(set(new_hours.values())) > 1, "fix: jam harus berbeda per operasi"
total = next(iter(set(old_hours.values())))
assert abs(sum(new_hours.values()) - total) < 0.01, "jumlah jam per operasi harus = total order lama"
assert abs(new_hours["160"] - 7.78) < 0.01, "op 160 FINISH PAINTING harus 7.78 jam"

# 3. Jam standar dari SAP. CATATAN: MSP != SAP bukan cuma di summary — task leaf pun
#    bisa beda (op 150: MSP 7,05 j vs SAP 14 j; se-CKP 486 dari 893 baris leaf terjadwal
#    beda). Yang dijamin di sini: nilai SAP ADA untuk tiap operasi numerik, dan untuk
#    summary MSP selalu menggelembung karena rollup anak — itu kasus terparahnya.
leaf = {op: v for op, v in plan.items() if not v["is_summary"] and v["sap"] is not None}
summ = {op: v for op, v in plan.items() if v["is_summary"] and v["sap"] is not None}
assert leaf and summ, "order contoh harus punya task leaf DAN summary"
for op, v in summ.items():
    assert v["msp"] > v["sap"], f"summary op {op}: MSP {v['msp']} harus > SAP {v['sap']} (rollup anak)"
assert abs(plan["160"]["sap"] - 14.0) < 0.01, "op 160 jam standar SAP harus 14 jam"
assert abs(plan["130"]["sap"] - 4.0) < 0.01, "op 130 jam standar SAP harus 4 jam (MSP salah 82,1)"
assert abs(plan["150"]["sap"] - 14.0) < 0.01, "op 150 leaf: SAP 14 jam (MSP 7,05 — leaf pun bisa beda)"

# 4. Operasi yang tidak ada di SAP harus terbuang. Task sampah nyata di CKP:
#    order 1000120826 "CUTTING STRUCTURAL TANK" operation_no '0' (SAP: op 20).
GARBAGE = """
select count(*)
from ms_project_bay_schedule s
join ms_project_task t on t.is_active = true and t.project_id = s.project_id and t.task_id = s.task_id
where s.status <> 'CANCELLED' and coalesce(s.booking_type, 'ORDER') = 'ORDER'
  and t.order_no is not null and nullif(btrim(coalesce(t.operation_no, '')), '') is not null
  {sap_clause}
"""
SAP_CLAUSE = """and exists (
    select 1 from sow w
    where ltrim(w.order_no, '0') = ltrim(t.order_no, '0')
      and w.operation_no = (case when btrim(coalesce(t.operation_no, '')) ~ '^\\d+$'
                                 then btrim(t.operation_no)::integer end))"""

with psycopg.connect(dsn) as conn:
    tanpa = conn.execute(GARBAGE.format(sap_clause="")).fetchone()[0]
    dengan = conn.execute(GARBAGE.format(sap_clause=SAP_CLAUSE)).fetchone()[0]
    sisa = conn.execute(
        GARBAGE.format(sap_clause="") + " and ltrim(t.order_no,'0') = '1000120826' and btrim(t.operation_no) = '0'"
    ).fetchone()[0]
    sisa_setelah = conn.execute(
        GARBAGE.format(sap_clause=SAP_CLAUSE) + " and ltrim(t.order_no,'0') = '1000120826' and btrim(t.operation_no) = '0'"
    ).fetchone()[0]

assert sisa > 0, "task sampah op '0' harus lolos filter LAMA (itu buktinya bug)"
assert sisa_setelah == 0, "task sampah op '0' harus terbuang filter BARU"
assert tanpa - dengan == sisa, (
    "hanya baris tanpa padanan SAP yang boleh hilang (%s terbuang, %s sampah)" % (tanpa - dengan, sisa)
)

print("OK visibility — lama:", sorted(old_names))
print("OK visibility — baru:", sorted(new_names))
print("OK actual   — lama (semua sama):", total)
print("OK actual   — baru:", {k: v for k, v in sorted(new_hours.items()) if v})
print("OK planhours summary (MSP -> SAP):",
      {op: f"{v['msp']} -> {v['sap']}" for op, v in sorted(summ.items())})
print(f"OK sap-only  — baris terjadwal {tanpa} -> {dengan} (terbuang {tanpa - dengan}, semuanya sampah)")
