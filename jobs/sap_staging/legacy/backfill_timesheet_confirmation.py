"""backfill_timesheet_confirmation.py

Isi `timesheet_transaction.confirmationnumber` = confirmation number PH3 + suffix
jenis kerja (RG / OV / RW), termasuk MEMECAH satu record menjadi dua bila interval
check-in -> checkout melewati batas shift operator.

── ATURAN BISNIS (disetujui owner) ───────────────────────────────────────────
Base confirmation diambil dari `ph3_order` lewat pasangan (order_no, operation_no).
Pencocokan menormalkan spasi + leading zero DI KEDUA SISI, dan TIDAK mengecast ke
integer — order alfanumerik seperti `P26-35101` harus tetap cocok.

Suffix:
  RW  order_no diawali '32' (rework). Prioritas TERTINGGI, tidak pernah di-split.
  RG  seluruh interval berada di dalam shift efektif operator (reguler).
  OV  seluruh interval di luar shift, ATAU roster OFF/LEAVE/SICK/PERMIT/SITE_VISIT.
  SPLIT interval memotong batas shift -> record dipecah jadi 2 segmen bersambung:
      segmen pertama memakai tsnumber ASLI (dirujuk processcontroldata — FK tidak
      boleh putus), segmen kedua row baru dari identity sequence.

Tetap NULL (dilaporkan sebagai exception, TIDAK ditebak):
  - PH3 tidak match / ambigu (satu operasi punya >1 confirmation number)
  - operator tanpa roster efektif pada tanggal itu
  - record masih open (belum checkout)
  - durasi anomali > MAX_ANOMALY_HOURS
  - record non-produktif (activitytype terisi) — tidak punya pasangan order/operasi

── KENAPA AMAN ───────────────────────────────────────────────────────────────
1. Dry-run adalah DEFAULT. Menulis hanya dengan --apply.
2. Backup JSON seluruh baris target ditulis SEBELUM BEGIN.
3. Satu transaksi: precondition re-check (FOR UPDATE) -> tulis -> verifikasi
   invariant -> COMMIT. Invariant gagal = ROLLBACK, nol perubahan.
4. Baris yang sudah masuk SAP dilindungi berlapis:
   - status staging POSTED / FAILED / POSTING / SKIPPED  -> TIDAK disentuh
   - punya baris `sap_staging_exclusion`                  -> TIDAK disentuh
   Hanya UNSTAGED dan PENDING yang boleh di-split (PENDING boleh di-rebuild).
5. Idempotent: hanya menyentuh `confirmationnumber IS NULL`, jadi aman dijalankan
   berulang untuk transaksi baru (mis. harian) tanpa membuat clone ganda.
6. Clone MEWARISI `sap_staging_exclusion` milik induknya, supaya segmen kedua tidak
   ikut terkirim ulang untuk jam yang sudah dikonfirmasi lewat jalur lama.

── ALUR PAKAI ────────────────────────────────────────────────────────────────
    python backfill_timesheet_confirmation.py                      # dry-run
    python backfill_timesheet_confirmation.py --report-dir ./out   # dry-run + CSV exception
    python backfill_timesheet_confirmation.py --apply              # tulis (butuh konfirmasi)
    python backfill_timesheet_confirmation.py --apply --limit 50   # uji sebagian dulu

Contoh lain:
    python backfill_timesheet_confirmation.py --from 2026-09-01 --through-today
    python backfill_timesheet_confirmation.py --from 2026-09-01 --through 2026-09-17
    python backfill_timesheet_confirmation.py --apply --yes        # non-interaktif

`--to` tetap tersedia sebagai batas atas EKSKLUSIF. `--through` bersifat inklusif.
Script berhenti sebelum membuat rencana bila TIMEZONE berbeda dari timezone plant_config.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg2.extras

from sap_staging_common import (
    app_timezone,
    connect_source,
    env_value,
    plant_code,
    quote_table_name,
    setup_logging,
)

log = setup_logging("backfill_timesheet_confirmation")

# Roster status yang dianggap "operator tidak sedang dalam shift" -> seluruh interval OV.
OFF_SHIFT_STATUSES = ("OFF", "LEAVE", "SICK", "PERMIT", "SITE_VISIT")

# Durasi di atas ini dianggap anomali entry (lupa checkout lalu ditutup manual).
# Tidak diklasifikasikan — dibiarkan NULL agar diperiksa manusia.
MAX_ANOMALY_HOURS = 24

# Status staging yang membekukan record: jam sudah/ sedang dikirim ke SAP.
FROZEN_STAGING_STATUSES = ("POSTED", "POSTING", "FAILED", "SKIPPED")

SUFFIX_RE = r"^[0-9]+(RG|OV|RW)$"

INTEGRITY_EXCEPTIONS = (
    "NULL_CLOCK",
    "NULL_INTERVAL",
    "NULL_OVERLAP",
    "NULL_MULTI_BOUNDARY",
    "NULL_COMPLEX_ROSTER",
)


def resolve_date_range(
    from_value: str | None,
    to_value: str | None,
    through_value: str | None,
    through_today: bool,
    today: date,
) -> tuple[str | None, str | None]:
    """Resolve CLI dates to an inclusive lower and exclusive upper bound."""

    selected_upper = sum(bool(value) for value in (to_value, through_value, through_today))
    if selected_upper > 1:
        raise ValueError("Pilih hanya satu dari --to, --through, atau --through-today")

    def parse(raw: str | None, flag: str) -> date | None:
        if raw is None:
            return None
        try:
            return date.fromisoformat(raw)
        except ValueError as exc:
            raise ValueError(f"{flag} harus berformat YYYY-MM-DD") from exc

    start = parse(from_value, "--from")
    if to_value:
        upper = parse(to_value, "--to")
    elif through_value:
        upper = parse(through_value, "--through") + timedelta(days=1)
    elif through_today:
        upper = today + timedelta(days=1)
    else:
        upper = None

    if start and upper and start >= upper:
        raise ValueError("Rentang tanggal kosong/terbalik: batas akhir harus setelah --from")
    return start.isoformat() if start else None, upper.isoformat() if upper else None


def validate_runtime_context(
    configured_timezone: str,
    expected_plant: str,
    plant_row: dict | None,
) -> str:
    """Fail closed when environment and database identify different plants or clocks."""

    if not plant_row:
        raise RuntimeError("plant_config id=1 tidak ditemukan")
    database_plant = str(plant_row.get("plant_code") or "").strip()
    database_timezone = str(plant_row.get("timezone") or "").strip()
    if database_plant != str(expected_plant).strip():
        raise RuntimeError(
            f"PLANT_SSB={expected_plant} berbeda dari plant_config.plant_code={database_plant}"
        )
    if not database_timezone:
        raise RuntimeError("plant_config.timezone kosong")
    if configured_timezone != database_timezone:
        raise RuntimeError(
            "TIMEZONE mismatch: "
            f"runtime={configured_timezone}, plant_config={database_timezone}. "
            "Perbaiki konfigurasi; jangan melanjutkan backfill dengan zona berbeda."
        )
    try:
        ZoneInfo(database_timezone)
    except Exception as exc:
        raise RuntimeError(f"Timezone plant tidak valid: {database_timezone}") from exc
    return database_timezone


def assert_runtime_context(cur, configured_timezone: str, expected_plant: str) -> str:
    cur.execute(
        "SELECT plant_code, timezone FROM public.plant_config WHERE id = 1 LIMIT 1"
    )
    row = cur.fetchone()
    return validate_runtime_context(configured_timezone, expected_plant, dict(row) if row else None)


def confirmation_source_table() -> str:
    """Tabel sumber confirmation number.

    Default `ph3_order` dan TIDAK ikut TGT_TABLE. Alasannya historis: pernah
    ditemukan TGT_TABLE menunjuk `qh3_order` yang KOSONG (0 baris) sementara data
    ada di `ph3_order` (±15 rb baris) — akibatnya SELURUH record jatuh ke NULL_PH3
    tanpa satu pun error (gagal diam-diam). TGT_TABLE sudah diperbaiki owner
    2026-09-18, tapi sumber backfill sengaja dipisah supaya salah-konfigurasi env
    tidak lagi bisa menyunyikan seluruh klasifikasi.
    Override lewat CONFIRMATION_SOURCE_TABLE bila memang perlu.
    """
    return env_value("CONFIRMATION_SOURCE_TABLE", "ph3_order")


def assert_source_usable(cur, table_sql: str) -> int:
    """Fail closed: sumber kosong = berhenti, jangan laporkan 'semua NULL_PH3'."""
    cur.execute(f"SELECT COUNT(*)::int AS n FROM {table_sql}")
    total = cur.fetchone()["n"]
    if total == 0:
        raise RuntimeError(
            f"Tabel sumber confirmation {table_sql} KOSONG. "
            "Periksa CONFIRMATION_SOURCE_TABLE / TGT_TABLE sebelum lanjut."
        )
    return total


def build_plan_sql(ph3_table: str) -> str:
    """CTE klasifikasi. SELURUH aritmatika waktu dikerjakan Postgres.

    Perhitungan boundary TIDAK boleh pindah ke Python: mencampur konversi zona waktu
    Python dengan timestamptz Postgres pernah menghasilkan 361 baris checkout < checkin
    pada percobaan sebelumnya. Postgres memegang satu sumber kebenaran zona waktu.
    """
    return f"""
    WITH ph3_normalized AS (
      SELECT
        CASE
          WHEN NULLIF(BTRIM(order_no), '') IS NULL THEN NULL
          WHEN BTRIM(order_no) ~ '^[0-9]+$'
            THEN COALESCE(NULLIF(LTRIM(BTRIM(order_no), '0'), ''), '0')
          ELSE BTRIM(order_no)
        END AS order_key,
        CASE
          WHEN NULLIF(BTRIM(operation_no), '') IS NULL THEN NULL
          WHEN BTRIM(operation_no) ~ '^[0-9]+$'
            THEN COALESCE(NULLIF(LTRIM(BTRIM(operation_no), '0'), ''), '0')
          ELSE BTRIM(operation_no)
        END AS operation_key,
        NULLIF(BTRIM(confirmation_number), '') AS confirmation_number
      FROM {ph3_table}
      WHERE NULLIF(BTRIM(confirmation_number), '') IS NOT NULL
    ),
    ph3 AS MATERIALIZED (
      SELECT
        order_key,
        operation_key,
        MIN(confirmation_number)                 AS confirmation_base,
        COUNT(DISTINCT confirmation_number)::int AS confirmation_count
      FROM ph3_normalized
      WHERE order_key IS NOT NULL
        AND operation_key IS NOT NULL
      GROUP BY 1, 2
    ),
    base AS (
      SELECT
        t.tsnumber, t.order_no, t.operation_no, t.serialnumber, t.plant,
        t.activitytype, t.date_checkin, t.hour_checkin, t.date_checkout, t.hour_checkout,
        t.longdate_checkin, t.longdate_checkout,
        (t.longdate_checkin  AT TIME ZONE %(tz)s) AS ci_local,
        (t.longdate_checkout AT TIME ZONE %(tz)s) AS co_local,
        p.confirmation_base, p.confirmation_count,
        (
          t.date_checkin IS NOT DISTINCT FROM
            to_char(t.longdate_checkin AT TIME ZONE %(tz)s, 'DD/MM/YYYY')
          AND t.hour_checkin IS NOT DISTINCT FROM
            to_char(t.longdate_checkin AT TIME ZONE %(tz)s, 'HH24:MI')
          AND (
            t.longdate_checkout IS NULL
            OR (
              t.date_checkout IS NOT DISTINCT FROM
                to_char(t.longdate_checkout AT TIME ZONE %(tz)s, 'DD/MM/YYYY')
              AND t.hour_checkout IS NOT DISTINCT FROM
                to_char(t.longdate_checkout AT TIME ZONE %(tz)s, 'HH24:MI')
            )
          )
        ) AS clock_consistent,
        EXISTS (
          SELECT 1
          FROM public.timesheet_transaction other
          WHERE other.tsnumber <> t.tsnumber
            AND other.serialnumber = t.serialnumber
            AND other.longdate_checkin IS NOT NULL
            AND other.longdate_checkout IS NOT NULL
            AND t.longdate_checkout IS NOT NULL
            AND other.longdate_checkin < t.longdate_checkout
            AND t.longdate_checkin < other.longdate_checkout
        ) AS has_operator_overlap
      FROM public.timesheet_transaction t
      LEFT JOIN ph3 p
        ON p.order_key = CASE
             WHEN NULLIF(BTRIM(t.order_no), '') IS NULL THEN NULL
             WHEN BTRIM(t.order_no) ~ '^[0-9]+$'
               THEN COALESCE(NULLIF(LTRIM(BTRIM(t.order_no), '0'), ''), '0')
             ELSE BTRIM(t.order_no)
           END
       AND p.operation_key = CASE
             WHEN t.operation_no IS NULL THEN NULL
             ELSE COALESCE(NULLIF(LTRIM(t.operation_no::text, '0'), ''), '0')
           END
      WHERE t.activitytype IS NULL
        AND NULLIF(BTRIM(t.confirmationnumber), '') IS NULL
        AND COALESCE(t.plant::text, '') = %(plant)s
        AND (%(from_ts)s::timestamp IS NULL OR
             t.longdate_checkin >= (%(from_ts)s::timestamp AT TIME ZONE %(tz)s))
        AND (%(to_ts)s::timestamp IS NULL OR
             t.longdate_checkin < (%(to_ts)s::timestamp AT TIME ZONE %(tz)s))
    ),
    -- Roster efektif: pilih window yang benar-benar menaungi check-in. business_date-1
    -- ikut dipertimbangkan karena shift malam menyeberang tengah malam.
    candidate AS (
      SELECT
        b.*,
        re.business_date, re.status AS roster_status, re.eff_shift,
        (re.business_date + re.start_time) AS shift_start,
        (re.business_date + re.end_time
          + CASE WHEN re.crosses_midnight THEN interval '1 day' ELSE interval '0' END) AS shift_end,
        COUNT(*) FILTER (
          WHERE re.business_date IS NOT NULL
            AND b.ci_local < (re.business_date + re.end_time
                  + CASE WHEN re.crosses_midnight THEN interval '1 day' ELSE interval '0' END)
            AND b.co_local > (re.business_date + re.start_time)
        ) OVER (PARTITION BY b.tsnumber) AS intersecting_roster_windows,
        ROW_NUMBER() OVER (
          PARTITION BY b.tsnumber
          ORDER BY
            CASE WHEN b.ci_local >= (re.business_date + re.start_time)
                  AND b.ci_local <  (re.business_date + re.end_time
                        + CASE WHEN re.crosses_midnight THEN interval '1 day' ELSE interval '0' END)
                 THEN 0 ELSE 1 END,
            ABS(EXTRACT(EPOCH FROM (b.ci_local - (re.business_date + re.start_time))))
        ) AS rn
      FROM base b
      LEFT JOIN ews.roster_effective re
        ON re.serialnumber = b.serialnumber
       AND re.business_date BETWEEN (b.ci_local::date - 1)
                                AND COALESCE(b.co_local::date, b.ci_local::date)
    ),
    picked AS (SELECT * FROM candidate WHERE rn = 1),
    classified AS (
      SELECT
        p.*,
        CASE
          WHEN p.confirmation_count IS DISTINCT FROM 1        THEN 'NULL_PH3'
          WHEN p.longdate_checkout IS NULL                    THEN 'NULL_OPEN'
          WHEN p.co_local <= p.ci_local                        THEN 'NULL_INTERVAL'
          WHEN p.co_local - p.ci_local > interval '{MAX_ANOMALY_HOURS} hours'
                                                              THEN 'NULL_ANOMALY'
          WHEN NOT p.clock_consistent                          THEN 'NULL_CLOCK'
          WHEN p.has_operator_overlap                          THEN 'NULL_OVERLAP'
          WHEN p.business_date IS NULL                        THEN 'NULL_ROSTER'
          WHEN p.intersecting_roster_windows > 1              THEN 'NULL_COMPLEX_ROSTER'
          WHEN COALESCE(NULLIF(LTRIM(BTRIM(p.order_no), '0'), ''), '0') LIKE '32%%'
                                                              THEN 'RW'
          WHEN p.roster_status = ANY(%(off_shift)s)           THEN 'OV'
          WHEN p.ci_local < p.shift_start
           AND p.co_local > p.shift_end                       THEN 'NULL_MULTI_BOUNDARY'
          WHEN p.ci_local >= p.shift_start
           AND p.co_local <= p.shift_end                      THEN 'RG'
          WHEN p.co_local <= p.shift_start
            OR p.ci_local >= p.shift_end                      THEN 'OV'
          ELSE 'SPLIT'
        END AS class
      FROM picked p
    ),
    -- Batas potong + suffix segmen dihitung di SQL juga, sekali, agar Python tidak
    -- pernah menyentuh aritmatika timestamp.
    final AS (
      SELECT
        c.*,
        CASE WHEN c.class = 'SPLIT' THEN
          CASE WHEN c.ci_local < c.shift_start
               THEN (c.shift_start AT TIME ZONE %(tz)s)
               ELSE (c.shift_end   AT TIME ZONE %(tz)s)
          END
        END AS boundary_ts,
        CASE WHEN c.class = 'SPLIT' THEN
          CASE WHEN c.ci_local < c.shift_start THEN 'OV' ELSE 'RG' END
        END AS first_suffix,
        CASE WHEN c.class = 'SPLIT' THEN
          CASE WHEN c.ci_local < c.shift_start THEN 'RG' ELSE 'OV' END
        END AS second_suffix
      FROM classified c
    )
    SELECT
      f.tsnumber, f.order_no, f.operation_no, f.serialnumber, f.plant,
      f.activitytype, f.date_checkin, f.hour_checkin, f.date_checkout, f.hour_checkout,
      f.longdate_checkin, f.longdate_checkout,
      f.confirmation_base, f.confirmation_count,
      f.business_date, f.roster_status, f.eff_shift,
      f.shift_start, f.shift_end,
      f.clock_consistent, f.has_operator_overlap, f.intersecting_roster_windows,
      f.class, f.boundary_ts, f.first_suffix, f.second_suffix
    FROM final f
    ORDER BY f.tsnumber
    """


def load_exposures(cur, target_ids: list[int], plant: str) -> dict[int, dict]:
    """Load staging/exclusion state once per remote table, not once per source row."""

    result = {
        tsnumber: {"exposure": "UNSTAGED", "staging_statuses": []}
        for tsnumber in target_ids
    }
    if not target_ids:
        return result

    source_ids = [str(tsnumber) for tsnumber in target_ids]
    cur.execute(
        """
        SELECT source_row_id
        FROM public.sap_staging_exclusion
        WHERE source_system = 'TIMESHEET'
          AND plant = %s
          AND source_row_id = ANY(%s::text[])
        """,
        (plant, source_ids),
    )
    excluded = {int(row["source_row_id"]) for row in cur.fetchall()}

    cur.execute(
        """
        SELECT source_row_id, staging_id
        FROM public.sap_staging_source
        WHERE source_system = 'TIMESHEET'
          AND plant = %s
          AND source_row_id = ANY(%s::text[])
        """,
        (plant, source_ids),
    )
    sources = cur.fetchall()
    staging_ids = sorted({int(row["staging_id"]) for row in sources})
    statuses_by_staging: dict[int, str] = {}
    if staging_ids:
        cur.execute(
            """
            SELECT id, status
            FROM public.sap_timesheet_staging
            WHERE werks = %s
              AND id = ANY(%s::bigint[])
            """,
            (plant, staging_ids),
        )
        statuses_by_staging = {
            int(row["id"]): row["status"] for row in cur.fetchall()
        }

    statuses_by_source: dict[int, set[str]] = {}
    for row in sources:
        status = statuses_by_staging.get(int(row["staging_id"]))
        if status:
            statuses_by_source.setdefault(int(row["source_row_id"]), set()).add(status)

    for tsnumber in target_ids:
        statuses = sorted(statuses_by_source.get(tsnumber, set()))
        if tsnumber in excluded:
            exposure = "EXCLUDED"
        elif any(status in FROZEN_STAGING_STATUSES for status in statuses):
            exposure = "FROZEN"
        elif "PENDING" in statuses:
            exposure = "PENDING"
        elif statuses:
            exposure = "OTHER"
        else:
            exposure = "UNSTAGED"
        result[tsnumber] = {"exposure": exposure, "staging_statuses": statuses}
    return result


def clone_columns(cur) -> list[str]:
    """Kolom yang disalin ke segmen kedua.

    Diambil dari katalog, bukan daftar hardcode: kolom baru yang ditambahkan nanti
    ikut tersalin sendiri, sehingga clone tidak diam-diam kehilangan data.
    tsnumber dilewati (identity) — segmen kedua HARUS dapat nomor baru.
    """
    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'timesheet_transaction'
          AND is_identity = 'NO'
          AND is_generated = 'NEVER'
        ORDER BY ordinal_position
        """
    )
    return [r["column_name"] if hasattr(r, "keys") else r[0] for r in cur.fetchall()]


