from __future__ import annotations

import argparse
import base64
import json
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any
from datetime import date

import psycopg2.extras

from sap_staging_common import (
    app_timezone,
    as_json,
    connect_source,
    connect_staging,
    ensure_staging_schema,
    load_plant_cutoff,
    plant_code,
    sap_credentials,
    setup_logging,
)

log = setup_logging("post_sap_staging")
ALLOWED_PLANTS = ("5051", "5071", "5100", "5153")


OUTSOURCE_SAP_PERNR = "11009413"


def sap_employee_number(origin: str) -> str:
    return origin.zfill(8) if origin.isdigit() else origin


def apply_current_nfc_roles(staging_cur, rows: list[dict]) -> list[dict]:
    """Apply latest NFC role to staging only; source employee SN stays unchanged."""
    origins = sorted({str(row.get("pernr_origin") or "").strip() for row in rows if row.get("pernr_origin")})
    if not origins:
        return rows

    with connect_source() as source_conn:
        with source_conn.cursor() as source_cur:
            source_cur.execute(
                """
                SELECT DISTINCT ON (x.origin) x.origin,
                       upper(btrim(COALESCE(u.roles, ''))) AS role
                FROM unnest(%s::text[]) AS x(origin)
                JOIN public.usernfc u ON
                  upper(regexp_replace(COALESCE(u.snssb, ''), '\s+', '', 'g'))
                    = upper(regexp_replace(x.origin, '\s+', '', 'g'))
                  OR (
                    regexp_replace(COALESCE(u.snssb, ''), '\s+', '', 'g') ~ '^[0-9]+$'
                    AND regexp_replace(x.origin, '\s+', '', 'g') ~ '^[0-9]+$'
                    AND ltrim(regexp_replace(COALESCE(u.snssb, ''), '\s+', '', 'g'), '0')
                      = ltrim(regexp_replace(x.origin, '\s+', '', 'g'), '0')
                  )
                ORDER BY x.origin, u.idrow
                """,
                (origins,),
            )
            roles = {origin: role for origin, role in source_cur.fetchall()}

    eligible = []
    for row in rows:
        origin = str(row.get("pernr_origin") or "").strip()
        role = roles.get(origin, "")
        if role == "SUBCONT":
            staging_cur.execute(
                """UPDATE sap_timesheet_staging
                   SET status = 'SKIPPED', sap_error = 'NFC role SUBCONT: not sent to SAP', updated_at = now()
                   WHERE id = %s AND status <> 'POSTED'""",
                (row["id"],),
            )
            continue

        if role in ("OUTSOURCE", "ADMINISTRATOR"):
            desired_pernr = OUTSOURCE_SAP_PERNR
        elif role in ("SSB", "USER", "FOREMAN"):
            desired_pernr = sap_employee_number(origin)
        else:
            desired_pernr = str(row.get("pernr") or row.get("payload", {}).get("PERNR") or "")

        if desired_pernr:
            row["payload"]["PERNR"] = desired_pernr
            staging_cur.execute(
                """UPDATE sap_timesheet_staging
                   SET pernr = %s, payload = jsonb_set(payload, '{PERNR}', to_jsonb(%s::text)), updated_at = now()
                   WHERE id = %s""",
                (desired_pernr, desired_pernr, row["id"]),
            )
        eligible.append(row)
    return eligible


def validate_date_range(date_from: str | None, date_to: str | None) -> None:
    """Manual range must be bounded, valid, and ordered."""
    if bool(date_from) != bool(date_to):
        raise ValueError("--date-from dan --date-to wajib dipakai bersama")
    if not date_from:
        return
    try:
        start = date.fromisoformat(date_from)
        end = date.fromisoformat(date_to)
    except ValueError as exc:
        raise ValueError("Tanggal wajib format YYYY-MM-DD") from exc
    if start > end:
        raise ValueError("--date-from tidak boleh setelah --date-to")


# ── Koneksi DB per-thread, dipakai ulang ─────────────────────────────────────
# Kode lama memanggil `with connect_staging() as conn:` DI DALAM tiap update_result()
# dan log_timesheet_sap() — artinya SATU KONEKSI BARU PER BARIS, dua kali. Diukur lewat
# tunnel Tailscale (relay Singapura): 2.622 ms hanya untuk membuka koneksi. Jadi ~6 detik
# per baris terbuang sebelum SAP disentuh sama sekali.
#
# (Catatan: `with conn` di psycopg2 meng-commit TRANSAKSI, bukan menutup koneksi — jadi
#  koneksi-koneksi itu menumpuk sampai dibersihkan GC.)
#
# Sekarang: satu koneksi per thread, dibuka sekali, dipakai ulang seumur batch.
_tl = threading.local()


