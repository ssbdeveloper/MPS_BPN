from __future__ import annotations

import argparse
import json
import time
import uuid
from datetime import date, datetime, timedelta, tzinfo

import psycopg2.extras

from sap_staging_common import (
    stage_lock,
    app_timezone,
    connect_source,
    connect_staging,
    cursor_initial_from,
    cursor_overlap_minutes,
    cursor_safety_delay_minutes,
    assert_staging_schema,
    ensure_staging_schema,
    get_stage_cursor,
    insert_staging_rows,
    load_sap_rules,
    load_sap_rules_default,
    ph3_order_table,
    plant_code,
    quote_table_name,
    setup_logging,
    update_stage_cursor,
    upsert_eligibility_audit,
)
from timesheet_allocation import Record, allocate_records, apply_cap
from timesheet_normalization import normalize_timesheet_rows
from stage_batching import (
    apply_emission_gate,
    build_provenance,
    filter_by_cutoff,
    limit_by_operator_day,
    next_cursor_value,
    select_complete_days,
)
from stage_cutoff import load_plant_cutoff, CutoffError
from zoneinfo import ZoneInfo

log = setup_logging("stage_timesheet_transaction")


def allocate_staging_rows(rows: list[dict]) -> list[dict]:
    """Hitung jam efektif per record dengan alokasi bagi rata per irisan waktu.

    Tiga besaran dipisah tegas (jangan dicampur):
        raw_seconds           durasi mentah (non-produktif sudah dikurangi break)
        allocated_seconds     hasil bagi rata per irisan, SEBELUM cap
        sap_effective_seconds allocated_seconds SETELAH cap per record

    Aturan bisnis (keputusan owner 22 Sep 2026):
      - bagi RATA antar record PRODUKTIF yang aktif pada irisan yang sama;
      - record NON-PRODUKTIF (activitytype terisi) TIDAK ikut membagi dan
        tidak mengurangi jam produktif -> allocated = raw;
      - SAP menerima jam efektif, bukan SUM(duration) mentah.

    Invariant: SUM(allocated_seconds) produktif per operator-tanggal
    = union wall-clock produktif operator tersebut.

    Baris dengan sap_effective_seconds <= 0 dibuang (tidak dikirim ke SAP).
    """
    productive = [r for r in rows if not (r.get("activitytype") or "").strip()]
    records = [
        Record(
            tsnumber=int(r["tsnumber"]),
            serialnumber=str(r.get("serialnumber") or ""),
            start=r["alloc_start"],
            end=r["alloc_end"],
            activitytype=r.get("activitytype") or "",
            order_no=r.get("order_no") or "",
        )
        for r in productive
    ]
    result = allocate_records(records)

    out: list[dict] = []
    for r in rows:
        row = dict(r)
        ts = int(row["tsnumber"])
        raw = int(row.get("raw_seconds") or 0)
        break_seconds = int(row.get("break_seconds") or 0)
        is_productive = not (row.get("activitytype") or "").strip()

        if is_productive:
            # Produktif tidak pernah dipotong break; jam dibagi per irisan.
            row["raw_seconds"] = raw
            allocated = int(result.allocated.get(ts, 0))
        else:
            # Non-produktif: break dipotong, tetapi tidak ikut pembagian.
            row["raw_seconds"] = max(raw - break_seconds, 0)
            allocated = row["raw_seconds"]

        row["allocated_seconds"] = allocated
        row["sap_effective_seconds"] = apply_cap(allocated, row.get("cap_minutes"))
        row["total_seconds"] = row["sap_effective_seconds"]

        if row["sap_effective_seconds"] <= 0:
            continue

        # emit=False: record companion — ditarik hanya supaya pembagi per irisan
        # benar ketika window cursor memotong satu operator-hari di tengah.
        # Ikut menghitung alokasi, TIDAK dikirim ke SAP.
        if row.get("emit") is False:
            continue

        # IEDD/IEDZ sintetis: checkin + jam EFEKTIF (bukan checkout asli), supaya
        # durasi yang dibaca SAP sama dengan jam yang benar-benar diakui.
        start = row["alloc_start"].replace(microsecond=0)
        end = start + timedelta(seconds=row["sap_effective_seconds"])
        row["iedd"] = end.strftime("%Y%m%d")
        row["iedz"] = end.strftime("%H%M%S")
        row["source_min_start"] = start
        row["source_max_end"] = end
        out.append(row)

    return out


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


def cursor_window(conn, overlap_minutes: int, safety_delay_minutes: int) -> tuple[datetime, datetime]:
    """FAIL-CLOSED: cursor mode tidak tersedia pada jalur timesheet.

    Keputusan owner: rilis pertama HANYA manual `--from-ts`/`--to-ts`, dan cursor
    mode tidak boleh menjadi default. Kontrak cursor yang aman belum dapat
    dibuktikan untuk jalur ini:

      * `next_cursor_value()` memajukan cursor ke `max(longdate_checkout)` dari
        row yang DIKEMBALIKAN, sementara `fetch_rows()` memotong kandidat dengan
        LIMIT pada batas operator-day. Row yang tertahan LIMIT punya checkout di
        belakang cursor baru, sehingga akan terlewat secara permanen pada run
        berikutnya;
      * row `BLOCKED` (master SAP tidak lengkap) tidak ikut `rows`, jadi cursor
        yang maju melewatinya menghilangkan kesempatan retry;
      * fallback `to_ts` memperparah keduanya karena melompat ke akhir window
        meski tidak satu pun row diproses.

    Karena itu helper ini sengaja menolak jalan, bukan mengembalikan window yang
    kelihatan benar. Mengaktifkan kembali cursor mode adalah pekerjaan lanjutan
    dan membutuhkan watermark berbasis row yang benar-benar selesai diproses
    (termasuk yang BLOCKED) — bukan `max(checkout)` dari batch yang sudah
    dipotong LIMIT.
    """
    raise RuntimeError(
        "cursor_window dinonaktifkan fail-closed: stager timesheet hanya mendukung "
        "manual --from-ts/--to-ts pada rilis pertama. Cursor mode tidak boleh menjadi "
        "default dan kontrak amannya belum dapat dibuktikan terhadap LIMIT/BLOCKED."
    )