def build_clone_sql(columns: list[str]) -> str:
    """INSERT ... SELECT dari baris induk, dengan kolom waktu/suffix di-override."""
    overrides = {
        "confirmationnumber": "%(confirmation)s",
        "longdate_checkin": "%(seg_start)s",
        "longdate_checkout": "%(seg_end)s",
        "date_checkin": "to_char(%(seg_start)s::timestamptz AT TIME ZONE %(tz)s, 'DD/MM/YYYY')",
        "date_checkout": "to_char(%(seg_end)s::timestamptz   AT TIME ZONE %(tz)s, 'DD/MM/YYYY')",
        "hour_checkin": "to_char(%(seg_start)s::timestamptz AT TIME ZONE %(tz)s, 'HH24:MI')",
        "hour_checkout": "to_char(%(seg_end)s::timestamptz   AT TIME ZONE %(tz)s, 'HH24:MI')",
        "duration": (
            "ROUND((EXTRACT(EPOCH FROM (%(seg_end)s::timestamptz - %(seg_start)s::timestamptz))"
            " / 3600)::numeric, 2)"
        ),
        "modified_at": "now()",
    }
    select_list = ", ".join(overrides.get(col, f"t.{col}") for col in columns)
    col_list = ", ".join(columns)
    return (
        f"INSERT INTO public.timesheet_transaction ({col_list})\n"
        f"SELECT {select_list}\n"
        f"FROM public.timesheet_transaction t\n"
        f"WHERE t.tsnumber = %(tsnumber)s\n"
        f"RETURNING tsnumber"
    )