def _conn(kind: str):
    conn = getattr(_tl, kind, None)
    if conn is None or conn.closed:
        conn = connect_staging() if kind == "staging" else connect_source()
        setattr(_tl, kind, conn)
    return conn


def _reset_conn(kind: str) -> None:
    """Koneksi rusak (jaringan putus) -> buang, biar dibuat ulang."""
    conn = getattr(_tl, kind, None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass
        setattr(_tl, kind, None)


def _close_thread_conns() -> None:
    for kind in ("staging", "source"):
        _reset_conn(kind)


def parse_sap_status(response_text: str) -> tuple[str, str]:
    try:
        parsed = json.loads(response_text)
    except json.JSONDecodeError:
        return "", response_text

    body = parsed.get("n0:ABM_CPP_223_MT_Timesheet_Res") or {}
    return str(body.get("STATUS") or ""), str(body.get("MESSAGE") or response_text)


def post_payload(payload: dict[str, Any], timeout: int) -> tuple[int, str]:
    url, username, password = sap_credentials()
    if not url or not username or not password:
        raise RuntimeError("SAP_INBOUND_URL, SAP_INBOUND_USERNAME, and SAP_INBOUND_PASSWORD are required")

    basic_auth = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Basic {basic_auth}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")


def exclusion_guard_sql() -> str:
    """Guard exclusion (bundle yang masih memuat record excluded tidak boleh dikirim).

    Satu definisi saja: dipakai eligibility_predicate (#20), claim_selected_rows,
    dan preview_rows jalur --ids. Sebelumnya jalur --ids melewati guard ini
    sepenuhnya, sehingga bundel yang masih mengandung record excluded bisa
    terkirim ke SAP — over-post yang tidak bisa ditarik kembali.
    """
    return """
      NOT EXISTS (
        SELECT 1 FROM public.sap_staging_source ss
        JOIN public.sap_staging_exclusion ex
          ON ex.source_system = ss.source_system
         AND ex.plant         = ss.plant
         AND ex.source_row_id = ss.source_row_id
        WHERE ss.staging_id = public.sap_timesheet_staging.id
      )
    """


def eligibility_predicate(
    *,
    statuses: list[str] | None = None,
    source_system: str | None = None,
    plant: str | None = None,
    productive: bool | None = None,
    include_today: bool = False,
    date_filter: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    pernr_filter: str | None = None,
    exclude_correction: bool = True,
) -> tuple[str, list]:
    """Satu definisi "baris mana yang layak dikirim ke SAP" (review P1 #20).

    Dipakai BERSAMA oleh claim_rows (posting nyata) dan preview_rows (--dry-run).
    Sebelumnya keduanya menyusun daftar filter sendiri-sendiri, jadi dry-run bisa
    melaporkan jumlah dan nilai yang tidak sama dengan apa yang benar-benar
    terkirim — persis jenis jaminan palsu yang membuat dry-run tidak berguna.

    Mengembalikan (where_sql, params).
    """
    filters: list[str] = []
    params: list[Any] = []

    if statuses is not None:
        filters.append("status = ANY(%s)")
        params.append(statuses)

    if exclude_correction:
        # Auto-poster TIDAK PERNAH mengirim bundel koreksi (is_correction=true).
        # Koreksi = jam yang datang setelah harinya ter-post; harus di-review
        # admin & di-post MANUAL dari UI.
        filters.append("is_correction = false")

    # GERBANG HARI-SELESAI (default aktif). Bundel MCH_HOURS = total SATU HARI per
    # kunci; source_key tidak memuat durasi. Kalau hari BERJALAN di-post, bundel-nya
    # terkunci (POSTED) dan jam sisa hari itu HILANG.
    if not include_today:
        filters.append(
            "(source_system <> 'MCH_HOURS' OR bucket_start::date < (now() AT TIME ZONE %s)::date)"
        )
        params.append(app_timezone())

    # GERBANG CUTOFF: baris dengan tanggal sebelum cutoff plant tidak boleh dikirim
    cutoff = None
    try:
        cutoff = load_plant_cutoff(plant)
    except Exception:
        pass
    if cutoff:
        filters.append(
            "(bucket_start::date >= %s OR (source_system = 'TIMESHEET' AND payload->>'ISDD' >= %s))"
        )
        params.extend([cutoff, cutoff.strftime("%Y%m%d")])

    if source_system:
        filters.append("source_system = %s")
        params.append(source_system)
    if plant:
        filters.append("werks = %s")
        params.append(plant)
    if productive is not None:
        filters.append("is_productive = %s")
        params.append(productive)

    if date_filter:
        filters.append(
            "(bucket_start::date = %s OR (source_system = 'TIMESHEET' AND payload->>'ISDD' = %s))"
        )
        params.extend([date_filter, date_filter.replace("-", "")])
    if date_from or date_to:
        lo = date_from or "1900-01-01"
        hi = date_to or "2999-12-31"
        filters.append(
            "(bucket_start::date BETWEEN %s AND %s OR "
            "(source_system = 'TIMESHEET' AND payload->>'ISDD' BETWEEN %s AND %s))"
        )
        params.extend([lo, hi, lo.replace("-", ""), hi.replace("-", "")])
    if pernr_filter:
        filters.append("(pernr = %s OR pernr_origin = %s)")
        params.extend([pernr_filter, pernr_filter])

    # GUARD EXCLUSION: bundle yang masih mengandung record excluded TIDAK boleh
    # di-post — nilainya belum di-recalculate (bisa over-post). Satu definisi,
    # dipakai semua jalur (#20).
    filters.append(exclusion_guard_sql())

    return " AND ".join(filters), params


def claim_rows(
    limit: int,
    include_failed: bool,
    source_system: str | None,
    plant: str | None,
    productive: bool | None = None,
    failed_only: bool = False,
    include_today: bool = False,
    date_filter: str | None = None,
    pernr_filter: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[dict]:
    # failed_only: HANYA baris FAILED (untuk tombol "kirim ulang gagal" di UI — supaya
    # tidak ikut mem-blast ribuan PENDING). Menang atas include_failed.
    if failed_only:
        statuses = ["FAILED"]
    elif include_failed:
        statuses = ["PENDING", "FAILED"]
    else:
        statuses = ["PENDING"]

    # #20: predikat yang SAMA dengan preview_rows/--dry-run.
    where_sql, params = eligibility_predicate(
        statuses=statuses,
        source_system=source_system,
        plant=plant,
        productive=productive,
        include_today=include_today,
        date_filter=date_filter,
        date_from=date_from,
        date_to=date_to,
        pernr_filter=pernr_filter,
        exclude_correction=True,
    )

    sql = f"""
    SELECT id, source_system, source_ref_id, werks, status, pernr, pernr_origin, payload
    FROM sap_timesheet_staging
    WHERE {where_sql}
    ORDER BY id
    LIMIT %s
    FOR UPDATE SKIP LOCKED
    """
    params.append(limit)

    with connect_staging() as conn:
        ensure_staging_schema(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = apply_current_nfc_roles(cur, [dict(row) for row in cur.fetchall()])
            if rows:
                cur.execute(
                    """
                    UPDATE sap_timesheet_staging
                    SET status = 'POSTING',
                        updated_at = now()
                    WHERE id = ANY(%s::bigint[])
                    """,
                    ([row["id"] for row in rows],),
                )
        conn.commit()
    return rows


def parse_csv_values(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def claim_selected_rows(ids: list[str], ztimesheetids: list[str], allow_posted: bool, plant: str | None = None) -> list[dict]:
    filters = []
    params: list[Any] = []

    if ids:
        filters.append("id = ANY(%s::bigint[])")
        params.append([int(value) for value in ids])
    if ztimesheetids:
        filters.append("ztimesheetid = ANY(%s::text[])")
        params.append(ztimesheetids)
    if not filters:
        return []

    # Per-plant (2026-08-31): posting dari MPS satu plant hanya menyentuh werks-nya
    # sendiri (PLANT_SSB di .env) — id/ztimesheetid plant lain tidak akan ikut.
    plant_filter = ""
    if plant:
        plant_filter = "AND werks = %s"
        params.append(plant)

    status_filter = "" if allow_posted else "AND status <> 'POSTED'"
    where_sql = " OR ".join(f"({item})" for item in filters)
    sql = f"""
    SELECT id, source_system, source_ref_id, werks, status, pernr, pernr_origin, payload
    FROM sap_timesheet_staging
    WHERE ({where_sql})
      {status_filter}
      {plant_filter}
      -- #20: guard exclusion yang SAMA dengan claim_rows/preview_rows. Tanpa ini
      -- bundel berisi record excluded bisa terkirim lewat --ids (over-post).
      AND {exclusion_guard_sql()}
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    """

    with connect_staging() as conn:
        ensure_staging_schema(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = apply_current_nfc_roles(cur, [dict(row) for row in cur.fetchall()])
            if rows:
                cur.execute(
                    """
                    UPDATE sap_timesheet_staging
                    SET status = 'POSTING',
                        updated_at = now()
                    WHERE id = ANY(%s::bigint[])
                    """,
                    ([row["id"] for row in rows],),
                )
        conn.commit()
    return rows


def update_result(row_id: int, ok: bool, status_code: int, response_text: str, message: str) -> None:
    try:
        parsed_response = json.loads(response_text)
    except json.JSONDecodeError:
        parsed_response = None

    try:
        conn = _conn("staging")
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE sap_timesheet_staging
                SET status = %s,
                    sap_response = %s,
                    sap_response_text = %s,
                    sap_error = %s,
                    posted_at = CASE WHEN %s THEN now() ELSE posted_at END,
                    updated_at = now()
                WHERE id = %s
                """,
                (
                    "POSTED" if ok else "FAILED",
                    psycopg2.extras.Json(as_json(parsed_response)),
                    response_text,
                    None if ok else f"HTTP {status_code}: {message}",
                    ok,
                    row_id,
                ),
            )
        conn.commit()
    except Exception:
        # Koneksi kemungkinan rusak -> buang, lalu coba sekali lagi dgn koneksi baru.
        # Kalau ini pun gagal, biarkan meledak: status baris HARUS tercatat.
        _reset_conn("staging")
        conn = _conn("staging")
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE sap_timesheet_staging
                SET status = %s, sap_response = %s, sap_response_text = %s, sap_error = %s,
                    posted_at = CASE WHEN %s THEN now() ELSE posted_at END, updated_at = now()
                WHERE id = %s
                """,
                (
                    "POSTED" if ok else "FAILED",
                    psycopg2.extras.Json(as_json(parsed_response)),
                    response_text,
                    None if ok else f"HTTP {status_code}: {message}",
                    ok,
                    row_id,
                ),
            )
        conn.commit()


def log_timesheet_sap(payload: dict[str, Any], response_text: str) -> None:
    try:
        status, message = parse_sap_status(response_text)
        sap_response = f"{'SUCCESS' if status == 'S' else 'ERROR'} : {message}" if status else response_text
        conn = _conn("source")
        if True:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO log_timesheet_sap (
                      ztimesheetid, pernr, confirmation_number, order_no, operation_no,
                      sequence_category, sequence_number, branch_operation_no, return_operation_no,
                      zconf_type, work_center, activity_type,
                      start_date, start_time, end_date, end_time, plant_code, final_completed_indicator,
                      zbarcodeid, sap_response
                    ) VALUES (
                      %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                      %s,%s,%s,%s,%s,%s,%s,%s
                    )
                    """,
                    (
                        payload.get("ZTIMESHEETID", ""),
                        payload.get("PERNR", ""),
                        payload.get("RUECK", ""),
                        payload.get("AUFNR", ""),
                        payload.get("VORNR", ""),
                        payload.get("FLGAT", ""),
                        payload.get("PLNFL", ""),
                        payload.get("VORNR_B", ""),
                        payload.get("VORNR_R", ""),
                        payload.get("ZCONF_TYPE", ""),
                        payload.get("ARBPL", ""),
                        payload.get("LSTAR", ""),
                        payload.get("ISDD", ""),
                        payload.get("ISDZ", ""),
                        payload.get("IEDD", ""),
                        payload.get("IEDZ", ""),
                        payload.get("WERKS", ""),
                        payload.get("AUERU", ""),
                        payload.get("ZBARCODEID", ""),
                        sap_response,
                    ),
                )
            conn.commit()
    except Exception as exc:
        _reset_conn("source")
        log.warning("Could not write local log_timesheet_sap: %s", exc)


# GUARD ANTI-DOUBLE-POST (migration 20260714).
#
# ZTIMESHEETID = id::text baris staging, jadi dedup di sisi SAP TIDAK melindungi kita:
# begitu source_key berubah (resep md5 diubah, ATAU data sumber dikoreksi), lahir baris
# staging baru -> id baru -> ZTIMESHEETID baru -> SAP menganggapnya kiriman baru dan
# MENERIMANYA. Jam kerja masuk dua kali.
#
# Karena itu guard berjangkar pada identitas SUMBER: segmen (source_row_id, bucket_start).
# Segmen tidak ikut berubah walau resep/format/plant diubah.
#
# Dua hasil yang dibedakan (penting):
#   • source_key SAMA  -> re-run biasa. Aman, tapi tetap tidak dikirim ulang.
#   • source_key BEDA  -> KONFLIK: data sumber berubah setelah bundel lama ter-post.
#     Yang salah SUDAH ada di SAP dan sistem ini tidak punya storno. Jadi jangan kirim —
#     tandai SKIPPED dan biarkan manusia memutuskan (storno di SAP, lalu post koreksinya).
def find_posted_conflicts(row_ids: list[int]) -> dict[int, str]:
    if not row_ids:
        return {}
    sql = """
    SELECT
      s.staging_id,
      string_agg(DISTINCT prev.staging_id::text || ':' || prev.source_key, ', ') AS posted_in,
      bool_or(prev.source_key IS DISTINCT FROM cur.source_key) AS key_changed
    FROM sap_staging_source s
    JOIN sap_timesheet_staging cur ON cur.id = s.staging_id
    JOIN sap_staging_source prev
      ON  prev.source_system = s.source_system
      AND prev.plant         = s.plant
      AND prev.source_row_id = s.source_row_id
      AND prev.bucket_start  = s.bucket_start
      AND prev.posted_at IS NOT NULL
      AND prev.staging_id <> s.staging_id
    JOIN sap_timesheet_staging prev_t ON prev_t.id = prev.staging_id
    WHERE s.staging_id = ANY(%s::bigint[])
    GROUP BY s.staging_id
    """
    # prev.source_key tidak ada di tabel provenance -> ambil dari staging-nya.
    sql = sql.replace("prev.source_key", "prev_t.source_key")
    with connect_staging() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (row_ids,))
            return {
                int(staging_id): (
                    f"Source segment already POSTED in bundle {posted_in}"
                    + (" with a DIFFERENT source_key (source data changed — needs storno in SAP"
                       " before this correction is sent)" if key_changed else " (duplicate)")
                )
                for staging_id, posted_in, key_changed in cur.fetchall()
            }


# Sequence ID di-reset ke 1 (2026-07-14, keputusan owner), sementara SAP sudah pernah
# menerima ZTIMESHEETID di rentang 151.320-163.469 (225 kiriman, 68 sukses — kerja Juni
# 15/29/30 + 2 Juli yang sudah distorno). ztimesheetid = id::text, jadi suatu saat
# sequence akan menyentuh angka-angka itu lagi dan SAP menolaknya sebagai duplikat.
#
# Guard ini mengubah kegagalan misterius di masa depan menjadi SKIPPED yang menjelaskan
# dirinya sendiri. Juga melindungi kalau ada yang me-rebuild tanggal Juni (provenance
# baris-baris itu sudah tidak ada — log_timesheet_sap adalah satu-satunya ingatan).
def find_burned_ztimesheetids(ztimesheetids: list[str]) -> dict[str, str]:
    if not ztimesheetids:
        return {}
    with connect_source() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ztimesheetid, min(created_at)::date, min(start_date)
                FROM log_timesheet_sap
                WHERE ztimesheetid = ANY(%s)
                  AND sap_response LIKE 'SUCCESS%%'
                GROUP BY ztimesheetid
                """,
                (ztimesheetids,),
            )
            return {
                str(zid): (
                    f"ZTIMESHEETID {zid} was already accepted by SAP (sent {sent}, "
                    f"work date {work_date}). Sequence ID was reset to 1 on 2026-07-14, "
                    "so this number is reused. Storno in SAP first, or shift the sequence."
                )
                for zid, sent, work_date in cur.fetchall()
            }


def mark_skipped(row_id: int, reason: str) -> None:
    with connect_staging() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE sap_timesheet_staging
                SET status = 'SKIPPED', sap_error = %s, updated_at = now()
                WHERE id = %s
                """,
                (reason, row_id),
            )
        conn.commit()


def post_one(row: dict, args: argparse.Namespace) -> str:
    """Kirim SATU baris ke SAP. Dipanggil paralel oleh ThreadPoolExecutor.

    Retry hanya untuk kegagalan JARINGAN (mis. SSL UNEXPECTED_EOF — CPI memutus koneksi),
    BUKAN untuk penolakan SAP. Retry aman karena ID-nya sama: kalau ternyata SAP sudah
    menerima kiriman pertama, retry ditolak sebagai ZTIMESHEETID duplikat (terlihat),
    bukan dihitung dua kali.
    """
    row_id = row["id"]
    payload = dict(row.get("payload") or {})
    if not payload:
        update_result(row_id, False, 0, "empty payload", "empty payload")
        return "failed"

    # Guard: ZTIMESHEETID wajib ada di payload SAP.
    # Jika staging payload belum memuatnya, fallback ke id baris staging (ztimesheetid).
    zid = str(payload.get("ZTIMESHEETID") or row_id)
    payload["ZTIMESHEETID"] = zid
    row["payload"] = payload

    last_error = None
    last_message = None
    for attempt in range(1, args.max_retries + 1):
        try:
            status_code, response_text = post_payload(payload, args.timeout)
        except Exception as exc:  # jaringan/TLS — transient
            last_error = str(exc)
            if attempt < args.max_retries:
                backoff = args.retry_backoff * attempt
                log.warning("Jaringan gagal id=%s (percobaan %s/%s), ulang dalam %.1fs: %s",
                            row_id, attempt, args.max_retries, backoff, exc)
                time.sleep(backoff)
                continue
            update_result(row_id, False, 0, last_error, last_error)
            log.warning("SAP ERROR id=%s ztimesheetid=%s error=%s", row_id, zid, last_error)
            return "failed"

        sap_status, sap_message = parse_sap_status(response_text)
        ok = sap_status == "S"

        # "Order X is already being processed by SAPCI" = kunci SEMENTARA di SAP, bukan
        # penolakan bisnis. Terjadi bila order yang sama sedang dikonfirmasi proses lain.
        # Pengelompokan per-order sudah mencegah kita menabrak diri sendiri, tapi proses
        # LAIN (atau sisa kunci) masih bisa memicunya -> tunggu, coba lagi.
        if not ok and "already being processed" in sap_message.lower() and attempt < args.max_retries:
            backoff = args.retry_backoff * attempt
            log.warning("Order terkunci id=%s (percobaan %s/%s), ulang dalam %.1fs: %s",
                        row_id, attempt, args.max_retries, backoff, sap_message)
            last_message = sap_message
            time.sleep(backoff)
            continue

        update_result(row_id, ok, status_code, response_text, sap_message)
        log_timesheet_sap(payload, response_text)

        # Throttle per worker — naikkan kalau CPI mulai memutus koneksi (rate-limit).
        if args.delay_ms > 0:
            time.sleep(args.delay_ms / 1000)

        if ok:
            log.info("SAP OK id=%s ztimesheetid=%s", row_id, zid)
            return "success"

        log.warning("SAP FAILED id=%s ztimesheetid=%s message=%s", row_id, zid, sap_message)
        return "failed"

    msg = last_message or last_error or "gagal setelah retry"
    update_result(row_id, False, 0, msg, msg)
    return "failed"


def post_order_group(rows: list[dict], args: argparse.Namespace) -> list[str]:
    """Kirim semua baris untuk SATU order — SERIAL.

    SAP CPI MENGUNCI sebuah order selama memproses konfirmasinya: dua kiriman untuk
    order yang sama secara bersamaan -> yang kedua ditolak
    ("Order X is already being processed by SAPCI"). Terbukti live: paralel acak 5 worker
    membuat 6 dari 10 baris gagal, 4 di antaranya menabrak order yang sama.
    Jadi paralelismenya ADA DI ANTAR-ORDER, bukan di dalam satu order.
    """
    return [post_one(row, args) for row in rows]


def preview_rows(args: argparse.Namespace) -> None:
    """--dry-run: SELECT saja. Tidak claim, tidak UPDATE, tidak HTTP ke SAP.

    Jalur ini sengaja TIDAK memanggil claim_rows/claim_selected_rows karena
    keduanya menulis status='POSTING' sebelum mengembalikan baris. Tetapi
    filternya WAJIB sama: keduanya memanggil eligibility_predicate() (#20).
    Menyalin daftar filter ke sini pernah membuat dry-run melaporkan himpunan
    baris yang berbeda dari yang benar-benar terkirim — jaminan palsu.
    """
    validate_date_range(args.date_from, args.date_to)
    plant = None if args.all_plants else (args.plant or plant_code())

    selected_ids = parse_csv_values(args.ids)
    selected_zt = parse_csv_values(args.ztimesheetids)

    filters: list[str] = []
    params: list[Any] = []

    if selected_ids or selected_zt:
        # Jalur pilih-manual: cocokkan claim_selected_rows, yang juga tidak
        # memfilter is_correction (koreksi memang di-post manual dari UI).
        ors = []
        if selected_ids:
            ors.append("id = ANY(%s::bigint[])")
            params.append([int(v) for v in selected_ids])
        if selected_zt:
            ors.append("ztimesheetid = ANY(%s::text[])")
            params.append(selected_zt)
        filters.append("(" + " OR ".join(ors) + ")")
        if not args.allow_posted:
            filters.append("status <> 'POSTED'")
        if args.source_system:
            filters.append("source_system = %s")
            params.append(args.source_system)
        if plant:
            filters.append("werks = %s")
            params.append(plant)
        # #20: jalur dry-run --ids memakai guard exclusion yang sama dengan
        # claim_selected_rows. Selected-id tidak berarti boleh bypass safety.
        filters.append(exclusion_guard_sql())
        where_sql = " AND ".join(filters)
    else:
        if args.failed_only:
            statuses = ["FAILED"]
        elif args.retry_failed:
            statuses = ["PENDING", "FAILED"]
        else:
            statuses = ["PENDING"]

        productive = None
        if args.productive_only:
            productive = True
        elif args.unproductive_only:
            productive = False

        # #20: predikat yang SAMA dengan claim_rows (posting sebenarnya),
        # termasuk guard exclusion dan gerbang hari-selesai.
        where_sql, params = eligibility_predicate(
            statuses=statuses,
            source_system=args.source_system,
            plant=plant,
            productive=productive,
            include_today=args.include_today,
            date_filter=args.date,
            date_from=args.date_from,
            date_to=args.date_to,
            pernr_filter=args.pernr,
            exclude_correction=True,
        )

    selected_mode = bool(selected_ids or selected_zt)
    limit_sql = "" if selected_mode else "LIMIT %s"
    if not selected_mode:
        params.append(args.limit)
    sql = f"""
    SELECT id, ztimesheetid, source_system, source_ref_id, werks, status,
           pernr, payload->>'ISDD' AS isdd, total_seconds
    FROM sap_timesheet_staging
    WHERE {where_sql}
    ORDER BY id
    {limit_sql}
    """

    with connect_staging() as conn:
        # Read-only di level transaksi: setiap UPDATE yang tidak sengaja akan gagal,
        # bukan diam-diam lolos.
        conn.set_session(readonly=True)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = [dict(r) for r in cur.fetchall()]

    log.info("DRY-RUN: tidak ada claim, UPDATE, atau HTTP ke SAP")
    log.info("plant=%s source_system=%s rentang=%s..%s",
             plant or "(semua)", args.source_system or "(semua)",
             args.date_from or "-", args.date_to or "-")
    if not rows:
        log.info("DRY-RUN: 0 baris cocok")
        return

    total_seconds = sum(int(r["total_seconds"] or 0) for r in rows)
    by_status: dict[str, int] = {}
    for r in rows:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1

    log.info("DRY-RUN: %s baris, total %s detik (%.2f jam)",
             len(rows), total_seconds, total_seconds / 3600)
    log.info("DRY-RUN: status %s", by_status)
    isdds = sorted({r["isdd"] for r in rows if r["isdd"]})
    if isdds:
        log.info("DRY-RUN: ISDD %s .. %s", isdds[0], isdds[-1])
    ids = [str(r["id"]) for r in rows]
    log.info("DRY-RUN: id %s%s", ",".join(ids[:20]),
             f" ... (+{len(ids) - 20})" if len(ids) > 20 else "")
    if len(rows) == args.limit:
        log.warning("DRY-RUN: jumlah baris TEPAT sama dengan --limit (%s). "
                    "Masih ada sisa; perkecil rentang atau naikkan limit.", args.limit)


def process_rows(args: argparse.Namespace) -> None:
    validate_date_range(args.date_from, args.date_to)
    selected_ids = parse_csv_values(args.ids)
    selected_ztimesheetids = parse_csv_values(args.ztimesheetids)
    if selected_ids or selected_ztimesheetids:
        plant = None if args.all_plants else (args.plant or plant_code())
        rows = claim_selected_rows(selected_ids, selected_ztimesheetids, args.allow_posted, plant)
    else:
        plant = None if args.all_plants else (args.plant or plant_code())
        productive = None
        if args.productive_only:
            productive = True
        elif args.unproductive_only:
            productive = False
        rows = claim_rows(args.limit, args.retry_failed, args.source_system, plant, productive,
                          args.failed_only, args.include_today, args.date, args.pernr,
                          args.date_from, args.date_to)
    if not rows:
        log.info("No staging rows to post")
        return

    conflicts = find_posted_conflicts([row["id"] for row in rows])
    if conflicts:
        log.warning("Guard: %s bundel dilewati karena segmennya sudah ter-POST", len(conflicts))

    burned = find_burned_ztimesheetids([str(row["id"]) for row in rows])
    if burned:
        log.warning("Guard: %s bundel dilewati — ZTIMESHEETID-nya sudah dipakai di SAP", len(burned))
    for row in rows:
        reason = burned.get(str(row["id"]))
        if reason and row["id"] not in conflicts:
            conflicts[row["id"]] = reason

    success_count = 0
    fail_count = 0
    skipped_count = 0

    # Baris konflik ditangani serial dulu (jumlahnya kecil, tidak menyentuh SAP).
    postable = []
    for row in rows:
        conflict = conflicts.get(row["id"])
        if conflict:
            mark_skipped(row["id"], conflict)
            skipped_count += 1
            log.warning("SKIPPED id=%s — %s", row["id"], conflict)
        else:
            postable.append(row)

    # Kelompokkan per ORDER (AUFNR). Baris tanpa order (unproductive: AUFNR kosong) tidak
    # mengunci order apa pun -> tiap baris jadi grup sendiri, boleh paralel penuh.
    groups: dict[tuple[str, str], list[dict]] = {}
    for row in postable:
        aufnr = (row["payload"] or {}).get("AUFNR") or ""
        key = (row.get("werks") or "", aufnr if aufnr else f"__free_{row['id']}")
        groups.setdefault(key, []).append(row)

    started = time.perf_counter()
    results: list[str] = []
    if args.workers > 1 and len(groups) > 1:
        log.info("Mengirim %s baris / %s order dengan %s worker (paralel antar-order, serial di dalam order)",
                 len(postable), len(groups), args.workers)
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(post_order_group, grp, args) for grp in groups.values()]
            for fut in as_completed(futures):
                results.extend(fut.result())
    else:
        for grp in groups.values():
            results.extend(post_order_group(grp, args))
    _close_thread_conns()

    for outcome in results:
        if outcome == "success":
            success_count += 1
        else:
            fail_count += 1

    elapsed = time.perf_counter() - started
    if postable:
        log.info("Selesai dalam %.1f dtk (%.1f dtk/baris)", elapsed, elapsed / len(postable))

    log.info(
        "SAP posting done success=%s failed=%s skipped=%s",
        success_count, fail_count, skipped_count,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Post SAP payloads from sap_timesheet_staging")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--delay-ms", type=int, default=100)
    parser.add_argument("--retry-failed", action="store_true", help="Also retry rows with status FAILED")
    parser.add_argument("--failed-only", action="store_true", help="HANYA baris FAILED (dipakai tombol 'kirim ulang gagal' di UI — tidak menyentuh PENDING)")
    parser.add_argument("--include-today", action="store_true", help="Ikutkan bundel MCH_HOURS hari BERJALAN (default: hanya hari selesai). Hati-hati: mengunci hari yang masih tumbuh.")
    parser.add_argument("--source-system", choices=["TIMESHEET", "MCH_HOURS"], help="Only post one source system")
    parser.add_argument(
        "--workers", type=int, default=1,
        help="Jumlah kiriman paralel ke SAP (default 1 = serial). SAP ~7 dtk/kiriman, "
             "jadi paralel adalah satu-satunya cara mempercepat batch besar. Mulai dari 4-5; "
             "kalau error jaringan/TLS mulai sering, TURUNKAN (tanda rate-limit CPI).",
    )
    parser.add_argument(
        "--max-retries", type=int, default=3,
        help="Percobaan ulang untuk kegagalan JARINGAN saja (bukan penolakan SAP). "
             "Aman: ID sama -> SAP menolak duplikat, tidak dobel.",
    )
    parser.add_argument("--retry-backoff", type=float, default=2.0, help="Detik jeda dasar antar retry (naik linear)")
    productive_group = parser.add_mutually_exclusive_group()
    productive_group.add_argument(
        "--productive-only", action="store_true",
        help="Hanya kirim baris PRODUKTIF (zconf_type M1/M2 — konfirmasi order). "
             "Pakai ini untuk posting massal selagi baris unproductive masih ditolak SAP.",
    )
    productive_group.add_argument(
        "--unproductive-only", action="store_true",
        help="Hanya kirim baris UNPRODUCTIVE (LSTAR). Jalankan setelah fix cost center di SAP.",
    )
    parser.add_argument("--plant", choices=ALLOWED_PLANTS,
                        help="Only post one plant. Defaults to PLANT_SSB")
    parser.add_argument("--all-plants", action="store_true", help="Ignore plant filter")
    parser.add_argument("--ids", help="Comma-separated staging id list to post for manual testing")
    parser.add_argument("--ztimesheetids", help="Comma-separated ZTIMESHEETID list to post for manual testing")
    parser.add_argument("--allow-posted", action="store_true", help="Allow selected --ids/--ztimesheetids even if already POSTED")
    parser.add_argument("--date", help="Posting manual per tanggal bucket (YYYY-MM-DD) via UI")
    parser.add_argument("--date-from", help="Awal rentang tanggal (YYYY-MM-DD), inklusif")
    parser.add_argument("--date-to", help="Akhir rentang tanggal (YYYY-MM-DD), inklusif")
    parser.add_argument("--pernr", help="Posting manual per operator (PERNR) via UI")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Tampilkan baris yang AKAN dikirim tanpa efek samping: tidak claim "
             "(tidak ada status='POSTING'), tidak UPDATE, tidak ada HTTP ke SAP. "
             "Sesi DB dibuka read-only sebagai guard terakhir.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if args.dry_run:
        preview_rows(args)
        return
    process_rows(args)


if __name__ == "__main__":
    main()