def fetch_rows(from_ts: datetime, to_ts: datetime, limit: int) -> tuple[list[dict], list[dict]]:
    ph3_table = quote_table_name(ph3_order_table())
    timezone = app_timezone()

    # Rules config (plant_config.sap_rules) — cap per record + jam istirahat.
    try:
        with connect_source() as conn:
            rules = load_sap_rules(conn)
    except Exception as exc:
        log.warning("fetch_rows: load_sap_rules gagal, pakai default (%s)", exc)
        rules = load_sap_rules_default()
    break_windows_json = json.dumps(rules.get("break_windows", []))
    max_record = rules.get("max_record_minutes") or {}
    # Cap per JENIS: key = activitytype ("" = productive), nilai menit atau null = No Limit.
    max_record_ts_json = json.dumps(max_record.get("timesheet") or {})
    # Fallback kategori HANYA untuk activitytype yang tidak ada di map (config lama /
    # kode baru yang belum diatur). None -> tanpa cap.
    fallback = rules.get("max_record_fallback") or {}
    fb_va = fallback.get("va")
    fb_nva = fallback.get("nva")

    sql = f"""
    WITH cap_cfg AS (
      SELECT %s::jsonb AS ts
    ),
    break_windows AS (
      SELECT
        (bw ->> 'start')::time AS start_t,
        (bw ->> 'end')::time AS end_t,
        d.day::int AS dow
      FROM jsonb_array_elements(%s::jsonb) AS bw
      CROSS JOIN LATERAL jsonb_array_elements_text(bw -> 'days') AS d(day)
    ),
    -- Durasi EFEKTIF per record:
    --   • record PRODUKTIF (activitytype kosong) -> dihitung PENUH (break bukan
    --     exclusion window untuk productive activity; cap = timesheet[''])
    --   • record NON-PRODUKTIF (activitytype terisi) -> overlap jam istirahat
    --     DIKURANGI; record yang SELURUHNYA di jam istirahat (efektif <= 0)
    --     dianggap tidak valid dan diabaikan; cap = timesheet[activitytype]
    -- (Koreksi 2026-08-19: sebelumnya break memotong productive — SALAH.
    --  Per-jenis 2026-08-30: cap dibaca dari map per activitytype; null = No Limit;
    --  kode yang belum diatur memakai fallback kategori config lama.)
    -- IEDD/IEDZ jadi SINTETIS = checkin + durasi efektif (filosofi MCH: yang
    -- akurat adalah durasi, bukan jendela waktu aslinya).
    base AS (
      SELECT
        t.*,
        un.roles,
        po.confirmation_number,
        po.sequence_category,
        po.sequence_number,
        po.branch_operation_no,
        po.return_operation_no,
        -- SAP hanya menerima HHMMSS. Normalisasi kedua endpoint ke detik sebelum
        -- menghitung durasi agar IEDZ tidak tampak mundur akibat milidetik.
        EXTRACT(EPOCH FROM (
          date_trunc('second', t.longdate_checkout)
          - date_trunc('second', t.longdate_checkin)
        ))::bigint AS raw_seconds,
        COALESCE(b.break_seconds, 0)::bigint AS break_seconds,
        CASE
          WHEN jsonb_typeof(cc.ts -> BTRIM(COALESCE(t.activitytype, ''))) = 'null' THEN NULL
          WHEN (cc.ts ->> BTRIM(COALESCE(t.activitytype, ''))) ~ '^[0-9]+$'
            THEN (cc.ts ->> BTRIM(COALESCE(t.activitytype, '')))::int
          WHEN BTRIM(COALESCE(t.activitytype, '')) = '' THEN %s::int
          ELSE %s::int
        END AS cap_minutes,
        -- in_window: record yang benar-benar masuk window cursor (akan dikirim).
        -- Record di luar window tetap ditarik sebagai COMPANION supaya pembagi
        -- per irisan waktu benar ketika satu operator-hari terpotong window.
        (
          t.longdate_checkout >= (%s::timestamp AT TIME ZONE %s)
          AND t.longdate_checkout < (%s::timestamp AT TIME ZONE %s)
        ) AS in_window,
        -- #16: exclusion TIDAK dipakai untuk membuang baris. Intervalnya tetap
        -- hadir sebagai companion/pembagi multitasking; exclusion hanya berarti
        -- "jangan kirim baris ini ke SAP".
        EXISTS (
          SELECT 1 FROM public.sap_staging_exclusion ex
          WHERE ex.source_system = 'TIMESHEET'
            AND ex.plant = %s
            AND ex.source_row_id = t.tsnumber::text
        ) AS excluded,
        -- #16 (kontrak final #11): productive row tanpa order/operation/
        -- confirmation yang bisa dicocokkan ke master SAP TIDAK boleh masuk
        -- staging dengan payload kosong. Dihitung di sini sebagai data, lalu
        -- digate di Python agar row tetap menjadi pembagi tetapi tidak emit.
        CASE
          WHEN COALESCE(t.activitytype, '') <> '' THEN ARRAY[]::text[]
          ELSE COALESCE(array_remove(ARRAY[
            CASE WHEN NULLIF(BTRIM(COALESCE(t.order_no, '')), '') IS NULL
                 THEN 'order_no' END,
            CASE WHEN t.operation_no IS NULL THEN 'operation_no' END,
            CASE WHEN NULLIF(BTRIM(COALESCE(po.confirmation_number, '')), '') IS NULL
                 THEN 'confirmation_number' END
          ]::text[], NULL), ARRAY[]::text[])
        END AS master_missing,
        -- #15: record terbuka milik operator yang sama berarti operator-day-nya
        -- BELUM selesai; row closed di hari itu tidak boleh dibekukan lebih dulu.
        -- Dibatasi ke sekitar window supaya row terbuka kuno tidak menahan
        -- kemajuan selamanya.
        EXISTS (
          SELECT 1 FROM timesheet_transaction o
          WHERE o.serialnumber = t.serialnumber
            AND COALESCE(o.plant::text, '') = COALESCE(t.plant::text, '')
            AND o.longdate_checkout IS NULL
            AND o.longdate_checkin IS NOT NULL
            AND o.longdate_checkin >= (%s::timestamp AT TIME ZONE %s) - interval '1 day'
            AND o.longdate_checkin <  (%s::timestamp AT TIME ZONE %s) + interval '1 day'
        ) AS operator_has_open_row
      FROM timesheet_transaction t
      CROSS JOIN cap_cfg cc
      LEFT JOIN {ph3_table} po
        ON LTRIM(COALESCE(po.order_no, ''), '0') = t.order_no
       AND LTRIM(COALESCE(po.operation_no, ''), '0') = t.operation_no::text
      LEFT JOIN LATERAL (
        SELECT roles
        FROM usernfc u
        WHERE upper(regexp_replace(COALESCE(u.snssb, ''), '\\s+', '', 'g'))
            = upper(regexp_replace(COALESCE(t.serialnumber, ''), '\\s+', '', 'g'))
        LIMIT 1
      ) un ON TRUE
      LEFT JOIN LATERAL (
        -- Overlap record dengan break windows, per hari (record bisa lintas tengah
        -- malam — night shift 23:00-07:00). Hanya untuk record NON-PRODUKTIF
        -- (activitytype terisi); productive tidak pernah dipotong break.
        SELECT SUM(EXTRACT(EPOCH FROM (
          LEAST(seg_end, day_bucket + bw.end_t)
            - GREATEST(seg_start, day_bucket + bw.start_t)
        ))::bigint)::bigint AS break_seconds
        FROM generate_series(
          date_trunc('day', t.longdate_checkin AT TIME ZONE %s),
          date_trunc('day', t.longdate_checkout AT TIME ZONE %s),
          interval '1 day'
        ) AS g(day_bucket)
        CROSS JOIN LATERAL (
          SELECT
            GREATEST(date_trunc('second', t.longdate_checkin AT TIME ZONE %s), g.day_bucket) AS seg_start,
            LEAST(date_trunc('second', t.longdate_checkout AT TIME ZONE %s), g.day_bucket + interval '1 day') AS seg_end
        ) seg
        CROSS JOIN break_windows bw
        WHERE EXTRACT(DOW FROM g.day_bucket) = bw.dow
          AND COALESCE(t.activitytype, '') <> ''
          AND seg.seg_start < g.day_bucket + bw.end_t
          AND seg.seg_end > g.day_bucket + bw.start_t
      ) b ON TRUE
      WHERE t.longdate_checkin IS NOT NULL
        AND t.longdate_checkout IS NOT NULL
        AND t.longdate_checkout > t.longdate_checkin
        -- Window DIPERLUAS ke seluruh operator-hari yang bersinggungan dengan
        -- window cursor. Tanpa ini, satu job dari sepasang multitask bisa jatuh
        -- di luar window, pembagi menjadi 1, dan jam yang dikirim ke SAP dobel.
        AND EXISTS (
          SELECT 1 FROM timesheet_transaction w
          WHERE w.serialnumber = t.serialnumber
            AND COALESCE(w.plant::text, '') = COALESCE(t.plant::text, '')
            AND w.longdate_checkin IS NOT NULL
            AND w.longdate_checkout IS NOT NULL
            AND w.longdate_checkout > w.longdate_checkin
            AND w.longdate_checkout >= (%s::timestamp AT TIME ZONE %s)
            AND w.longdate_checkout <  (%s::timestamp AT TIME ZONE %s)
            -- Operator-day ditentukan oleh konektivitas interval, bukan tanggal
            -- check-in. Ini mempertahankan companion lintas tengah malam.
            AND t.longdate_checkin < w.longdate_checkout
            AND t.longdate_checkout > w.longdate_checkin
        )
        AND COALESCE(t.plant::text, '') = %s
        AND COALESCE(t.state_flag, 0) <> 5
        AND COALESCE(t.activitytype, '') <> '0000'
        -- Exclusion sengaja TIDAK menjadi predicate di sini: row excluded tetap
        -- ditarik sebagai companion agar divisor alokasi faktual tidak berubah.
        -- Gate emit dilakukan setelah alokasi oleh apply_emission_gate().
        -- Subcont role (2026-09-15, owner keputusan): jam operator Subcont TIDAK PERNAH
        -- dikirim ke SAP — dikecualikan di sini, sebelum bundling. Adoption (EWS) tidak
        -- terpengaruh karena job adoption membaca timesheet_transaction langsung.
        AND upper(BTRIM(COALESCE(un.roles, ''))) <> 'SUBCONT'
    ),
    effective AS (
      SELECT
        *,
        -- Alokasi jam efektif TIDAK lagi dihitung di SQL. Kolom berikut hanya
        -- menyiapkan bahan mentahnya; pembagian per irisan waktu dilakukan di
        -- allocate_staging_rows() supaya satu implementasi dipakai bersama
        -- preview_allocation_invariant.py (angka preview = angka produksi).
        GREATEST(raw_seconds - break_seconds, 0) AS effective_seconds
      FROM base
    )
    SELECT
      'TIMESHEET' AS source_system,
      -- source_key global: prefix plant (werks) supaya tsnumber tidak tabrakan
      -- antar plant di staging AWS terpusat (UNIQUE(source_system, source_key)).
      COALESCE(plant, '') || ':' || tsnumber::text AS source_key,
      tsnumber::text AS source_ref_id,
      COALESCE(plant, '') AS werks,
      CASE
        WHEN upper(BTRIM(COALESCE(roles, ''))) IN ('OUTSOURCE', 'ADMINISTRATOR') THEN '11009413'
        ELSE LPAD(COALESCE(serialnumber, ''), 8, '0')
      END AS pernr,
      LPAD(COALESCE(serialnumber, ''), 8, '0') AS pernr_origin,
      CASE WHEN COALESCE(activitytype, '') <> '' THEN '' ELSE COALESCE(confirmation_number, '') END AS rueck,
      CASE WHEN COALESCE(activitytype, '') <> '' THEN '' ELSE LPAD(COALESCE(order_no, ''), 12, '0') END AS aufnr,
      CASE WHEN COALESCE(activitytype, '') <> '' THEN '' ELSE LPAD(COALESCE(operation_no::text, ''), 4, '0') END AS vornr,
      CASE WHEN COALESCE(activitytype, '') <> '' THEN '' ELSE COALESCE(sequence_category, '') END AS flgat,
      CASE WHEN COALESCE(activitytype, '') <> '' THEN '' ELSE COALESCE(sequence_number, '') END AS plnfl,
      CASE WHEN COALESCE(activitytype, '') <> '' THEN '' ELSE COALESCE(branch_operation_no, '') END AS vornr_b,
      CASE WHEN COALESCE(activitytype, '') <> '' THEN '' ELSE COALESCE(return_operation_no, '') END AS vornr_r,
      CASE
        WHEN COALESCE(activitytype, '') <> '' THEN ''
        WHEN COALESCE(workcentercode, '') LIKE '%%OT' THEN 'OV'
        WHEN COALESCE(order_no, '') LIKE '32%%' THEN 'RW'
        ELSE 'RG'
      END AS zconf_type,
      COALESCE(workcentercode, '') AS arbpl,
      CASE WHEN COALESCE(activitytype, '') <> '' THEN activitytype ELSE '' END AS lstar,
      TO_CHAR(longdate_checkin AT TIME ZONE %s, 'YYYYMMDD') AS isdd,
      TO_CHAR(longdate_checkin AT TIME ZONE %s, 'HH24MISS') AS isdz,
      -- IEDD/IEDZ SINTETIS: checkin + durasi efektif (non-produktif dipotong
      -- istirahat; produktif tetap penuh; keduanya di-cap).
      TO_CHAR(date_trunc('second', longdate_checkin AT TIME ZONE %s) + (effective_seconds || ' seconds')::interval, 'YYYYMMDD') AS iedd,
      TO_CHAR(date_trunc('second', longdate_checkin AT TIME ZONE %s) + (effective_seconds || ' seconds')::interval, 'HH24MISS') AS iedz,
      '' AS aueru,
      '' AS zbarcodeid,
      NULL::timestamp AS bucket_start,
      NULL::timestamp AS synthetic_start,
      NULL::timestamp AS synthetic_end,
      effective_seconds AS total_seconds,
      1::integer AS source_row_count,
      date_trunc('second', longdate_checkin AT TIME ZONE %s) AS source_min_start,
      date_trunc('second', longdate_checkin AT TIME ZONE %s) + (effective_seconds || ' seconds')::interval AS source_max_end,
      jsonb_build_array(jsonb_build_object(
        'id', tsnumber::text,
        'bucket', date_trunc('second', longdate_checkin AT TIME ZONE %s),
        'sec', effective_seconds
      )) AS segments,
      -- Bahan alokasi (dipakai allocate_staging_rows, bukan dikirim ke SAP):
      tsnumber AS alloc_tsnumber,
      COALESCE(serialnumber, '') AS alloc_serial,
      COALESCE(activitytype, '') AS alloc_activitytype,
      COALESCE(order_no, '') AS alloc_order_no,
      raw_seconds AS alloc_raw_seconds,
      break_seconds AS alloc_break_seconds,
      cap_minutes AS alloc_cap_minutes,
      date_trunc('second', longdate_checkin AT TIME ZONE %s) AS alloc_start,
      date_trunc('second', longdate_checkout AT TIME ZONE %s) AS alloc_end,
      in_window AS alloc_emit,
      excluded AS alloc_excluded,
      master_missing AS alloc_master_missing,
      operator_has_open_row AS alloc_operator_has_open_row
    FROM effective
    WHERE effective_seconds > 0
    ORDER BY longdate_checkout, tsnumber
    """

    # Urutan parameter mengikuti placeholder SQL secara tekstual. Jangan mengurutkan
    # berdasarkan CTE: placeholder SELECT base muncul sebelum LATERAL break dan WHERE.
    params = [
        max_record_ts_json,                       # 1  cap_cfg
        break_windows_json,                       # 2  break_windows
        fb_va, fb_nva,                            # 3-4 fallback cap produktif/non-prod
        from_ts, timezone, to_ts, timezone,       # 5-8  in_window
        plant_code(),                             # 9     excluded flag
        from_ts, timezone, to_ts, timezone,       # 10-13 open-row window
        timezone, timezone, timezone, timezone,   # 14-17 break LATERAL
        from_ts, timezone, to_ts, timezone,       # 18-21 EXISTS cursor window
        plant_code(),                             # 22    plant predicate
        timezone, timezone,                       # 23-24 isdd/isdz
        timezone, timezone,                       # 25-26 iedd/iedz
        timezone, timezone,                       # 27-28 source min/max
        timezone,                                 # 29    segment bucket
        timezone, timezone,                       # 30-31 alloc start/end
    ]
    with connect_source() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            raw_rows = [dict(row) for row in cur.fetchall()]

    # Alokasi bagi rata per irisan waktu. Companion (alloc_emit=False) ikut
    # menghitung pembagi lalu dibuang, sehingga LIMIT diterapkan SETELAH alokasi
    # — memotong sebelum alokasi akan membuat pembagi salah.
    # #21/#22/#23: otoritas normalisasi cap, break, dan presisi detik adalah
    # modul Python yang SAMA dengan preview. SQL tetap menghitung kandidat untuk
    # filtering murah, tetapi angka yang masuk alokasi dioverride di sini supaya
    # kedua jalur tidak dapat menyimpang ketika aturan berubah.
    alloc_input = normalize_timesheet_rows([
        {
            "tsnumber": r["alloc_tsnumber"],
            "serialnumber": r["alloc_serial"],
            "activitytype": r["alloc_activitytype"],
            "order_no": r["alloc_order_no"],
            "start": r["alloc_start"],
            "end": r["alloc_end"],
            "in_window": r["alloc_emit"],
            "excluded": r["alloc_excluded"],
            "master_missing": r["alloc_master_missing"],
            "operator_has_open_row": r["alloc_operator_has_open_row"],
            "_row": r,
        }
        for r in raw_rows
    ], rules)

    # #16: exclusion dan master incomplete menentukan emit, BUKAN keikutsertaan
    # sebagai pembagi. Baris yang tidak emit tetap ikut alokasi (companion).
    alloc_input, blocked_master = apply_emission_gate(alloc_input)

    rows: list[dict] = []
    for allocated in allocate_staging_rows(alloc_input):
        row = allocated["_row"]
        row["total_seconds"] = allocated["total_seconds"]
        row["iedd"] = allocated["iedd"]
        row["iedz"] = allocated["iedz"]
        row["source_min_start"] = allocated["source_min_start"]
        row["source_max_end"] = allocated["source_max_end"]
        # #17: simpan keempat angka supaya selisihnya bisa direkonsiliasi tanpa
        # menjalankan ulang alokasi (raw -> alloc = multitasking, alloc -> sec = cap).
        cap_minutes = allocated.get("cap_minutes")
        raw_val = int(allocated.get("timestamp_raw_seconds", allocated["raw_seconds"]))
        alloc_val = int(allocated["allocated_seconds"])
        cap_val = None if cap_minutes is None else int(cap_minutes) * 60
        eff_val = int(allocated["total_seconds"])
        snapshot = {
            "raw": raw_val,
            "alloc": alloc_val,
            "cap": cap_val,
            "sec": eff_val,
            "raw_seconds": raw_val,
            "allocated_seconds": alloc_val,
            "cap_seconds": cap_val,
            "sap_effective_seconds": eff_val,
            "allocation_version": "effective-segments-v1",
        }
        row["provenance"] = {**snapshot, "segments": [build_provenance(
            source_ref_id=row["source_ref_id"],
            bucket_start=allocated["source_min_start"],
            raw_seconds=raw_val,
            allocated_seconds=alloc_val,
            cap_seconds=cap_val,
            sap_effective_seconds=eff_val,
            allocation_version="effective-segments-v1",
        )]}
        # Kolom pusat: satu-satunya tempat angka ini bertahan setelah staging.
        row["provenance_snapshot"] = snapshot
        # #12/#14/#15: batching per operator-day butuh identitas operator dan
        # checkout NYATA (bukan source_max_end sintetis). Disalin dari kolom
        # alloc_* sebelum kolom itu dibuang.
        row["serialnumber"] = allocated["serialnumber"]
        row["longdate_checkout"] = allocated.get("alloc_end")
        # alloc_start/alloc_end MASIH dipakai select_complete_days dan
        # limit_by_operator_day di bawah — baru dibuang setelah batching.
        for key in list(row):
            if key.startswith("alloc_") and key not in ("alloc_start", "alloc_end"):
                row.pop(key)
        rows.append(row)

    # #15: hari berjalan tidak boleh dibekukan dari data parsial, dan #13: LIMIT
    # diterapkan pada batas operator-day. Memotong di tengah operator-day akan
    # mengirim satu job dari sepasang multitask dengan pembagi yang salah, lalu
    # membekukannya permanen.
    #
    # Operator yang masih punya record TERBUKA (belum checkout) juga menahan
    # operator-day-nya: alokasi hari itu belum final.
    tz = ZoneInfo(app_timezone())
    for row in rows:
        if row.get("operator_has_open_row"):
            row["open_row_block"] = True
    complete = select_complete_days(rows, now=datetime.now(tz), tz=tz, blocked=blocked_master)

    # #18: cutoff plant diterapkan SEBELUM limit/cursor. Backlog pra-cutoff
    # dibuang dari kandidat tanpa menyentuh registry freeze sama sekali, sehingga
    # run bisa maju melewatinya. Cutoff belum diset -> fail-closed, bukan diam-diam
    # memproses seluruh sejarah.
    with connect_source() as source_conn:
        cutoff = load_plant_cutoff(source_conn, plant_code())
    complete, dropped_pre_cutoff = filter_by_cutoff(complete, tz, cutoff)
    if dropped_pre_cutoff:
        log.info(
            "Cutoff %s: %s row sebelum cutoff tidak di-stage (dilewati, tidak dibekukan)",
            cutoff, len(dropped_pre_cutoff),
        )

    batched = limit_by_operator_day(complete, limit=limit, tz=tz, allow_first_oversize=True)

    for row in batched:
        row.pop("alloc_start", None)
        row.pop("alloc_end", None)
    return batched, blocked_master