UPDATE_SIMPLE_SQL = """
UPDATE public.timesheet_transaction t
   SET confirmationnumber = v.confirmation,
       modified_at = now()
  FROM (SELECT * FROM jsonb_to_recordset(%(payload)s::jsonb)
        AS x(tsnumber int, confirmation text)) v
 WHERE t.tsnumber = v.tsnumber
   AND NULLIF(BTRIM(t.confirmationnumber), '') IS NULL
"""

UPDATE_FIRST_SEGMENT_SQL = """
UPDATE public.timesheet_transaction
   SET longdate_checkout = %(boundary)s,
       date_checkout = to_char(%(boundary)s::timestamptz AT TIME ZONE %(tz)s, 'DD/MM/YYYY'),
       hour_checkout = to_char(%(boundary)s::timestamptz AT TIME ZONE %(tz)s, 'HH24:MI'),
       duration = ROUND((EXTRACT(EPOCH FROM (%(boundary)s::timestamptz - longdate_checkin))
                        / 3600)::numeric, 2),
       confirmationnumber = %(confirmation)s,
       modified_at = now()
 WHERE tsnumber = %(tsnumber)s
   AND NULLIF(BTRIM(confirmationnumber), '') IS NULL
RETURNING tsnumber
"""

# Clone mewarisi exclusion induk: jam yang sudah dikonfirmasi ke SAP lewat jalur lama
# tidak boleh terkirim lagi hanya karena sekarang dipecah dua.
INHERIT_EXCLUSION_SQL = """
INSERT INTO public.sap_staging_exclusion
  (source_system, plant, source_row_id, excluded_by, excluded_at, note)
SELECT ex.source_system, ex.plant, %(clone)s::text, ex.excluded_by, now(),
       COALESCE(ex.note, '') || ' | split dari tsnumber ' || %(original)s
  FROM public.sap_staging_exclusion ex
 WHERE ex.source_system = 'TIMESHEET'
   AND ex.plant = %(plant)s
   AND ex.source_row_id = %(original)s::text
ON CONFLICT DO NOTHING
"""