def assert_source_runtime_context(conn, expected_plant: str, expected_tz: tzinfo | str | None = None) -> None:
    """Validasi bahwa source DB yang terhubung cocok dengan konfigurasi proses (plant & timezone)."""
    with conn.cursor() as cur:
        cur.execute("SELECT plant_code, timezone FROM public.plant_config WHERE id = 1 LIMIT 1")
        row = cur.fetchone()
        if not row:
            raise RuntimeError("Source DB tidak memiliki konfigurasi public.plant_config (id=1).")
        db_plant, db_tz_str = row
        if str(db_plant or "").strip() != str(expected_plant or "").strip():
            raise RuntimeError(
                f"Plant mismatch: proses dikonfigurasi untuk plant={expected_plant}, "
                f"tetapi database yang terhubung adalah plant={db_plant}. Operasi dibatalkan demi keamanan."
            )
        if not db_tz_str:
            raise RuntimeError(f"plant_config.timezone pada plant={db_plant} kosong.")
        if expected_tz is not None:
            expected_key = expected_tz.key if hasattr(expected_tz, "key") else str(expected_tz)
            if db_tz_str.strip() != expected_key.strip():
                raise RuntimeError(
                    f"Timezone mismatch: proses dikonfigurasi untuk timezone={expected_key}, "
                    f"tetapi database yang terhubung memiliki plant_config.timezone={db_tz_str}."
                )


def assert_source_outbox_schema(conn) -> None:
    """Preflight schema source: periksa tabel outbox dan freeze secara read-only.

    Fail-closed tanpa DDL runtime jika migration 20260922b_timesheet_freeze_and_audit.sql belum dipasang.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN ('timesheet_staging_outbox', 'timesheet_staging_freeze')
            """
        )
        found = {r[0] for r in cur.fetchall()}
        missing = {'timesheet_staging_outbox', 'timesheet_staging_freeze'} - found
        if missing:
            raise RuntimeError(
                f"Source schema preflight gagal: tabel {sorted(missing)} belum ada di database source. "
                "Pasang migration database/migrations/api/20260922b_timesheet_freeze_and_audit.sql terlebih dahulu."
            )


def build_rows_snapshot(rows: list[dict]) -> dict:
    snapshot = {}
    for row in rows:
        ref = str(row["source_ref_id"])
        already = row.get("provenance")
        if isinstance(already, dict):
            raw_val = int(already.get("raw_seconds") or already.get("raw") or 0)
            alloc_val = int(already.get("allocated_seconds") or already.get("alloc") or 0)
            cap_val = (
                None
                if already.get("cap_seconds") is None and already.get("cap") is None
                else int(already.get("cap_seconds", already.get("cap")))
            )
            sec_val = int(already.get("sap_effective_seconds") or already.get("sec") or 0)
            ver_val = str(already.get("allocation_version") or "effective-segments-v1")
            snapshot[ref] = {
                "raw": raw_val,
                "alloc": alloc_val,
                "cap": cap_val,
                "sec": sec_val,
                "raw_seconds": raw_val,
                "allocated_seconds": alloc_val,
                "cap_seconds": cap_val,
                "sap_effective_seconds": sec_val,
                "allocation_version": ver_val,
            }
            continue
        raw_val = int(row.get("timestamp_raw_seconds", row.get("raw_seconds")) or 0)
        alloc_val = int(row.get("allocated_seconds") or 0)
        cap_val = None if row.get("cap_minutes") is None else int(row["cap_minutes"]) * 60
        sec_val = int(row.get("sap_effective_seconds") or 0)
        snapshot[ref] = {
            "raw": raw_val,
            "alloc": alloc_val,
            "cap": cap_val,
            "sec": sec_val,
            "raw_seconds": raw_val,
            "allocated_seconds": alloc_val,
            "cap_seconds": cap_val,
            "sap_effective_seconds": sec_val,
            "allocation_version": "effective-segments-v1",
        }
    return snapshot