def classify_rows(rows: list[dict]) -> dict:
    buckets: dict[str, list[dict]] = {}
    for row in rows:
        buckets.setdefault(row["class"], []).append(row)
    return buckets


def actionable(rows: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    """Bagi rencana jadi: update sederhana, split, dan yang ditahan (skipped)."""
    simple, splits, held = [], [], []
    for row in rows:
        cls = row["class"]
        if cls in ("RG", "OV", "RW"):
            # PENDING juga ditahan: script ini tidak membangun ulang payload staging.
            if row["exposure"] == "UNSTAGED":
                simple.append(row)
            else:
                held.append(row)
        elif cls == "SPLIT":
            if row["exposure"] == "UNSTAGED":
                splits.append(row)
            else:
                held.append(row)
        else:
            held.append(row)
    return simple, splits, held


def write_reports(report_dir: Path, rows: list[dict], held: list[dict]) -> list[Path]:
    report_dir.mkdir(parents=True, exist_ok=True)
    written = []

    def dump(name: str, subset: list[dict]) -> None:
        if not subset:
            return
        path = report_dir / name
        fields = list(subset[0].keys())
        with path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=fields)
            writer.writeheader()
            for row in subset:
                writer.writerow({k: row.get(k) for k in fields})
        written.append(path)

    dump("exception-ph3.csv", [r for r in rows if r["class"] == "NULL_PH3"])
    dump("exception-roster.csv", [r for r in rows if r["class"] == "NULL_ROSTER"])
    dump("exception-open.csv", [r for r in rows if r["class"] == "NULL_OPEN"])
    dump("exception-anomaly.csv", [r for r in rows if r["class"] == "NULL_ANOMALY"])
    dump("exception-integrity.csv", [r for r in rows if r["class"] in INTEGRITY_EXCEPTIONS])
    dump("held-frozen.csv", [r for r in held if r["exposure"] in ("FROZEN", "EXCLUDED", "OTHER")])
    return written


def write_plan_manifest(
    report_dir: Path,
    timezone: str,
    plant: str,
    from_ts: str | None,
    to_ts: str | None,
    summary: dict,
    simple: list[dict],
    splits: list[dict],
    held: list[dict],
) -> Path:
    """Persist a compact, non-mutating plan that can be reviewed before apply."""

    def identity(row: dict) -> dict:
        return {
            "tsnumber": row["tsnumber"],
            "class": row["class"],
            "exposure": row["exposure"],
            "confirmation_base": row.get("confirmation_base"),
            "longdate_checkin": row.get("longdate_checkin"),
            "longdate_checkout": row.get("longdate_checkout"),
        }

    payload = {
        "created_at": datetime.now(ZoneInfo(timezone)).isoformat(),
        "plant": plant,
        "timezone": timezone,
        "from_inclusive": from_ts,
        "to_exclusive": to_ts,
        "summary": summary,
        "simple": [identity(row) for row in simple],
        "splits": [
            {
                **identity(row),
                "boundary": row.get("boundary_ts"),
                "first_suffix": row.get("first_suffix"),
                "second_suffix": row.get("second_suffix"),
            }
            for row in splits
        ],
        "held": [identity(row) for row in held],
    }
    report_dir.mkdir(parents=True, exist_ok=True)
    path = report_dir / "plan.json"
    path.write_text(json.dumps(payload, default=str, indent=2), encoding="utf-8")
    return path