def _json_safe(value):
    """Ubah struktur bersarang menjadi bentuk yang aman untuk json.dumps().

    Payload outbox adalah SATU-SATUNYA salinan baris yang dipakai reconciler
    setelah crash, jadi serialisasinya tidak boleh gagal separuh jalan. Versi
    sebelumnya hanya mengubah datetime pada level teratas, sehingga datetime di
    dalam list/dict bersarang (mis. `segments`) meledak dengan
    `TypeError: Object of type datetime is not JSON serializable` — reservation
    gagal dibuat dan crash-recovery kehilangan payload-nya.
    """
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


def reserve_staging_rows(conn, rows: list[dict], *, batch_id: str | None = None) -> tuple[str, int]:
    """Freeze source row dan catat outbox reservation SEBELUM kirim ke central staging.

    Menjamin tidak ada window staged-but-unfrozen:
    1. Row tsnumber dibekukan di source DB (timesheet_staging_freeze status STAGING_RESERVED).
    2. Outbox record dicatat dengan status RESERVED beserta snapshot alokasi & payload.
    3. Commit source DB secara atomik.
    """
    if not rows:
        return "", 0
    plants = {str(row.get("werks") or "").strip() for row in rows}
    if len(plants) != 1 or "" in plants:
        raise ValueError(f"freeze rows harus tepat satu plant, ditemukan: {sorted(plants)}")
    plant = next(iter(plants))
    ids = sorted({int(row["source_ref_id"]) for row in rows})
    bid = batch_id or uuid.uuid4().hex

    snapshot = build_rows_snapshot(rows)
    assert_source_outbox_schema(conn)

    serializable_rows = [_json_safe(r) for r in rows]

    with conn.cursor() as cur:
        cur.execute(
            "SELECT public.timesheet_mark_staged(%s::integer[], %s, %s, %s, %s::jsonb)",
            (
                ids,
                plant,
                "STAGING_RESERVED",
                f"staging reserved batch {bid}",
                json.dumps(snapshot),
            ),
        )
        count = int(cur.fetchone()[0] or 0)

        cur.execute(
            """
            INSERT INTO public.timesheet_staging_outbox
              (batch_id, plant, status, source_ref_ids, snapshot, payload)
            VALUES (%s, %s, 'STAGING_RESERVED', %s, %s::jsonb, %s::jsonb)
            ON CONFLICT (batch_id) DO NOTHING
            """,
            (
                bid,
                plant,
                ids,
                json.dumps(snapshot),
                json.dumps(serializable_rows),
            ),
        )
    conn.commit()
    return bid, count