def summarize(rows: list[dict], simple: list[dict], splits: list[dict], held: list[dict]) -> dict:
    by_class: dict[str, int] = {}
    for row in rows:
        by_class[row["class"]] = by_class.get(row["class"], 0) + 1
    by_exposure: dict[str, int] = {}
    for row in held:
        key = f"{row['class']}/{row['exposure']}"
        by_exposure[key] = by_exposure.get(key, 0) + 1
    return {
        "kandidat": len(rows),
        "per_kelas": by_class,
        "akan_diupdate": len(simple),
        "akan_displit": len(splits),
        "ditahan": len(held),
        "ditahan_rincian": by_exposure,
    }


def run_apply(conn, simple: list[dict], splits: list[dict], tz: str, plant: str) -> dict:
    target_ids = [r["tsnumber"] for r in simple] + [r["tsnumber"] for r in splits]
    created: list[dict] = []

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SET LOCAL lock_timeout = '10s'")
        cur.execute("SET LOCAL statement_timeout = '600s'")
        assert_runtime_context(cur, tz, plant)

        # Precondition: kunci baris, pastikan belum berubah sejak rencana dibuat.
        cur.execute(
            """
            SELECT tsnumber, activitytype, order_no, operation_no, serialnumber, plant,
                   date_checkin, hour_checkin, date_checkout, hour_checkout,
                   confirmationnumber, longdate_checkin, longdate_checkout
              FROM public.timesheet_transaction
             WHERE tsnumber = ANY(%s::int[])
             ORDER BY tsnumber
               FOR UPDATE
            """,
            (target_ids,),
        )
        locked = {r["tsnumber"]: r for r in cur.fetchall()}
        if len(locked) != len(target_ids):
            raise RuntimeError(
                f"precondition: terkunci {len(locked)} baris, diharapkan {len(target_ids)}"
            )
        for row in simple + splits:
            live = locked[row["tsnumber"]]
            if str(live["confirmationnumber"] or "").strip():
                raise RuntimeError(f"tsnumber {row['tsnumber']} sudah terisi sejak dry-run")
            snapshot_fields = (
                "activitytype", "order_no", "operation_no", "serialnumber", "plant",
                "date_checkin", "hour_checkin", "date_checkout", "hour_checkout",
                "longdate_checkin", "longdate_checkout",
            )
            changed = [field for field in snapshot_fields if live[field] != row[field]]
            if changed:
                raise RuntimeError(
                    f"tsnumber {row['tsnumber']} berubah sejak dry-run: {', '.join(changed)}"
                )

        live_exposure = load_exposures(cur, target_ids, plant)
        for row in simple + splits:
            current_exposure = live_exposure[row["tsnumber"]]["exposure"]
            if current_exposure != row["exposure"]:
                raise RuntimeError(
                    f"tsnumber {row['tsnumber']} exposure berubah sejak dry-run: "
                    f"{row['exposure']} -> {current_exposure}"
                )

        if simple:
            payload = json.dumps([
                {"tsnumber": r["tsnumber"], "confirmation": f"{r['confirmation_base']}{r['class']}"}
                for r in simple
            ])
            cur.execute(UPDATE_SIMPLE_SQL, {"payload": payload})
            if cur.rowcount != len(simple):
                raise RuntimeError(f"update sederhana menyentuh {cur.rowcount}, diharapkan {len(simple)}")

        if splits:
            columns = clone_columns(cur)
            clone_sql = build_clone_sql(columns)
            for row in splits:
                cur.execute(UPDATE_FIRST_SEGMENT_SQL, {
                    "tsnumber": row["tsnumber"],
                    "boundary": row["boundary_ts"],
                    "confirmation": f"{row['confirmation_base']}{row['first_suffix']}",
                    "tz": tz,
                })
                if cur.rowcount != 1:
                    raise RuntimeError(f"segmen pertama gagal untuk tsnumber {row['tsnumber']}")

                cur.execute(clone_sql, {
                    "tsnumber": row["tsnumber"],
                    "confirmation": f"{row['confirmation_base']}{row['second_suffix']}",
                    "seg_start": row["boundary_ts"],
                    "seg_end": row["longdate_checkout"],
                    "tz": tz,
                })
                clone_id = cur.fetchone()["tsnumber"]

                cur.execute(INHERIT_EXCLUSION_SQL, {
                    "clone": clone_id,
                    "original": row["tsnumber"],
                    "plant": plant,
                })
                created.append({
                    "original": row["tsnumber"],
                    "clone": clone_id,
                    "first_suffix": row["first_suffix"],
                    "second_suffix": row["second_suffix"],
                    "exclusion_inherited": cur.rowcount,
                })

        # ── Invariant sebelum COMMIT ─────────────────────────────────────────
        all_ids = target_ids + [c["clone"] for c in created]
        cur.execute(
            f"""
            SELECT
              COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE confirmationnumber !~ '{SUFFIX_RE}')::int AS bad_format,
              COUNT(*) FILTER (WHERE longdate_checkout IS NOT NULL
                                 AND longdate_checkout <= longdate_checkin)::int AS bad_interval,
              COUNT(*) FILTER (
                WHERE date_checkin IS DISTINCT FROM
                        to_char(longdate_checkin AT TIME ZONE %(tz)s, 'DD/MM/YYYY')
                   OR hour_checkin IS DISTINCT FROM
                        to_char(longdate_checkin AT TIME ZONE %(tz)s, 'HH24:MI')
                   OR date_checkout IS DISTINCT FROM
                        to_char(longdate_checkout AT TIME ZONE %(tz)s, 'DD/MM/YYYY')
                   OR hour_checkout IS DISTINCT FROM
                        to_char(longdate_checkout AT TIME ZONE %(tz)s, 'HH24:MI')
              )::int AS bad_clock
              FROM public.timesheet_transaction
             WHERE tsnumber = ANY(%(all_ids)s::int[])
            """,
            {"tz": tz, "all_ids": all_ids},
        )
        check = cur.fetchone()
        if check["n"] != len(all_ids):
            raise RuntimeError(f"verifikasi: {check['n']} baris, diharapkan {len(all_ids)}")
        if check["bad_format"]:
            raise RuntimeError(f"verifikasi: {check['bad_format']} confirmation number salah format")
        if check["bad_interval"]:
            raise RuntimeError(f"verifikasi: {check['bad_interval']} interval tidak positif")
        if check["bad_clock"]:
            raise RuntimeError(
                f"verifikasi: {check['bad_clock']} baris waktu turunannya tidak konsisten"
            )

        if created:
            # Segmen harus BERSAMBUNG dan total detik terjaga.
            cur.execute(
                """
                WITH pair AS (
                  SELECT * FROM jsonb_to_recordset(%s::jsonb)
                    AS x(original int, clone int, source_start timestamptz, source_end timestamptz)
                )
                SELECT
                  COUNT(*)::int AS n,
                  COUNT(*) FILTER (WHERE o.longdate_checkout <> c.longdate_checkin)::int AS gap,
                  COUNT(*) FILTER (WHERE RIGHT(o.confirmationnumber, 2)
                                       = RIGHT(c.confirmationnumber, 2))::int AS same_suffix,
                  COUNT(*) FILTER (WHERE LEFT(o.confirmationnumber, LENGTH(o.confirmationnumber) - 2)
                                      <> LEFT(c.confirmationnumber, LENGTH(c.confirmationnumber) - 2)
                                  )::int AS base_mismatch,
                  COUNT(*) FILTER (
                    WHERE EXTRACT(EPOCH FROM (
                      (o.longdate_checkout - o.longdate_checkin)
                      + (c.longdate_checkout - c.longdate_checkin)
                    )) <> EXTRACT(EPOCH FROM (p.source_end - p.source_start))
                  )::int AS duration_mismatch
                  FROM pair p
                  JOIN public.timesheet_transaction o ON o.tsnumber = p.original
                  JOIN public.timesheet_transaction c ON c.tsnumber = p.clone
                """,
                (
                    json.dumps([
                        {
                            "original": c["original"],
                            "clone": c["clone"],
                            "source_start": next(
                                row["longdate_checkin"]
                                for row in splits if row["tsnumber"] == c["original"]
                            ),
                            "source_end": next(
                                row["longdate_checkout"]
                                for row in splits if row["tsnumber"] == c["original"]
                            ),
                        }
                        for c in created
                    ], default=str),
                ),
            )
            pair = cur.fetchone()
            if pair["n"] != len(created):
                raise RuntimeError(f"verifikasi split: {pair['n']} pasang, diharapkan {len(created)}")
            if pair["gap"]:
                raise RuntimeError(f"verifikasi split: {pair['gap']} pasang tidak bersambung")
            if pair["same_suffix"]:
                raise RuntimeError(f"verifikasi split: {pair['same_suffix']} pasang bersuffix sama")
            if pair["base_mismatch"]:
                raise RuntimeError(f"verifikasi split: {pair['base_mismatch']} pasang beda base")
            if pair["duration_mismatch"]:
                raise RuntimeError(
                    f"verifikasi split: {pair['duration_mismatch']} pasang tidak menjaga total detik"
                )

        cur.execute(
            """
            SELECT COUNT(*)::int AS overlap_count
            FROM public.timesheet_transaction changed
            JOIN public.timesheet_transaction other
              ON other.serialnumber = changed.serialnumber
             AND other.tsnumber <> changed.tsnumber
             AND other.longdate_checkin < changed.longdate_checkout
             AND changed.longdate_checkin < other.longdate_checkout
            WHERE changed.tsnumber = ANY(%s::int[])
              AND changed.longdate_checkout IS NOT NULL
              AND other.longdate_checkout IS NOT NULL
            """,
            (all_ids,),
        )
        overlap_count = cur.fetchone()["overlap_count"]
        if overlap_count:
            raise RuntimeError(
                f"verifikasi timeline: {overlap_count} overlap operator ditemukan"
            )

    return {"updated": len(simple), "split": len(splits), "created": created}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill confirmation number timesheet dengan dry-run default, "
            "guard timezone, dan validasi timeline."
        ),
        epilog=(
            "Contoh:\n"
            "  python backfill_timesheet_confirmation.py --from 2026-09-18 --through-today\n"
            "  python backfill_timesheet_confirmation.py --from 2026-09-18 "
            "--through-today --apply"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--apply", action="store_true", help="Tulis perubahan. Tanpa ini = dry-run.")
    parser.add_argument("--yes", action="store_true", help="Lewati konfirmasi interaktif saat --apply.")
    parser.add_argument("--from", dest="from_ts", help="Batas bawah check-in (YYYY-MM-DD), inklusif.")
    upper = parser.add_mutually_exclusive_group()
    upper.add_argument("--to", dest="to_ts", help="Batas atas check-in, eksklusif.")
    upper.add_argument("--through", dest="through_ts", help="Tanggal akhir, inklusif.")
    upper.add_argument(
        "--through-today",
        action="store_true",
        help="Sampai hari ini dalam timezone plant, inklusif.",
    )
    parser.add_argument("--limit", type=int, help="Batasi jumlah record yang dikerjakan (uji bertahap).")
    parser.add_argument(
        "--limit-splits",
        type=int,
        help="Kerjakan hanya N split pertama; cocok untuk canary split.",
    )
    parser.add_argument("--report-dir", help="Folder CSV exception + backup JSON. Default: ./reports/<stamp>")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    tz = app_timezone()
    plant = plant_code()
    if not plant:
        log.error("PLANT_SSB kosong di .env — tidak bisa menentukan plant. Berhenti.")
        sys.exit(1)

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    report_dir = Path(args.report_dir) if args.report_dir else (
        Path(__file__).resolve().parent / "reports" / f"confirmation-{stamp}"
    )

    conn = connect_source()
    try:
        source_table = quote_table_name(confirmation_source_table())
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            tz = assert_runtime_context(cur, tz, plant)
            from_ts, to_ts = resolve_date_range(
                args.from_ts,
                args.to_ts,
                args.through_ts,
                args.through_today,
                datetime.now(ZoneInfo(tz)).date(),
            )
            source_rows = assert_source_usable(cur, source_table)
            log.info("Sumber confirmation: %s (%s baris)", source_table, source_rows)
            cur.execute(build_plan_sql(source_table), {
                "tz": tz,
                "plant": plant,
                "off_shift": list(OFF_SHIFT_STATUSES),
                "from_ts": from_ts,
                "to_ts": to_ts,
            })
            rows = [dict(r) for r in cur.fetchall()]
            exposures = load_exposures(cur, [row["tsnumber"] for row in rows], plant)
            for row in rows:
                row.update(exposures[row["tsnumber"]])

        simple, splits, held = actionable(rows)
        if args.limit is not None and args.limit <= 0:
            raise ValueError("--limit harus lebih besar dari nol")
        if args.limit_splits is not None and args.limit_splits <= 0:
            raise ValueError("--limit-splits harus lebih besar dari nol")
        if args.limit is not None and args.limit_splits is not None:
            raise ValueError("Pilih hanya satu dari --limit atau --limit-splits")
        if args.limit:
            simple = simple[: args.limit]
            splits = splits[: max(0, args.limit - len(simple))]
        elif args.limit_splits:
            simple = []
            splits = splits[: args.limit_splits]

        summary = summarize(rows, simple, splits, held)
        log.info("Plant %s | timezone %s", plant, tz)
        log.info("Rentang check-in: [%s, %s)", from_ts or "-inf", to_ts or "+inf")
        log.info("Ringkasan rencana: %s", json.dumps(summary, ensure_ascii=False))

        written = write_reports(report_dir, rows, held)
        for path in written:
            log.info("Laporan: %s", path)

        plan_path = write_plan_manifest(
            report_dir, tz, plant, from_ts, to_ts, summary, simple, splits, held
        )
        log.info("Manifest rencana: %s", plan_path)

        if not simple and not splits:
            log.info("Tidak ada yang perlu dikerjakan. Selesai.")
            return

        # Backup SELALU ditulis sebelum menyentuh apa pun.
        target_ids = [r["tsnumber"] for r in simple] + [r["tsnumber"] for r in splits]
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM public.timesheet_transaction WHERE tsnumber = ANY(%s::int[]) ORDER BY tsnumber",
                (target_ids,),
            )
            backup_rows = [dict(r) for r in cur.fetchall()]
        report_dir.mkdir(parents=True, exist_ok=True)
        backup_path = report_dir / "backup-before-apply.json"
        backup_path.write_text(
            json.dumps({"created_at": datetime.now().isoformat(), "plant": plant,
                        "rows": backup_rows}, default=str, indent=2),
            encoding="utf-8",
        )
        log.info("Backup: %s (%s baris)", backup_path, len(backup_rows))

        if not args.apply:
            log.info("DRY RUN — tidak ada yang ditulis. Jalankan ulang dengan --apply untuk menerapkan.")
            return

        if not args.yes:
            answer = input(f"Terapkan ke {len(target_ids)} record produksi plant {plant}? ketik 'APPLY': ")
            if answer.strip() != "APPLY":
                log.info("Dibatalkan oleh operator. Tidak ada perubahan.")
                return

        result = run_apply(conn, simple, splits, tz, plant)
        conn.commit()

        result_path = report_dir / "applied.json"
        result_path.write_text(
            json.dumps({"applied_at": datetime.now().isoformat(), **result}, default=str, indent=2),
            encoding="utf-8",
        )
        log.info("COMMIT — %s record diupdate, %s dipecah, %s segmen baru dibuat.",
                 result["updated"], result["split"], len(result["created"]))
        log.info("Hasil: %s", result_path)
    except Exception:
        conn.rollback()
        log.exception("GAGAL — transaksi di-rollback, tidak ada perubahan yang tersimpan.")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