def mark_reservation_staged(conn, *, batch_id: str, ids: list[int]) -> int:
    """Tandai reservation outbox selesai setelah central staging berhasil di-commit."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE public.timesheet_staging_outbox
            SET status = 'STAGED', updated_at = now()
            WHERE batch_id = %s
            """,
            (batch_id,),
        )
        cur.execute(
            """
            UPDATE public.timesheet_staging_freeze
            SET first_seen_status = 'PENDING'
            WHERE tsnumber = ANY(%s::integer[])
              AND first_seen_status = 'STAGING_RESERVED'
            """,
            (ids,),
        )
        count = int(cur.rowcount or 0)
    conn.commit()
    return count


def list_pending_reservations(conn, *, plant: str) -> list[dict]:
    """Daftar outbox reservation yang masih RESERVED (butuh retry)."""
    assert_source_outbox_schema(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, batch_id, plant, status, source_ref_ids, created_at, updated_at
            FROM public.timesheet_staging_outbox
            WHERE plant = %s AND status = 'STAGING_RESERVED'
            ORDER BY id ASC
            """,
            (plant,),
        )
        cols = [desc[0] for desc in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def retry_staging_reservations(source_conn, staging_conn, *, plant: str) -> int:
    """Retry semua pending outbox reservation ke central staging."""
    pending = list_pending_reservations(source_conn, plant=plant)
    if not pending:
        return 0
    retried = 0
    for item in pending:
        bid = item["batch_id"]
        with source_conn.cursor() as cur:
            cur.execute(
                "SELECT payload, source_ref_ids FROM public.timesheet_staging_outbox WHERE batch_id = %s",
                (bid,),
            )
            row = cur.fetchone()
            if not row:
                continue
            payload_rows, ids = row[0], row[1]
        log.info("Retrying pending reservation batch %s (%s rows)", bid, len(payload_rows))
        insert_staging_rows(staging_conn, payload_rows)
        upsert_eligibility_audit(staging_conn, dedupe_audit_rows([
            *audit_rows_for_staged(payload_rows),
            *fetch_blocked_today_rows(source_conn),
        ]))
        mark_reservation_staged(source_conn, batch_id=bid, ids=ids)
        retried += 1
    return retried


def mark_rows_frozen(conn, rows: list[dict]) -> int:
    """Freeze source row secara monotonic (kompatibilitas mundur)."""
    _bid, count = reserve_staging_rows(conn, rows)
    return count


def reconcile_freeze_registry(conn, *, plant: str) -> int:
    """Pulihkan local freeze dari provenance/exclusion secara monotonic.

    Wajib dipanggil sebelum mengambil kandidat baru. Bila proses sebelumnya mati
    setelah commit staging pusat tetapi sebelum local freeze, provenance FDW
    menutup gap tersebut pada run berikutnya.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH candidates AS (
              SELECT source_row_id, plant, 'RECONCILE_PROVENANCE'::text AS status,
                     'reconciled from sap_staging_source'::text AS note
              FROM public.sap_staging_source
              WHERE source_system = 'TIMESHEET' AND plant = %s
              UNION ALL
              SELECT source_row_id, plant, 'RECONCILE_EXCLUSION'::text,
                     'reconciled from sap_staging_exclusion'::text
              FROM public.sap_staging_exclusion
              WHERE source_system = 'TIMESHEET' AND plant = %s
            ),
            parsed AS (
              SELECT
                NULLIF(regexp_replace(source_row_id, '\\D', '', 'g'), '')::integer AS tsnumber,
                plant, status, note
              FROM candidates
              WHERE NULLIF(regexp_replace(source_row_id, '\\D', '', 'g'), '') IS NOT NULL
            )
            INSERT INTO public.timesheet_staging_freeze
              (tsnumber, plant, first_seen_status, note)
            SELECT DISTINCT ON (tsnumber)
              tsnumber, plant, status, note
            FROM parsed
            ORDER BY tsnumber, status
            ON CONFLICT (tsnumber) DO NOTHING
            """,
            (plant, plant),
        )
        count = max(int(cur.rowcount or 0), 0)
    conn.commit()
    return count


def dedupe_audit_rows(rows: list[dict]) -> list[dict]:
    """Drop duplicate (source_system, source_key) pairs, keeping the first.

    execute_values runs a single INSERT ... ON CONFLICT DO UPDATE; two rows with
    the same conflict key in one batch raise CardinalityViolation. Callers pass
    STAGED rows before BLOCKED rows so STAGED wins on overlap.
    """
    seen: set[tuple] = set()
    result = []
    for row in rows:
        key = (row.get("source_system"), row.get("source_key"))
        if key in seen:
            continue
        seen.add(key)
        result.append(row)
    return result


def audit_rows_for_staged(rows: list[dict]) -> list[dict]:
    res = []
    for row in rows:
        val = row.get("source_min_start")
        if isinstance(val, (datetime, date)):
            s_date = val.date() if isinstance(val, datetime) else val
        elif isinstance(val, str) and val:
            try:
                s_date = datetime.fromisoformat(val).date()
            except Exception:
                s_date = None
        else:
            s_date = None
        res.append({
            "source_system": row["source_system"],
            "source_key": row["source_key"],
            "source_ref_id": row.get("source_ref_id"),
            "source_date": s_date,
            "plant": row.get("werks") or plant_code(),
            "eligibility_status": "STAGED",
            "block_reason": None,
            "block_detail": json.dumps({"staged_to": "sap_timesheet_staging"}),
        })
    return res


def fetch_blocked_today_rows(conn=None) -> list[dict]:
    """Audit row hari ini yang TIDAK layak SAP (missing order/operation/sow match).

    Sengaja hanya hari ini: ini pelengkap audit harian, bukan gate staging —
    gate sebenarnya adalah apply_emission_gate() di fetch_rows(), yang berjalan
    SEBELUM insert dan berlaku untuk semua tanggal.
    """
    ph3_table = quote_table_name(ph3_order_table())
    timezone = app_timezone()

    sql = f"""
    WITH base AS (
      SELECT
        t.tsnumber,
        t.plant,
        (t.longdate_checkin AT TIME ZONE %s)::date AS source_date,
        t.activitytype,
        t.order_no,
        t.operation_no,
        EXISTS (
          SELECT 1
          FROM {ph3_table} po
          WHERE LTRIM(COALESCE(po.order_no, ''), '0') = LTRIM(COALESCE(t.order_no, ''), '0')
            AND LTRIM(COALESCE(po.operation_no, ''), '0') = t.operation_no::text
        ) AS has_sow_match
      FROM timesheet_transaction t
      WHERE t.longdate_checkin IS NOT NULL
        AND t.longdate_checkin >= (date_trunc('day', now() AT TIME ZONE %s) AT TIME ZONE %s)
        AND t.longdate_checkin <  (date_trunc('day', now() AT TIME ZONE %s) AT TIME ZONE %s) + interval '1 day'
        AND COALESCE(t.state_flag, 0) <> 5
        AND COALESCE(t.activitytype, '') <> '0000'
    ),
    flags AS (
      SELECT
        *,
        (NULLIF(BTRIM(COALESCE(activitytype, '')), '') IS NULL AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NULL) AS missing_order,
        (NULLIF(BTRIM(COALESCE(activitytype, '')), '') IS NULL AND operation_no IS NULL) AS missing_operation,
        (
          NULLIF(BTRIM(COALESCE(activitytype, '')), '') IS NULL
          AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NOT NULL
          AND operation_no IS NOT NULL
          AND NOT has_sow_match
        ) AS sow_no_match
      FROM base
    )
    SELECT *
    FROM flags
    WHERE missing_order OR missing_operation OR sow_no_match
    ORDER BY tsnumber
    """

    if conn is not None:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (timezone, timezone, timezone, timezone, timezone))
            rows = [dict(row) for row in cur.fetchall()]
    else:
        with connect_source() as c:
            with c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, (timezone, timezone, timezone, timezone, timezone))
                rows = [dict(row) for row in cur.fetchall()]

    audit_rows = []
    for row in rows:
        reasons = []
        if row.get("missing_order"):
            reasons.append("missing_order")
        if row.get("missing_operation"):
            reasons.append("missing_operation")
        if row.get("sow_no_match"):
            reasons.append("sow_no_match")

        audit_rows.append({
            "source_system": "TIMESHEET",
            "source_key": f"{row.get('plant') or ''}:{row['tsnumber']}",
            "source_ref_id": str(row["tsnumber"]),
            "source_date": row.get("source_date"),
            "plant": row.get("plant") or plant_code(),
            "eligibility_status": "BLOCKED",
            "block_reason": ",".join(reasons),
            "block_detail": json.dumps({
                "missing_order": bool(row.get("missing_order")),
                "missing_operation": bool(row.get("missing_operation")),
                "sow_no_match": bool(row.get("sow_no_match")),
                "order_no": row.get("order_no"),
                "operation_no": row.get("operation_no"),
            }),
        })
    return audit_rows


def validate_manual_window(args: argparse.Namespace, tz: tzinfo) -> tuple[datetime, datetime]:
    """Validasi parameter manual window (--from-ts dan --to-ts).

    Target rilis pertama:
    - Wajib menggunakan --from-ts dan --to-ts eksplisit.
    - Tanpa rentang / hanya salah satu -> fail-closed dengan pesan jelas.
    - Mode cursor otomatis diparkir -> fail-closed.
    - Window kosong / terbalik (from >= to) ditolak.
    - Hari berjalan (current day) atau masa depan ditolak.
    """
    if getattr(args, "loop", 0):
        raise ValueError("--loop dinonaktifkan: mode cursor otomatis diparkir.")

    if not args.from_ts and not args.to_ts:
        raise ValueError(
            "stage_timesheet_transaction wajib dijalankan manual dengan pasangan --from-ts dan --to-ts. "
            "Mode cursor otomatis diparkir dan fail-closed."
        )
    if not args.from_ts or not args.to_ts:
        raise ValueError("--from-ts dan --to-ts harus digunakan berpasangan.")

    from_ts = parse_dt(args.from_ts)
    to_ts = parse_dt(args.to_ts)

    if from_ts >= to_ts:
        raise ValueError(f"Rentang waktu tidak valid: --from-ts ({from_ts}) harus lebih awal dari --to-ts ({to_ts}).")

    if isinstance(tz, str):
        tz = ZoneInfo(tz)

    from_local = from_ts if from_ts.tzinfo else from_ts.replace(tzinfo=tz)
    to_local = to_ts if to_ts.tzinfo else to_ts.replace(tzinfo=tz)

    now_local = datetime.now(tz)
    today_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)

    if from_local >= today_start or to_local > today_start:
        raise ValueError(
            f"Staging ditolak: rentang [{from_ts}..{to_ts}) menyentuh hari berjalan ({today_start.date()}) "
            "atau masa depan. Staging hanya diizinkan untuk hari yang sudah selesai."
        )

    return from_ts, to_ts


def run_once(args: argparse.Namespace) -> bool:
    tz = app_timezone()

    if getattr(args, "retry_reservations", False):
        with connect_source() as source_conn, connect_staging() as staging_conn:
            assert_source_runtime_context(source_conn, expected_plant=plant_code(), expected_tz=tz)
            assert_source_outbox_schema(source_conn)
            reconciled = reconcile_freeze_registry(source_conn, plant=plant_code())
            ensure_staging_schema(staging_conn)
            retried = retry_staging_reservations(source_conn, staging_conn, plant=plant_code())
            log.info("Retry outbox reservations selesai: %s batch (reconciled=%s)", retried, reconciled)
            return bool(retried)

    from_ts, to_ts = validate_manual_window(args, tz)

    if args.dry_run:
        # Dry-run murni SELECT: tidak reconcile, tidak freeze, tidak membuat outbox, tidak menyentuh staging/audit.
        with connect_source() as source_conn:
            assert_source_runtime_context(source_conn, expected_plant=plant_code(), expected_tz=tz)
            assert_source_outbox_schema(source_conn)
        with connect_staging() as staging_conn:
            assert_staging_schema(staging_conn)
        rows, blocked = fetch_rows(from_ts, to_ts, args.limit)
        log.info(
            "Dry run: window=%s..%s prepared=%s blocked=%s inserted=0",
            from_ts, to_ts, len(rows), len(blocked),
        )
        return bool(rows)

    # #5: tutup crash gap dari run sebelumnya sebelum staging write berikutnya.
    # Hanya registry lokal yang ditambah secara monotonic; source row tidak diubah.
    with connect_source() as source_conn:
        assert_source_runtime_context(source_conn, expected_plant=plant_code(), expected_tz=tz)
        assert_source_outbox_schema(source_conn)
        reconciled = reconcile_freeze_registry(source_conn, plant=plant_code())
    if reconciled:
        log.info("Freeze registry reconciled: %s row(s)", reconciled)

    # Resume outbox reservation yang tertinggal STAGING_RESERVED karena crash,
    # TANPA menunggu flag manual. Reconciler ini idempoten: row central yang sudah
    # ada hanya difinalisasi (freeze + STAGED), tidak diduplikasi. Reservation dan
    # freeze yang gagal TIDAK dihapus, sehingga percobaan berikutnya masih bisa
    # menyelesaikannya.
    with connect_source() as source_conn, connect_staging() as staging_conn:
        ensure_staging_schema(staging_conn)
        resumed = retry_staging_reservations(source_conn, staging_conn, plant=plant_code())
    if resumed:
        log.info("Outbox reservation di-resume: %s batch", resumed)

    # #13/#15: LIMIT diterapkan pada batas operator-day, dan hanya operator-day
    # yang sudah selesai yang boleh masuk. Keduanya di stage_batching.py.
    rows, blocked = fetch_rows(from_ts, to_ts, args.limit)

    if not rows:
        log.info("Timesheet staging window=%s..%s prepared=0 inserted=0", from_ts, to_ts)
        return False

    # Work C: Local reservation / outbox pattern di source DB SEBELUM kirim ke central staging.
    # Menjamin tidak ada window staged-but-unfrozen:
    # 1. Row tsnumber dibekukan di source DB dan reservation dicatat di outbox.
    # 2. Central staging commit idempotent.
    # 3. Reservation outbox ditandai STAGED.
    with connect_source() as source_conn:
        batch_id, reserved_count = reserve_staging_rows(source_conn, rows)

    with connect_staging() as conn:
        ensure_staging_schema(conn)
        inserted = insert_staging_rows(conn, rows)
        audited = upsert_eligibility_audit(conn, dedupe_audit_rows([
            *audit_rows_for_staged(rows),
            *fetch_blocked_today_rows(),
        ]))

    with connect_source() as source_conn:
        ids = [int(r["source_ref_id"]) for r in rows]
        mark_reservation_staged(source_conn, batch_id=batch_id, ids=ids)

    log.info(
        "Timesheet staging window=%s..%s prepared=%s inserted=%s audited=%s reserved=%s batch_id=%s",
        from_ts,
        to_ts,
        len(rows),
        inserted,
        audited,
        reserved_count,
        batch_id,
    )
    return True


def _run_unlocked(args: argparse.Namespace) -> None:
    if getattr(args, "loop", 0):
        raise ValueError("--loop dinonaktifkan: mode cursor otomatis diparkir.")
    run_once(args)


def run(args: argparse.Namespace) -> None:
    with stage_lock("TIMESHEET", plant_code()) as acquired:
        if not acquired:
            log.info("Timesheet staging skipped: worker plant %s masih berjalan", plant_code())
            return
        _run_unlocked(args)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Stage completed timesheet_transaction rows to SAP staging manually by explicit date window.",
    )
    parser.add_argument("--from-ts", help="Start checkout timestamp, e.g. 2026-09-20T00:00:00")
    parser.add_argument("--to-ts", help="End checkout timestamp, e.g. 2026-09-21T00:00:00")
    parser.add_argument("--limit", type=int, default=5000, help="Maximum source rows to stage per run")
    parser.add_argument("--dry-run", action="store_true", help="Preview candidate rows without writing staging or freeze")
    parser.add_argument("--retry-reservations", action="store_true", help="Retry pending outbox reservations to central staging")
    parser.add_argument("--loop", type=int, default=0, help=argparse.SUPPRESS)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    run(args)


if __name__ == "__main__":
    main()
