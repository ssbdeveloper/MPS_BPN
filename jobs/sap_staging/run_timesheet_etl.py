#!/usr/bin/env python3
"""CLI ETL timesheet berlapis — F1: capture + run manifest.

Plan: docs/planning/2026-09-23-timesheet-etl-berlapis.md (§7 CLI target, §9 F1)

Kontrak rilis F1:

    --dry-run  hanya SELECT dan kalkulasi in-memory; TIDAK menulis apa pun.
    --execute  hanya membuat satu run manifest dan snapshot input immutable.
               TIDAK melakukan cleansing, allocation, publish, atau HTTP.

Keduanya saling eksklusif. Tidak ada cursor, tidak ada FDW central, dan
`timesheet_transaction` tidak pernah diubah.

KESELAMATAN KONEKSI
-------------------
Modul ini TIDAK memakai `sap_staging_common`, karena modul itu membaca `.env`
root yang menunjuk production Cikupa. Koneksi di sini dibangun sendiri, default
loopback, dan ditolak keras bila `inet_server_addr()` bukan loopback.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg2
import psycopg2.extras

from timesheet_normalization import break_overlap_seconds, cap_minutes_for

# Workcenter identity contract, identical in SQL (unique index 20261001c), the API (JS)
# and this ETL: strip only these code points at both ends; keep casing and inner spaces.
# U+0020 U+0009 U+000D U+000A U+000B U+000C U+00A0 U+FEFF. None -> "".
WORKCENTER_STRIP_CHARS = "\u0020\u0009\u000d\u000a\u000b\u000c\u00a0\ufeff"


def normalize_workcenter_code(value) -> str:
    return str(value or "").strip(WORKCENTER_STRIP_CHARS)


# Versi aturan. Ikut masuk unique key input / cleaned segment.
ALLOCATION_VERSION = "ALLOC-V1"
CLEAN_RULE_VERSION = "CLEAN-V2"
READY_RULE_VERSION = "READY-V1"

# Plant -> database klon lab. Timezone TIDAK diambil dari sini: sumbernya
# plant_config di database itu sendiri, supaya tidak ada dua sumber kebenaran.
PLANT_DATABASES = {
    "5100": "mps_timesheet_ckp_test",   # Cikupa, Asia/Jakarta
    "5051": "mps_timesheet_bpn_test",   # Balikpapan, Asia/Makassar
}

PIPELINE_TABLES = (
    "timesheet_etl_run",
    "timesheet_etl_input",
    "timesheet_etl_run_input",
    "timesheet_cleaned_segment",
    "timesheet_allocated_segment",
    "timesheet_sap_ready",
    "timesheet_etl_run_sap_ready",
)

# Field payroll yang masuk source hash. SENGAJA hanya field kanonik:
# date_checkin/hour_checkin/date_checkout/hour_checkout adalah proyeksi turunan
# dari longdate_* (dijaga trigger timesheet_sync_derived_time). Memasukkannya ke
# hash akan membuat hash berubah karena drift proyeksi, bukan karena data payroll —
# dan menghasilkan versi input palsu.
HASH_FIELDS = (
    "serialnumber",
    "activitytype",
    "order_no",
    "operation_no",
    "workcentercode",
    "confirmationnumber",
    "state_flag",
    "longdate_checkin",
    "longdate_checkout",
)


class EtlError(RuntimeError):
    """Kesalahan kontrak yang harus menghentikan run, bukan diteruskan."""


def scalar(row) -> str:
    """Ambil nilai tunggal dari row, apa pun bentuk cursor-nya (tuple/RealDict).

    Fungsi ini ada karena modul memakai RealDictCursor: `row[0]` gagal dengan
    KeyError, bukan TypeError, sehingga kesalahan ini mudah lolos review.
    """
    if row is None:
        return ""
    if isinstance(row, dict):
        return str(next(iter(row.values())))
    return str(row[0])


# ---------------------------------------------------------------------------
# Koneksi (lab: loopback-only; prod: TLS terverifikasi via env vars)
# ---------------------------------------------------------------------------

def _sanitize_conn_error(exc: Exception, password: str | None = None) -> str:
    """Hapus password dan kredensial sensitif dari pesan error koneksi."""
    msg = str(exc)
    if password:
        msg = msg.replace(password, "******")
    msg = re.sub(r"pass\w*=\S+", "pass=******", msg, flags=re.IGNORECASE)
    return msg


def _etl_conn_params(dbname: str) -> dict:
    host = os.environ.get("MPS2_ETL_HOST", "localhost")
    port = int(os.environ.get("MPS2_ETL_PORT", "5432"))
    user = os.environ.get("MPS2_ETL_USER", "postgres")
    if host not in ("localhost", "127.0.0.1", "::1"):
        raise EtlError(
            f"MPS2_ETL_HOST={host!r} bukan loopback. ETL mode lab hanya boleh berjalan di loopback lokal."
        )
    return {"host": host, "port": port, "dbname": dbname, "user": user}


def _prod_plant_conn_params(plant: str, dbname: str) -> dict:
    """Ambil parameter koneksi produksi plant dari environment variables secara aman."""
    prefix_plant = f"MPS2_PROD_PLANT_{plant}_"
    prefix_gen = "MPS2_PROD_PLANT_"

    def get_val(key: str, default: str | None = None) -> str | None:
        return os.environ.get(f"{prefix_plant}{key}") or os.environ.get(f"{prefix_gen}{key}") or default

    host = get_val("HOST") or os.environ.get("DB_HOST")
    if not host:
        raise EtlError(
            f"MPS2_PROD_PLANT_{plant}_HOST atau MPS2_PROD_PLANT_HOST belum dikonfigurasi untuk mode prod."
        )

    port_str = get_val("PORT") or os.environ.get("DB_PORT", "5432")
    try:
        port = int(port_str)
    except ValueError:
        raise EtlError(f"Port database plant prod tidak valid: {port_str!r}")

    user = get_val("USER") or os.environ.get("DB_USER")
    if not user:
        raise EtlError(
            f"MPS2_PROD_PLANT_{plant}_USER atau MPS2_PROD_PLANT_USER belum dikonfigurasi untuk mode prod."
        )

    password = get_val("PASSWORD") or os.environ.get("DB_PASSWORD")
    if not password:
        raise EtlError(
            f"MPS2_PROD_PLANT_{plant}_PASSWORD atau MPS2_PROD_PLANT_PASSWORD belum dikonfigurasi untuk mode prod."
        )

    is_docker_internal = host in ("db", "pgbouncer", "timesheet-db", "localhost", "127.0.0.1", "::1")
    default_ssl = "disable" if (is_docker_internal and not get_val("HOST")) else "verify-full"
    sslmode = get_val("SSLMODE", default_ssl)
    allow_insecure = (get_val("ALLOW_INSECURE_TRANSPORT") or "").lower() in ("true", "1", "yes") or (is_docker_internal and not get_val("HOST"))
    if sslmode in ("disable", "allow", "prefer") and not allow_insecure:
        raise EtlError(
            f"sslmode={sslmode!r} ditolak pada mode prod. Produksi wajib menggunakan TLS (mis. verify-full, verify-ca, require) "
            "atau set MPS2_PROD_PLANT_ALLOW_INSECURE_TRANSPORT=true untuk jaringan private/VPN terisolasi."
        )

    params = {
        "host": host,
        "port": port,
        "dbname": dbname,
        "user": user,
        "password": password,
        "sslmode": sslmode,
    }

    sslrootcert = get_val("SSLROOTCERT")
    if sslrootcert:
        if not os.path.exists(sslrootcert):
            raise EtlError(f"sslrootcert file tidak ditemukan di path: {sslrootcert!r}")
        params["sslrootcert"] = sslrootcert
    elif sslmode in ("verify-full", "verify-ca"):
        raise EtlError(
            f"sslmode={sslmode!r} pada mode prod memerlukan sertifikat root CA (MPS2_PROD_PLANT_SSLROOTCERT)."
        )

    return params


def _prod_central_conn_params(dbname: str | None = None) -> dict:
    """Ambil parameter koneksi produksi central dari environment variables secara aman.

    Mendukung koneksi langsung maupun koneksi via secure tunnel (mis. localhost:15432)
    dengan tetap memverifikasi sertifikat TLS RDS melalui kombinasi `host` (RDS CN/SAN)
    dan `hostaddr` (mis. 127.0.0.1).
    """
    prefix = "MPS2_PROD_CENTRAL_"

    def get_val(key: str, default: str | None = None) -> str | None:
        return os.environ.get(f"{prefix}{key}") or default

    host = get_val("HOST")
    if not host:
        raise EtlError(
            "Koneksi direct/tunnel central staging produksi (AWS RDS) belum dikonfigurasi (MPS2_PROD_CENTRAL_HOST kosong). "
            "Sediakan MPS2_PROD_CENTRAL_HOST, MPS2_PROD_CENTRAL_PORT, MPS2_PROD_CENTRAL_DBNAME, dan kredensialnya. "
            "Untuk secure tunnel (mis. localhost:15432), set MPS2_PROD_CENTRAL_HOST=<endpoint RDS> dan MPS2_PROD_CENTRAL_HOSTADDR=127.0.0.1."
        )

    db = dbname or get_val("DBNAME")
    if not db:
        raise EtlError("MPS2_PROD_CENTRAL_DBNAME belum dikonfigurasi untuk mode prod.")

    port_str = get_val("PORT", "5432")
    try:
        port = int(port_str)
    except ValueError:
        raise EtlError(f"Port database central prod tidak valid: {port_str!r}")

    hostaddr = get_val("HOSTADDR")

    # Guard: jangan pernah menghubungkan central prod ke port 5432 lokal (lab DB)
    is_loopback_target = (host in ("localhost", "127.0.0.1", "::1")) or (hostaddr in ("127.0.0.1", "::1"))
    if is_loopback_target and port == 5432:
        raise EtlError(
            "Koneksi central prod menunjuk port 5432 pada loopback (port lab lokal). "
            "Untuk tunnel AWS RDS, gunakan port tunnel terisolasi (mis. 15432) dan jangan arahkan ke database lab."
        )

    user = get_val("USER")
    if not user:
        raise EtlError("MPS2_PROD_CENTRAL_USER belum dikonfigurasi untuk mode prod.")

    password = get_val("PASSWORD")
    if not password:
        raise EtlError("MPS2_PROD_CENTRAL_PASSWORD belum dikonfigurasi untuk mode prod.")

    sslmode = get_val("SSLMODE", "verify-full")
    if sslmode in ("disable", "allow", "prefer"):
        raise EtlError(
            f"sslmode={sslmode!r} ditolak pada central prod. Wajib TLS (verify-full, verify-ca, require)."
        )

    params = {
        "host": host,
        "port": port,
        "dbname": db,
        "user": user,
        "password": password,
        "sslmode": sslmode,
    }

    if hostaddr:
        params["hostaddr"] = hostaddr

    sslrootcert = get_val("SSLROOTCERT")
    if sslrootcert:
        if not os.path.exists(sslrootcert):
            raise EtlError(f"sslrootcert central tidak ditemukan di path: {sslrootcert!r}")
        params["sslrootcert"] = sslrootcert
    elif sslmode in ("verify-full", "verify-ca"):
        raise EtlError(
            f"sslmode={sslmode!r} pada central prod memerlukan sertifikat root CA (MPS2_PROD_CENTRAL_SSLROOTCERT)."
        )

    return params


def connect_plant(
    dbname: str,
    autocommit: bool = False,
    *,
    env: str = "lab",
    plant: str | None = None,
):
    """Buka koneksi database plant (lab: loopback-only; prod: TLS terverifikasi & env vars)."""
    if env == "prod":
        if not plant:
            raise EtlError("Kode plant wajib diberikan saat membuka koneksi plant mode prod.")
        conn_params = _prod_plant_conn_params(plant, dbname)
        pwd = conn_params.get("password")
        try:
            conn = psycopg2.connect(**conn_params)
        except Exception as exc:
            sanitized = _sanitize_conn_error(exc, pwd)
            raise EtlError(f"Gagal koneksi ke plant database prod ({dbname}): {sanitized}") from None

        conn.rollback()
        conn.autocommit = autocommit
        return conn

    # Mode lab
    conn_params = _etl_conn_params(dbname)
    try:
        conn = psycopg2.connect(**conn_params)
    except Exception as exc:
        raise EtlError(f"Gagal koneksi ke plant lab ({dbname}): {exc}") from None

    with conn.cursor() as cur:
        cur.execute("SELECT inet_server_addr()")
        addr = cur.fetchone()[0]
    if addr is not None and str(addr).strip() not in ("127.0.0.1", "::1"):
        conn.close()
        raise EtlError(f"Koneksi lab {dbname} bukan loopback ({addr}); menolak menulis.")
    conn.rollback()
    conn.autocommit = autocommit
    return conn


DEFAULT_CENTRAL_DB = "mps_sap_staging_test"


def connect_central(
    dbname: str | None = None,
    autocommit: bool = False,
    *,
    env: str = "lab",
    plant_conn=None,
):
    """Buka koneksi central staging (lab: loopback-only; prod: direct TLS atau plant dblink adapter)."""
    if env == "prod":
        transport = (os.environ.get("MPS2_PROD_CENTRAL_TRANSPORT") or "").strip().lower()
        if (transport == "plant_dblink" or not os.environ.get("MPS2_PROD_CENTRAL_HOST")) and plant_conn:
            from central_dblink_adapter import CentralDblinkConnection
            return CentralDblinkConnection(plant_conn, server_name="aws_staging")

        conn_params = _prod_central_conn_params(dbname)
        pwd = conn_params.get("password")
        try:
            conn = psycopg2.connect(**conn_params)
        except Exception as exc:
            sanitized = _sanitize_conn_error(exc, pwd)
            raise EtlError(f"Gagal koneksi ke central staging prod ({conn_params.get('dbname')}): {sanitized}") from None

        conn.rollback()
        conn.autocommit = autocommit
        return conn

    # Mode lab
    db = dbname or os.environ.get("MPS2_ETL_CENTRAL_DB", DEFAULT_CENTRAL_DB)
    conn_params = _etl_conn_params(db)
    try:
        conn = psycopg2.connect(**conn_params)
    except Exception as exc:
        raise EtlError(f"Gagal koneksi ke central lab ({db}): {exc}") from None

    with conn.cursor() as cur:
        cur.execute("SELECT inet_server_addr()")
        addr = cur.fetchone()[0]
    if addr is not None and str(addr).strip() not in ("127.0.0.1", "::1"):
        conn.close()
        raise EtlError(f"Koneksi central lab {db} bukan loopback ({addr}); menolak menulis.")
    conn.rollback()
    conn.autocommit = autocommit
    return conn


def assert_central_staging_schema(cur) -> None:
    """Preflight validasi schema tabel central staging (sap_timesheet_staging, sap_staging_source).
    
    Fail-closed bila ada tabel atau kolom wajib yang hilang.
    """
    cur.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('sap_timesheet_staging', 'sap_staging_source')
        """
    )
    found_tables = {r["table_name"] if isinstance(r, dict) else r[0] for r in cur.fetchall()}
    missing_tables = {'sap_timesheet_staging', 'sap_staging_source'} - found_tables
    if missing_tables:
        raise EtlError(f"Central schema check failed: missing tables {sorted(missing_tables)}")

    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sap_timesheet_staging'
        """
    )
    found_cols = {r["column_name"] if isinstance(r, dict) else r[0] for r in cur.fetchall()}
    required_cols = {
        'id', 'source_system', 'source_key', 'is_correction', 'source_ref_id', 'werks',
        'pernr', 'pernr_origin', 'rueck', 'aufnr', 'vornr', 'flgat', 'plnfl', 'vornr_b', 'vornr_r',
        'zconf_type', 'arbpl', 'lstar', 'isdd', 'isdz', 'iedd', 'iedz', 'aueru', 'zbarcodeid',
        'payload', 'provenance_snapshot', 'status', 'total_seconds', 'is_productive',
    }
    missing_cols = required_cols - found_cols
    if missing_cols:
        raise EtlError(f"Central schema check failed: missing columns in sap_timesheet_staging {sorted(missing_cols)}")


def resolve_database(plant: str, *, env: str = "lab") -> str:
    if env == "prod":
        env_key = f"MPS2_PROD_PLANT_{plant}_DBNAME"
        dbname = (
            os.environ.get(env_key)
            or os.environ.get("MPS2_PROD_PLANT_DBNAME")
            or (os.environ.get("DB_NAME") if os.environ.get("DB_HOST") else None)
        )
        if not dbname:
            raise EtlError(
                f"Konfigurasi database produksi untuk plant {plant!r} tidak ditemukan. "
                f"Sediakan environment variable {env_key} atau MPS2_PROD_PLANT_DBNAME."
            )
        return dbname

    override = os.environ.get("MPS2_ETL_DB")
    if override:
        return override
    if plant not in PLANT_DATABASES:
        raise EtlError(
            f"plant {plant!r} tidak punya database lab terdaftar "
            f"(tersedia: {sorted(PLANT_DATABASES)})"
        )
    return PLANT_DATABASES[plant]


def load_plant_config(cur, plant: str) -> dict:
    """Baca plant_config dan PASTIKAN plant yang diminta cocok. Fail-closed."""
    cur.execute(
        "SELECT plant_code, timezone, sap_rules, timesheet_allocation_cutoff_date, auto_post_enabled "
        "FROM public.plant_config WHERE id = 1 LIMIT 1"
    )
    row = cur.fetchone()
    if not row:
        raise EtlError("plant_config id=1 tidak ditemukan; menolak menebak timezone.")
    plant_code = (row["plant_code"] or "").strip()
    tz = (row["timezone"] or "").strip()
    if not tz:
        raise EtlError("plant_config.timezone kosong; menolak menebak timezone plant.")
    if plant_code != plant:
        raise EtlError(
            f"plant diminta {plant!r} tetapi plant_config.plant_code={plant_code!r} — "
            "koneksi atau argumen salah."
        )
    cutoff = row.get("timesheet_allocation_cutoff_date")
    return {
        "plant": plant_code,
        "timezone": tz,
        "sap_rules": row.get("sap_rules") or {},
        "cutoff_date": cutoff,
        "auto_post_enabled": bool(row.get("auto_post_enabled", False)),
    }


# ---------------------------------------------------------------------------
# Source hash
# ---------------------------------------------------------------------------

def _canonical_value(value):
    """Normalisasi nilai agar hash stabil: None dan string kosong tidak berbeda
    hanya karena representasi, dan timestamp selalu UTC ISO8601 dengan presisi penuh."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise EtlError(f"timestamp naif tidak boleh masuk hash: {value!r}")
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, str):
        return value
    return value


def compute_source_hash(row: dict) -> str:
    """Hash deterministik dari seluruh field payroll yang relevan.

    Ruang lingkup: field kanonik di HASH_FIELDS. `plant` ikut supaya tsnumber yang
    sama di dua plant tidak bertabrakan.
    """
    payload = {"plant": row["plant"]}
    for field in HASH_FIELDS:
        payload[field] = _canonical_value(row.get(field))
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Capture
# ---------------------------------------------------------------------------

CAPTURE_SQL = """
SELECT
  t.tsnumber,
  t.plant,
  t.serialnumber,
  t.activitytype,
  t.order_no,
  t.operation_no,
  t.workcentercode,
  t.confirmationnumber,
  t.state_flag,
  t.longdate_checkin,
  t.longdate_checkout,
  t.modified_at,
  EXTRACT(EPOCH FROM (t.longdate_checkout - t.longdate_checkin))::bigint AS raw_seconds,
  (t.longdate_checkin AT TIME ZONE %(tz)s)::date AS local_date_checkin,
  to_jsonb(t) AS raw_snapshot
FROM public.timesheet_transaction t
WHERE t.longdate_checkin IS NOT NULL
  AND t.longdate_checkout IS NOT NULL
  -- Interval valid: checkout benar-benar setelah checkin DAN durasinya minimal
  -- satu detik penuh. Ambang 1 detik bukan selera: ada record nyata dengan
  -- durasi 0,07 detik (CKP 39, BPN 5 pada window 1-21 Sep) yang membulat ke
  -- 0 detik. Pipeline lama sudah membuangnya di gerbang emit
  -- (`WHERE effective_seconds > 0`), jadi capture baru harus sama — kalau tidak,
  -- jalur lama dan baru tidak lagi bisa dibandingkan untuk window yang sama.
  AND EXTRACT(EPOCH FROM (t.longdate_checkout - t.longdate_checkin)) >= 1
  AND COALESCE(t.plant::text, '') = %(plant)s
  AND COALESCE(t.state_flag, 0) <> 5
  AND t.longdate_checkout >= %(from_ts)s
  AND t.longdate_checkout <  %(to_ts)s
ORDER BY t.tsnumber
"""

OPEN_SQL = """
SELECT count(*) AS n
FROM public.timesheet_transaction
WHERE COALESCE(plant::text, '') = %(plant)s
  AND longdate_checkin IS NOT NULL
  AND longdate_checkout IS NULL
  AND longdate_checkin >= %(from_ts)s
  AND longdate_checkin <  %(to_ts)s
"""

# ---------------------------------------------------------------------------
# Pelaporan harus memakai BASIS WINDOW YANG SAMA dengan capture.
# ---------------------------------------------------------------------------

TOTAL_CLOSED_SQL = """
SELECT count(*) AS n
FROM public.timesheet_transaction
WHERE COALESCE(plant::text, '') = %(plant)s
  AND COALESCE(state_flag, 0) <> 5
  AND longdate_checkin IS NOT NULL
  AND longdate_checkout IS NOT NULL
  AND longdate_checkout >= %(from_ts)s
  AND longdate_checkout <  %(to_ts)s
"""

INVALID_SQL = """
SELECT count(*) AS n
FROM public.timesheet_transaction
WHERE COALESCE(plant::text, '') = %(plant)s
  AND COALESCE(state_flag, 0) <> 5
  AND longdate_checkin IS NOT NULL
  AND longdate_checkout IS NOT NULL
  AND longdate_checkout >= %(from_ts)s
  AND longdate_checkout <  %(to_ts)s
  AND longdate_checkout <= longdate_checkin
"""

SUBSECOND_SQL = """
SELECT count(*) AS n
FROM public.timesheet_transaction
WHERE COALESCE(plant::text, '') = %(plant)s
  AND COALESCE(state_flag, 0) <> 5
  AND longdate_checkin IS NOT NULL
  AND longdate_checkout IS NOT NULL
  AND longdate_checkout >= %(from_ts)s
  AND longdate_checkout <  %(to_ts)s
  AND longdate_checkout > longdate_checkin
  AND EXTRACT(EPOCH FROM (longdate_checkout - longdate_checkin)) < 1
"""


def capture_candidates(cur, *, plant: str, tz: str, from_ts: datetime, to_ts: datetime) -> dict:
    """SELECT kandidat capture. Tidak ada satu pun write di sini."""
    params = {"plant": plant, "tz": tz, "from_ts": from_ts, "to_ts": to_ts}
    cur.execute(CAPTURE_SQL, params)
    rows = cur.fetchall()

    cur.execute(OPEN_SQL, params)
    open_count = int(scalar(cur.fetchone()) or 0)

    cur.execute(TOTAL_CLOSED_SQL, params)
    total_closed = int(scalar(cur.fetchone()) or 0)

    cur.execute(INVALID_SQL, params)
    invalid_count = int(scalar(cur.fetchone()) or 0)

    cur.execute(SUBSECOND_SQL, params)
    subsecond_count = int(scalar(cur.fetchone()) or 0)

    # Jaring pengaman in-memory: tidak boleh ada baris dengan durasi < 1 detik lolos.
    leaked = [r["tsnumber"] for r in rows if not r["raw_seconds"] or r["raw_seconds"] < 1]
    if leaked:
        raise EtlError(
            f"capture mengambil interval < 1 detik: {leaked[:10]} — predicate SQL salah"
        )

    accounted = len(rows) + subsecond_count + invalid_count
    if accounted != total_closed:
        raise EtlError(
            f"laporan tidak rekonsiliasi: kandidat={len(rows)} + subdetik={subsecond_count} "
            f"+ inverted={invalid_count} = {accounted}, tetapi total closed={total_closed}"
        )

    exclusions = {
        "INVALID_INTERVAL": invalid_count,
        "DURATION_LT_1_SECOND": subsecond_count,
    }

    return {
        "rows": rows,
        "open_count": open_count,
        "invalid_count": invalid_count,
        "subsecond_count": subsecond_count,
        "exclusions": exclusions,
        "total_closed": total_closed,
    }


def build_input_plan(rows: list[dict], *, plant: str, allocation_version: str) -> list[dict]:
    """Bentuk rencana input lengkap dengan hash dan snapshot. Murni in-memory."""
    plan = []
    for row in rows:
        enriched = dict(row)
        enriched["plant"] = plant
        plan.append({
            "source_tsnumber": row["tsnumber"],
            "source_updated_at": row["modified_at"],
            "source_hash": compute_source_hash(enriched),
            "allocation_version": allocation_version,
            "serialnumber": row["serialnumber"],
            "activitytype": row["activitytype"],
            "order_no": row["order_no"],
            "operation_no": row["operation_no"],
            "workcentercode": row["workcentercode"],
            "confirmationnumber": row["confirmationnumber"],
            "state_flag": row["state_flag"],
            "longdate_checkin": row["longdate_checkin"],
            "longdate_checkout": row["longdate_checkout"],
            "raw_seconds": row["raw_seconds"],
            "local_date_checkin": row["local_date_checkin"],
            "raw_snapshot": json.dumps(row["raw_snapshot"], sort_keys=True, default=str),
        })
    return plan


def plan_checksum(plan: list[dict]) -> str:
    """Checksum deterministik atas HIMPUNAN versi input."""
    digest = hashlib.sha256()
    for item in sorted(plan, key=lambda r: (r["source_tsnumber"], r["source_hash"])):
        digest.update(f"{item['source_tsnumber']}:{item['source_hash']}\n".encode("utf-8"))
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# Cleansing (F2)
# ---------------------------------------------------------------------------

CANONICAL_CONF_RE = re.compile(r"^\d+(RG|OV|RW)$", re.IGNORECASE)


def classify_confirmation_type(row: dict) -> tuple[str | None, str, str]:
    """Tentukan tipe konfirmasi (RG / OV / RW / UNKNOWN / None), sumber klasifikasi, dan alasan.

    Mengembalikan (confirmation_type, classification_source, classification_reason).

    Aturan bisnis & presedensi:
    - Non-produktif (activitytype terisi) -> (None, 'NON_PRODUCTIVE', 'NON_PRODUCTIVE_ACTIVITY')
    - Suffix pada confirmation number (Canonical: ^\d+(RG|OV|RW)$):
      - Suffix RG mengalahkan workcenter OT! -> ('RG', 'CANONICAL', 'CONFIRMATION_SUFFIX_RG')
      - Suffix OV -> ('OV', 'CANONICAL', 'CONFIRMATION_SUFFIX_OV')
      - Suffix RW -> ('RW', 'CANONICAL', 'CONFIRMATION_SUFFIX_RW')
    - Order rework (order_no diawali '32') -> ('RW', 'LEGACY_FALLBACK', 'ORDER_PREFIX_32')
    - Workcenter berakhiran 'OT' -> ('OV', 'LEGACY_FALLBACK', 'WORKCENTER_SUFFIX_OT')
    - Confirmation kosong / invalid tanpa suffix -> ('UNKNOWN', 'UNKNOWN', 'NO_CANONICAL_OR_FALLBACK')
    """
    is_productive = not (row.get("activitytype") or "").strip()
    if not is_productive:
        return None, "NON_PRODUCTIVE", "NON_PRODUCTIVE_ACTIVITY"

    conf_no = str(row.get("confirmationnumber") or "").strip().upper()
    order_no = str(row.get("order_no") or "").strip()
    workcenter = str(row.get("workcentercode") or "").strip().upper()

    # 1. Suffix pada confirmation number (Canonical: ^\d+(RG|OV|RW)$)
    # Suffix RG mengalahkan workcenter OT
    m = CANONICAL_CONF_RE.match(conf_no)
    if m:
        suffix = m.group(1).upper()
        return suffix, "CANONICAL", f"CONFIRMATION_SUFFIX_{suffix}"

    # 2. Order rework 32% (Legacy fallback)
    if order_no.startswith("32"):
        return "RW", "LEGACY_FALLBACK", "ORDER_PREFIX_32"

    # 3. Workcenter OT (Legacy fallback)
    if workcenter.endswith("OT"):
        return "OV", "LEGACY_FALLBACK", "WORKCENTER_SUFFIX_OT"

    # 4. Konfirmasi kosong atau invalid tanpa suffix
    return "UNKNOWN", "UNKNOWN", "NO_CANONICAL_OR_FALLBACK"


def determine_confirmation_type(row: dict) -> str | None:
    conf_type, _, _ = classify_confirmation_type(row)
    return conf_type


def split_interval_by_local_date(
    start: datetime,
    end: datetime,
    tz_name: str,
) -> list[tuple[datetime, datetime, date]]:
    """Potong interval pada batas tengah malam tanggal lokal plant.

    Mengembalikan list tuple: (segment_start, segment_end, local_date).
    Seluruh timestamp tetap timezone-aware.
    """
    if end <= start:
        return []

    tz = ZoneInfo(tz_name)
    cur_start = start.astimezone(tz)
    end_local = end.astimezone(tz)

    slices: list[tuple[datetime, datetime, date]] = []
    while cur_start.date() < end_local.date():
        next_midnight = datetime.combine(cur_start.date() + timedelta(days=1), time.min, tzinfo=tz)
        slice_end = min(end_local, next_midnight)
        if slice_end > cur_start:
            slices.append((cur_start, slice_end, cur_start.date()))
        cur_start = slice_end

    if cur_start < end_local:
        slices.append((cur_start, end_local, cur_start.date()))

    return slices


def merge_break_windows_for_day(
    day: date, break_windows: list[dict], tz: ZoneInfo
) -> list[tuple[datetime, datetime, str]]:
    """Ambil dan gabungkan (merge) semua window break aktif untuk satu tanggal lokal.

    Mendukung break window reguler dan break window lintas tengah malam (overnight).
    Menghindari dobel hitung bila ada window break yang saling overlap.
    Mengembalikan list interval non-overlapping: [(win_start, win_end, label), ...]
    yang sudah diclip ke batas tanggal `day`.
    """
    day_start = datetime.combine(day, time.min, tzinfo=tz)
    day_end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz)

    active: list[tuple[datetime, datetime, str]] = []

    # 1. Cek window dari hari sebelumnya (day - 1) yang mungkin overnight ke hari ini
    prev_day = day - timedelta(days=1)
    prev_pg_dow = (prev_day.weekday() + 1) % 7
    for w in break_windows:
        days = {int(d) for d in (w.get("days") or [])}
        if prev_pg_dow not in days:
            continue
        try:
            s_t = time.fromisoformat(w["start"])
            e_t = time.fromisoformat(w["end"])
        except (ValueError, KeyError):
            continue
        if e_t <= s_t:  # Overnight window
            w_start = datetime.combine(prev_day, s_t, tzinfo=tz)
            w_end = datetime.combine(day, e_t, tzinfo=tz)
            c_start = max(w_start, day_start)
            c_end = min(w_end, day_end)
            if c_end > c_start:
                active.append((c_start, c_end, f"BREAK: {w['start']}-{w['end']}"))

    # 2. Cek window dari hari ini (day)
    pg_dow = (day.weekday() + 1) % 7
    for w in break_windows:
        days = {int(d) for d in (w.get("days") or [])}
        if pg_dow not in days:
            continue
        try:
            s_t = time.fromisoformat(w["start"])
            e_t = time.fromisoformat(w["end"])
        except (ValueError, KeyError):
            continue
        w_start = datetime.combine(day, s_t, tzinfo=tz)
        if e_t <= s_t:
            w_end = datetime.combine(day + timedelta(days=1), e_t, tzinfo=tz)
        else:
            w_end = datetime.combine(day, e_t, tzinfo=tz)
        c_start = max(w_start, day_start)
        c_end = min(w_end, day_end)
        if c_end > c_start:
            active.append((c_start, c_end, f"BREAK: {w['start']}-{w['end']}"))

    if not active:
        return []

    active.sort(key=lambda item: item[0])
    merged: list[tuple[datetime, datetime, str]] = []
    cur_start, cur_end, cur_label = active[0]

    for next_start, next_end, next_label in active[1:]:
        if next_start <= cur_end:
            cur_end = max(cur_end, next_end)
            cur_label = f"{cur_label}+{next_label}"
        else:
            merged.append((cur_start, cur_end, cur_label))
            cur_start, cur_end, cur_label = next_start, next_end, next_label

    merged.append((cur_start, cur_end, cur_label))
    return merged


def slice_non_productive_day_interval(
    day_start: datetime,
    day_end: datetime,
    day: date,
    break_windows: list[dict],
    tz: ZoneInfo,
) -> list[tuple[datetime, datetime, str, str | None]]:
    """Bagi interval satu hari non-produktif menjadi segmen WORK dan BREAK.

    Mengembalikan list tuple:
      (seg_start, seg_end, segment_kind, break_rule)
    di mana segment_kind adalah 'WORK' atau 'BREAK'.
    """
    if day_end <= day_start:
        return []

    breaks = merge_break_windows_for_day(day, break_windows, tz)
    if not breaks:
        return [(day_start, day_end, "WORK", None)]

    slices: list[tuple[datetime, datetime, str, str | None]] = []
    cursor = day_start

    for b_start, b_end, b_label in breaks:
        if cursor >= day_end:
            break
        if b_end <= cursor:
            continue

        if b_start > cursor:
            work_end = min(b_start, day_end)
            if work_end > cursor:
                slices.append((cursor, work_end, "WORK", None))
            cursor = work_end

        if cursor >= day_end:
            break

        if b_start <= cursor < b_end:
            break_slice_end = min(b_end, day_end)
            if break_slice_end > cursor:
                slices.append((cursor, break_slice_end, "BREAK", b_label))
            cursor = break_slice_end

    if cursor < day_end:
        slices.append((cursor, day_end, "WORK", None))

    return slices


def validate_no_duplicate_activity_overlap(
    input_rows: list[dict],
    plant: str = "",
    *,
    target_ts_set: set | None = None,
    quarantine: bool = False,
    cur = None,
) -> None:
    """Kontrak F2: Untuk satu operator (serialnumber) dan plant, dua timesheet PRODUKTIF
    dengan order_no, operation_no, dan workcentercode yang sama tidak boleh overlap [checkin, checkout).

    Interval [08:00, 10:00) dan [10:00, 12:00) diperbolehkan (hanya bersentuhan / half-open).
    Order berbeda, operasi berbeda, atau workcenter berbeda diperbolehkan overlap.
    Jika ada overlap aktivitas produktif yang sama pada workcenter yang sama:
    - Jika quarantine=True: tandai baris yang beririsan sebagai INVALIDATED pada input plan & DB (timesheet_etl_input).
    - Jika quarantine=False: gagalkan run secara atomik dengan EtlError DUPLICATE_ACTIVITY_OVERLAP.
    Jika target_ts_set diberikan, abaikan pasangan di mana KEDUA record berada di luar target window (companion vs companion).
    """
    groups: dict[tuple, list[dict]] = defaultdict(list)

    for row in input_rows:
        if row.get("status") == "INVALIDATED":
            continue

        activitytype = (row.get("activitytype") or "").strip()
        if activitytype:
            # Non-produktif tidak dicek guard ini
            continue

        checkin = row.get("longdate_checkin")
        checkout = row.get("longdate_checkout")
        if not checkin or not checkout or checkout <= checkin:
            continue

        row_plant = str(row.get("plant") or plant or "").strip()
        serial = str(row.get("serialnumber") or "").strip()
        raw_order = str(row.get("order_no") or "").strip()
        norm_order = raw_order.lstrip("0")
        raw_op = row.get("operation_no")
        norm_wc = normalize_workcenter_code(row.get("workcentercode"))

        if not serial or not norm_order or raw_op is None or str(raw_op).strip() == "":
            continue

        try:
            norm_op = int(raw_op)
        except (ValueError, TypeError):
            continue

        tsnum = row.get("source_tsnumber") or row.get("tsnumber")
        groups[(row_plant, serial, norm_order, norm_op, norm_wc)].append({
            "tsnumber": tsnum,
            "checkin": checkin,
            "checkout": checkout,
            "serialnumber": serial,
            "order_no": norm_order,
            "operation_no": norm_op,
            "workcentercode": norm_wc,
            "plant": row_plant,
        })

    for (p, serial, order, op, wc), rows in groups.items():
        if len(rows) < 2:
            continue
        # Urutkan berdasarkan checkin, lalu checkout
        sorted_rows = sorted(rows, key=lambda r: (r["checkin"], r["checkout"]))
        for i in range(len(sorted_rows)):
            for j in range(i + 1, len(sorted_rows)):
                r1 = sorted_rows[i]
                r2 = sorted_rows[j]

                # Jika target_ts_set ditentukan, hanya validasi pasangan yang melibatkan
                # setidaknya satu record dari target window (cross-boundary check).
                if target_ts_set is not None:
                    if r1["tsnumber"] not in target_ts_set and r2["tsnumber"] not in target_ts_set:
                        continue

                # Check half-open overlap: max(s1, s2) < min(e1, e2)
                # Karena terurut r1.checkin <= r2.checkin, overlap terjadi jika r2.checkin < r1.checkout
                if r2["checkin"] < r1["checkout"]:
                    if quarantine:
                        ts1 = r1["tsnumber"]
                        ts2 = r2["tsnumber"]
                        for r_item in input_rows:
                            curr_ts = r_item.get("source_tsnumber") or r_item.get("tsnumber")
                            if curr_ts in (ts1, ts2):
                                r_item["status"] = "INVALIDATED"
                                r_item["invalidated_reason"] = "DUPLICATE_ACTIVITY_OVERLAP"
                                r_item["invalidated_at"] = datetime.now(timezone.utc)
                                if cur and r_item.get("input_id"):
                                    cur.execute(
                                        """
                                        UPDATE public.timesheet_etl_input
                                        SET status = 'INVALIDATED',
                                            invalidated_at = now(),
                                            invalidated_reason = 'DUPLICATE_ACTIVITY_OVERLAP'
                                        WHERE input_id = %s
                                        """,
                                        (r_item["input_id"],),
                                    )
                        continue
                    wc_desc = f" pada workcenter '{wc}'" if wc else ""
                    raise EtlError(
                        f"DUPLICATE_ACTIVITY_OVERLAP: Operator {serial} pada plant {p} memiliki 2 timesheet produktif "
                        f"dengan order {order} op {op}{wc_desc} yang overlap: tsnumber {r1['tsnumber']} [{r1['checkin']}, {r1['checkout']}) "
                        f"dan tsnumber {r2['tsnumber']} [{r2['checkin']}, {r2['checkout']})."
                    )


def build_cleaned_plan(
    input_rows: list[dict],
    *,
    plant: str,
    plant_timezone: str,
    rule_version: str = CLEAN_RULE_VERSION,
    sap_rules: dict | None = None,
    is_companion: bool = False,
    quarantine_duplicates: bool = False,
    cur = None,
) -> list[dict]:
    """Bentuk rencana segmen hasil cleansing untuk sekumpulan input row.

    Kontrak F2:
    - Menolak overlap aktivitas produktif yang sama (plant + operator + normalized order + op) dengan DUPLICATE_ACTIVITY_OVERLAP.
    - Interval dipotong pada batas tanggal lokal plant (Asia/Jakarta / Asia/Makassar).
    - Produktif tidak dipotong break -> seluruhnya segmen WORK.
    - Non-produktif dipecah menjadi segmen WORK dan BREAK sesuai break_windows.
      Record yang seluruhnya di dalam break menghasilkan satu segmen BREAK (bukan WORK remaining=0).
    - Seluruh segmen menutup input tanpa gap/overlap: sum(raw_seconds segmen) = raw_seconds input.
    - Cap tersimpan sebagai metadata (cap_seconds, cap_category, cap_rule) per input, TIDAK mengurangi WORK pada F2.
      Pengurangan cap dipindahkan ke F4 setelah alokasi F3.
    """
    if not is_companion:
        validate_no_duplicate_activity_overlap(
            input_rows, plant=plant, quarantine=quarantine_duplicates, cur=cur
        )

    rules = sap_rules or {}
    break_windows = rules.get("break_windows") or []
    tz = ZoneInfo(plant_timezone)
    plan: list[dict] = []

    for row in input_rows:
        if row.get("status") == "INVALIDATED":
            continue

        checkin = row.get("longdate_checkin")
        checkout = row.get("longdate_checkout")
        if not checkin or not checkout or checkout <= checkin:
            continue

        inp_raw_sec = row.get("raw_seconds")
        if inp_raw_sec is None:
            inp_raw_sec = int(round((checkout - checkin).total_seconds()))

        day_slices = split_interval_by_local_date(checkin, checkout, plant_timezone)
        activitytype = (row.get("activitytype") or "").strip()
        is_productive = not activitytype
        conf_type, class_src, class_reason = classify_confirmation_type(row)

        if is_productive:
            cap_cat = "VA"
        else:
            cat_map = rules.get("activity_categories") or {}
            cap_cat = str(cat_map.get(activitytype, "NVA")).upper()

        cap_min = cap_minutes_for(activitytype, rules, category=cap_cat.lower())
        cap_sec = int(cap_min * 60) if cap_min is not None else None
        cap_meta_rule = f"CAP_META: max {cap_min}m ({cap_cat})" if cap_min is not None else None

        raw_slices: list[tuple[datetime, datetime, date, str, str | None]] = []
        for d_start, d_end, l_date in day_slices:
            if d_end <= d_start:
                continue
            if is_productive:
                raw_slices.append((d_start, d_end, l_date, "WORK", None))
            else:
                phys_slices = slice_non_productive_day_interval(
                    d_start, d_end, l_date, break_windows, tz
                )
                for s_start, s_end, s_kind, b_rule in phys_slices:
                    if s_end > s_start:
                        raw_slices.append((s_start, s_end, l_date, s_kind, b_rule))

        if not raw_slices:
            continue

        total_span = (checkout - checkin).total_seconds()
        allocated_so_far = 0

        for idx, (seg_start, seg_end, l_date, seg_kind, break_rule) in enumerate(raw_slices):
            if idx == len(raw_slices) - 1:
                raw_sec = inp_raw_sec - allocated_so_far
            else:
                dur = (seg_end - seg_start).total_seconds()
                raw_sec = int(round(inp_raw_sec * dur / total_span)) if total_span > 0 else 0
                allocated_so_far += raw_sec

            if seg_kind == "WORK":
                deducted_sec = 0
                remaining_sec = raw_sec
                c_type = conf_type
                c_src = class_src
                c_reason = class_reason
                is_prod = is_productive
            else:  # BREAK
                deducted_sec = raw_sec
                remaining_sec = 0
                c_type = None
                c_src = "NON_PRODUCTIVE"
                c_reason = "NON_PRODUCTIVE_ACTIVITY"
                is_prod = False

            plan.append({
                "input_id": row.get("input_id"),
                "plant": plant,
                "source_tsnumber": row.get("source_tsnumber") or row.get("tsnumber"),
                "serialnumber": row.get("serialnumber", ""),
                "rule_version": rule_version,
                "segment_sequence": idx + 1,
                "segment_start": seg_start,
                "segment_end": seg_end,
                "local_date": l_date,
                "segment_kind": seg_kind,
                "confirmation_type": c_type,
                "classification_source": c_src,
                "classification_reason": c_reason,
                "is_productive": is_prod,
                "break_rule": break_rule,
                "cap_rule": cap_meta_rule,
                "cap_seconds": cap_sec,
                "cap_category": cap_cat,
                "raw_seconds": raw_sec,
                "deducted_seconds": deducted_sec,
                "remaining_seconds": remaining_sec,
            })

    return plan


def cleaned_plan_checksum(plan: list[dict]) -> str:
    """Checksum deterministik atas himpunan cleaned segment sebuah run."""
    digest = hashlib.sha256()
    for item in sorted(plan, key=lambda r: (r["source_tsnumber"], r["segment_sequence"])):
        start_str = _canonical_value(item["segment_start"])
        end_str = _canonical_value(item["segment_end"])
        rule_ver = str(item.get("rule_version") or "")
        conf_str = item.get("confirmation_type") or ""
        class_src = item.get("classification_source") or ""
        class_reason = item.get("classification_reason") or ""
        break_str = item.get("break_rule") or ""
        cap_str = item.get("cap_rule") or ""
        cap_sec_str = str(item.get("cap_seconds") if item.get("cap_seconds") is not None else "")
        cap_cat = str(item.get("cap_category") or "")
        line = (
            f"{rule_ver}:{item['source_tsnumber']}:{item['segment_sequence']}:{item['local_date']}:"
            f"{start_str}:{end_str}:{item['segment_kind']}:{conf_str}:{class_src}:{class_reason}:"
            f"{item['is_productive']}:{break_str}:{cap_str}:{cap_sec_str}:{cap_cat}:"
            f"{item['raw_seconds']}:{item['deducted_seconds']}:{item['remaining_seconds']}\n"
        )
        digest.update(line.encode("utf-8"))
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# Allocation (F3)
# ---------------------------------------------------------------------------

def fetch_companion_work_segments(
    cur,
    *,
    plant: str,
    tz_name: str,
    target_work_segments: list[dict],
    from_ts: datetime,
    to_ts: datetime,
    clean_rule_version: str = CLEAN_RULE_VERSION,
    allocation_version: str = ALLOCATION_VERSION,
    sap_rules: dict | None = None,
    target_inputs: list[dict] | None = None,
) -> list[dict]:
    """Tarik seluruh record companion pada operator-day yang disentuh window.

    Record companion adalah record milik operator yang sama pada tanggal lokal yang sama,
    tetapi longdate_checkout berada di luar window [from_ts, to_ts).
    Pencarian memakai interval overlap (checkin < local_day_end AND checkout > local_day_start)
    sehingga mencakup interval multi-hari di mana target date berada di tengah.
    Record ini dibersihkan in-memory untuk menghasilkan segmen WORK companion
    yang ikut membagi irisan waktu sweep-line tanpa dimasukkan ke output run saat ini.
    """
    if not target_work_segments:
        return []

    serials = list(set(s["serialnumber"] for s in target_work_segments if s.get("serialnumber")))
    local_dates = list(set(s["local_date"] for s in target_work_segments if s.get("local_date")))
    if not serials or not local_dates:
        return []

    tz = ZoneInfo(tz_name)
    min_date = min(local_dates)
    max_date = max(local_dates)
    range_start = datetime.combine(min_date, time.min, tzinfo=tz)
    range_end = datetime.combine(max_date + timedelta(days=1), time.min, tzinfo=tz)

    cur.execute(
        """
        SELECT
          t.tsnumber,
          t.plant,
          t.serialnumber,
          t.activitytype,
          t.order_no,
          t.operation_no,
          t.workcentercode,
          t.confirmationnumber,
          t.state_flag,
          t.longdate_checkin,
          t.longdate_checkout,
          t.modified_at,
          EXTRACT(EPOCH FROM (t.longdate_checkout - t.longdate_checkin))::bigint AS raw_seconds,
          (t.longdate_checkin AT TIME ZONE %(tz)s)::date AS local_date_checkin,
          to_jsonb(t) AS raw_snapshot
        FROM public.timesheet_transaction t
        WHERE COALESCE(t.plant::text, '') = %(plant)s
          AND t.serialnumber = ANY(%(serials)s)
          AND t.longdate_checkin IS NOT NULL
          AND t.longdate_checkout IS NOT NULL
          AND t.longdate_checkout > t.longdate_checkin
          AND EXTRACT(EPOCH FROM (t.longdate_checkout - t.longdate_checkin)) >= 1
          AND COALESCE(t.state_flag, 0) <> 5
          AND (t.longdate_checkout < %(from_ts)s OR t.longdate_checkout >= %(to_ts)s)
          AND t.longdate_checkin < %(range_end)s
          AND t.longdate_checkout > %(range_start)s
        ORDER BY t.tsnumber
        """,
        {
            "plant": plant,
            "tz": tz_name,
            "serials": serials,
            "from_ts": from_ts,
            "to_ts": to_ts,
            "range_start": range_start,
            "range_end": range_end,
        },
    )
    comp_rows = cur.fetchall()
    if not comp_rows:
        return []

    if target_inputs:
        # Cross-boundary check: pastikan tidak ada overlap aktivitas produktif yang sama
        # antara record di dalam target window dan record companion di luar window.
        target_ts_set = {r.get("source_tsnumber") or r.get("tsnumber") for r in target_inputs}
        combined_candidates = list(target_inputs) + list(comp_rows)
        validate_no_duplicate_activity_overlap(
            combined_candidates,
            plant=plant,
            target_ts_set=target_ts_set,
        )

    comp_plan = build_input_plan(comp_rows, plant=plant, allocation_version=allocation_version)
    comp_cleaned = build_cleaned_plan(
        comp_plan,
        plant=plant,
        plant_timezone=tz_name,
        rule_version=clean_rule_version,
        sap_rules=sap_rules,
        is_companion=True,
    )
    comp_ts_to_serial = {r["tsnumber"]: r["serialnumber"] for r in comp_rows}
    for seg in comp_cleaned:
        seg["serialnumber"] = comp_ts_to_serial.get(seg["source_tsnumber"], "")

    comp_work = [
        s for s in comp_cleaned
        if s.get("segment_kind") == "WORK" and s.get("is_productive") and s.get("remaining_seconds", 0) > 0
    ]
    return comp_work


def build_allocated_plan(
    target_cleaned_segments: list[dict],
    *,
    plant: str,
    allocation_version: str = ALLOCATION_VERSION,
    companion_segments: list[dict] | None = None,
) -> tuple[list[dict], dict]:
    """Bentuk rencana allocated segments menggunakan sweep-line pada batas operator-tanggal.

    Mengembalikan (allocated_plan, metrics_dict).

    Kontrak F3:
    - Hanya memproses segmen WORK produktif (segment_kind='WORK', remaining_seconds > 0, is_productive=True).
    - Dikelompokkan per (serialnumber, local_date).
    - Memasukkan seluruh segmen companion untuk operator-day yang sama agar active_count akurat.
    - Slices dipecah pada titik boundary aktual segmen WORK.
    - Largest remainder membagi detik eksak secara deterministik (source_tsnumber ASC, segment_sequence ASC).
    - Invariant: SUM(allocated_seconds seluruh segmen WORK pada operator-day) = union_seconds.
    - Hanya target_cleaned_segments (yang berasal dari window/run) yang di-emit ke allocated_plan.
    """
    target_work = [
        s for s in target_cleaned_segments
        if s.get("segment_kind") == "WORK" and s.get("is_productive") and s.get("remaining_seconds", 0) > 0
    ]
    comp_work = [
        s for s in (companion_segments or [])
        if s.get("segment_kind") == "WORK" and s.get("is_productive") and s.get("remaining_seconds", 0) > 0
    ]

    from collections import defaultdict
    by_op_day = defaultdict(list)
    for s in target_work:
        by_op_day[(s.get("serialnumber", ""), s["local_date"])].append((s, True))  # (seg, is_target)

    for s in comp_work:
        key = (s.get("serialnumber", ""), s["local_date"])
        if key in by_op_day:
            by_op_day[key].append((s, False))

    allocated_plan: list[dict] = []
    total_target_alloc_sec = 0
    total_companion_alloc_sec = 0
    total_union_sec = 0
    operator_day_violation_count = 0
    operator_days_count = len(by_op_day)

    for (serial, l_date), seg_tuples in sorted(by_op_day.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        points = sorted(
            set(st[0]["segment_start"] for st in seg_tuples)
            | set(st[0]["segment_end"] for st in seg_tuples)
        )
        op_day_union = 0
        op_day_alloc = 0

        for i in range(len(points) - 1):
            s_start, s_end = points[i], points[i + 1]
            span = int((s_end - s_start).total_seconds())
            if span <= 0:
                continue

            active = [
                st for st in seg_tuples
                if st[0]["segment_start"] <= s_start and st[0]["segment_end"] >= s_end
            ]
            if not active:
                continue

            op_day_union += span
            active_count = len(active)
            floor_sec = span // active_count
            rem = span % active_count

            # Sort active deterministically by (source_tsnumber ASC, segment_sequence ASC)
            active_sorted = sorted(
                active,
                key=lambda st: (st[0]["source_tsnumber"], st[0].get("segment_sequence", 1)),
            )

            for rank, (seg, is_target) in enumerate(active_sorted):
                alloc_sec = floor_sec + (1 if rank < rem else 0)
                op_day_alloc += alloc_sec

                if is_target:
                    total_target_alloc_sec += alloc_sec
                    allocated_plan.append({
                        "cleaned_segment_id": seg.get("cleaned_segment_id"),
                        "input_id": seg.get("input_id"),
                        "plant": plant,
                        "source_tsnumber": seg["source_tsnumber"],
                        "allocation_version": allocation_version,
                        "slice_start": s_start,
                        "slice_end": s_end,
                        "local_date": l_date,
                        "active_count": active_count,
                        "numerator": span,
                        "denominator": active_count,
                        "allocated_seconds": alloc_sec,
                    })
                else:
                    total_companion_alloc_sec += alloc_sec

        total_union_sec += op_day_union
        if op_day_alloc != op_day_union:
            operator_day_violation_count += 1
            raise EtlError(
                f"Invariant alokasi gagal pada operator={serial!r}, date={l_date}: "
                f"total_allocated={op_day_alloc} != union_seconds={op_day_union}"
            )

    total_all_alloc_sec = total_target_alloc_sec + total_companion_alloc_sec
    alloc_delta = total_all_alloc_sec - total_union_sec

    metrics = {
        "operator_days_count": operator_days_count,
        "allocated_segment_count": len(allocated_plan),
        "target_allocated_seconds": total_target_alloc_sec,
        "companion_allocated_seconds": total_companion_alloc_sec,
        "all_allocated_seconds": total_all_alloc_sec,
        "total_union_seconds": total_union_sec,
        "allocation_delta_seconds": alloc_delta,
        "operator_day_violation_count": operator_day_violation_count,
    }
    return allocated_plan, metrics


def allocated_plan_checksum(plan: list[dict]) -> str:
    """Checksum deterministik atas himpunan allocated segment sebuah run."""
    digest = hashlib.sha256()
    for item in sorted(
        plan,
        key=lambda r: (
            r["source_tsnumber"],
            _canonical_value(r["slice_start"]),
            str(r.get("cleaned_segment_id") or ""),
        ),
    ):
        start_str = _canonical_value(item["slice_start"])
        end_str = _canonical_value(item["slice_end"])
        alloc_ver = str(item.get("allocation_version") or "")
        line = (
            f"{alloc_ver}:{item['source_tsnumber']}:{item['local_date']}:{start_str}:{end_str}:"
            f"{item['active_count']}:{item['numerator']}:{item['denominator']}:{item['allocated_seconds']}\n"
        )
        digest.update(line.encode("utf-8"))
    return digest.hexdigest()


def ph3_order_table() -> str:
    return os.environ.get("TGT_TABLE", "ph3_order").strip() or "ph3_order"


def quote_identifier(identifier: str) -> str:
    if not identifier:
        raise ValueError("SQL identifier cannot be empty")
    return '"' + identifier.replace('"', '""') + '"'


def quote_table_name(table_name: str) -> str:
    return ".".join(quote_identifier(part.strip()) for part in table_name.split(".") if part.strip())


def fetch_f4_enrichment_data(
    cur,
    *,
    plant: str,
    plant_timezone: str,
) -> dict:
    """Ambil data master enrichment dan eligibility flags dari database lab lokal."""
    user_roles = {}
    try:
        cur.execute("SELECT snssb, roles FROM public.usernfc")
        for u in cur.fetchall():
            sn = re.sub(r"\s+", "", str(u.get("snssb") or "")).upper()
            if sn:
                user_roles[sn] = str(u.get("roles") or "").strip()
    except Exception as exc:
        raise EtlError(f"Gagal memuat usernfc: {exc}") from exc

    ph3_table = quote_table_name(ph3_order_table())
    master_orders = {}
    try:
        cur.execute(f"""
            SELECT order_no, operation_no, confirmation_number, sequence_category,
                   sequence_number, branch_operation_no, return_operation_no
            FROM {ph3_table}
        """)
        for po in cur.fetchall():
            ord_no = str(po.get("order_no") or "").strip().lstrip("0")
            op_no = str(po.get("operation_no") or "").strip().lstrip("0")
            master_orders[(ord_no, op_no)] = {
                "confirmation_number": str(po.get("confirmation_number") or "").strip(),
                "sequence_category": str(po.get("sequence_category") or "").strip(),
                "sequence_number": str(po.get("sequence_number") or "").strip(),
                "branch_operation_no": str(po.get("branch_operation_no") or "").strip(),
                "return_operation_no": str(po.get("return_operation_no") or "").strip(),
            }
    except Exception as exc:
        raise EtlError(f"Gagal memuat master order dari {ph3_table}: {exc}") from exc

    explicit_exclusions = set()
    try:
        cur.execute("""
            SELECT source_row_id
            FROM public.sap_staging_exclusion
            WHERE source_system = 'TIMESHEET' AND plant = %s
        """, (plant,))
        for r in cur.fetchall():
            row_id = str(r.get("source_row_id") or "").strip()
            if row_id:
                explicit_exclusions.add(row_id)
    except Exception as exc:
        raise EtlError(f"Gagal memuat sap_staging_exclusion: {exc}") from exc

    open_operator_days = set()
    try:
        cur.execute("""
            SELECT serialnumber, longdate_checkin
            FROM public.timesheet_transaction
            WHERE plant = %s
              AND longdate_checkout IS NULL
              AND longdate_checkin IS NOT NULL
        """, (plant,))
        tz = ZoneInfo(plant_timezone)
        for r in cur.fetchall():
            sn = str(r.get("serialnumber") or "").strip()
            checkin = r.get("longdate_checkin")
            if sn and checkin:
                if checkin.tzinfo is None:
                    checkin = checkin.replace(tzinfo=timezone.utc)
                l_date = checkin.astimezone(tz).date()
                open_operator_days.add((sn, l_date))
                open_operator_days.add((sn, l_date - timedelta(days=1)))
                open_operator_days.add((sn, l_date + timedelta(days=1)))
    except Exception as exc:
        raise EtlError(f"Gagal memuat open records dari timesheet_transaction: {exc}") from exc

    return {
        "user_roles": user_roles,
        "master_orders": master_orders,
        "explicit_exclusions": explicit_exclusions,
        "open_operator_days": open_operator_days,
    }


# ---------------------------------------------------------------------------
# F4: SAP-Ready Payload Plan & Checksum
# ---------------------------------------------------------------------------

def build_sap_ready_plan(
    inputs: list[dict],
    cleaned_plan: list[dict],
    allocated_plan: list[dict],
    plant: str,
    plant_timezone: str,
    allocation_version: str = ALLOCATION_VERSION,
    ready_version: str = READY_RULE_VERSION,
    enrichment_data: dict | None = None,
    cur = None,
    cutoff_date: date | None = None,
) -> tuple[list[dict], dict, dict]:
    """Bentuk rencana payload SAP-ready (F4).

    Kontrak:
    - Produktif: sumber dari timesheet_allocated_segment F3.
      pre_cap_seconds = sum(slice['allocated_seconds']) untuk seluruh irisan milik cleaned segment.
      confirmation_type UNKNOWN dilarang masuk SAP-ready (UNKNOWN_CONFIRMATION).
      Enrichment master order (RUECK, FLGAT, PLNFL, VORNR_B, VORNR_R) wajib dicocokkan ke ph3_order.
      Missing master operation -> MASTER_OPERATION_NOT_FOUND.
      Missing confirmation_number -> MISSING_CONFIRMATION_NUMBER.
    - Nonproduktif: sumber langsung dari timesheet_cleaned_segment F2 (segment_kind='WORK', is_productive=False).
      pre_cap_seconds = remaining_seconds.
      Segmen BREAK dilarang masuk SAP-ready.
      Seluruh field master produktif (RUECK/AUFNR/VORNR/FLGAT/PLNFL/VORNR_B/VORNR_R/ZCONF_TYPE) wajib kosong ("").
    - Role operator: diperkaya dari usernfc (OUTSOURCE/ADMINISTRATOR -> PERNR=11009413, normal -> LPAD(serial, 8, '0'), SUBCONT -> SUBCONT_ROLE diblokir).
    - Eligibility gates:
      - activitytype == '0000' -> ACTIVITYTYPE_0000
      - operator-day memiliki record terbuka -> OPERATOR_DAY_OPEN
      - explicit sap_staging_exclusion -> EXPLICIT_STAGING_EXCLUSION
    - Cap wajib berlaku per source input record:
      cap_configured_source_count, cap_applied_source_count, uncapped_source_count, total_cap_deducted_seconds.
    - Snapshot enrichment tersimpan dan masuk semantic checksum deterministik.
    """
    if enrichment_data is None:
        if cur is not None:
            enrichment_data = fetch_f4_enrichment_data(cur, plant=plant, plant_timezone=plant_timezone)
        else:
            enrichment_data = {}

    user_roles = enrichment_data.get("user_roles") or {}
    master_orders = enrichment_data.get("master_orders") or {}
    explicit_exclusions = enrichment_data.get("explicit_exclusions") or set()
    open_operator_days = enrichment_data.get("open_operator_days") or set()

    input_by_id = {inp["input_id"]: inp for inp in inputs if inp.get("input_id")}
    input_by_ts = {inp["source_tsnumber"]: inp for inp in inputs if "source_tsnumber" in inp}

    alloc_by_cleaned_id = defaultdict(list)
    alloc_by_ts_date = defaultdict(list)
    for sl in allocated_plan:
        if sl.get("cleaned_segment_id"):
            alloc_by_cleaned_id[sl["cleaned_segment_id"]].append(sl)
        alloc_by_ts_date[(sl.get("source_tsnumber"), str(sl.get("local_date")))].append(sl)

    exclusions = {
        "UNKNOWN_CONFIRMATION": 0,
        "MISSING_ORDER": 0,
        "MISSING_OPERATION": 0,
        "MASTER_OPERATION_NOT_FOUND": 0,
        "MISSING_CONFIRMATION_NUMBER": 0,
        "SUBCONT_ROLE": 0,
        "ACTIVITYTYPE_0000": 0,
        "OPERATOR_DAY_OPEN": 0,
        "EXPLICIT_STAGING_EXCLUSION": 0,
        "MISSING_REQUIRED_SAP_FIELD": 0,
        "ZERO_EFFECTIVE_SECONDS": 0,
        "INVALID_CAP_METADATA": 0,
    }
    blocked_seconds_per_reason = {
        "UNKNOWN_CONFIRMATION": 0,
        "MISSING_ORDER": 0,
        "MISSING_OPERATION": 0,
        "MASTER_OPERATION_NOT_FOUND": 0,
        "MISSING_CONFIRMATION_NUMBER": 0,
        "SUBCONT_ROLE": 0,
        "ACTIVITYTYPE_0000": 0,
        "OPERATOR_DAY_OPEN": 0,
        "EXPLICIT_STAGING_EXCLUSION": 0,
        "MISSING_REQUIRED_SAP_FIELD": 0,
        "ZERO_EFFECTIVE_SECONDS": 0,
        "INVALID_CAP_METADATA": 0,
    }

    # Kelompokkan segmen WORK berdasarkan source record (input_id atau source_tsnumber)
    work_segments_by_input = defaultdict(list)
    for seg in cleaned_plan:
        if seg.get("segment_kind") != "WORK":
            continue
        group_key = seg.get("input_id") or seg.get("source_tsnumber")
        work_segments_by_input[group_key].append(seg)

    sap_ready_plan = []
    productive_count = 0
    non_productive_count = 0
    total_pre_cap_sec = 0
    total_sap_effective_sec = 0
    cap_configured_source_count = 0
    cap_applied_source_count = 0
    uncapped_source_count = 0
    blocked_source_count = 0
    ready_invariant_violation_count = 0

    for group_key, segs in work_segments_by_input.items():
        inp = input_by_id.get(group_key) or (input_by_ts.get(group_key) if isinstance(group_key, int) else None)
        if not inp and segs:
            inp = input_by_ts.get(segs[0]["source_tsnumber"]) or {}
        if not inp:
            inp = {}

        total_raw = sum(s["raw_seconds"] for s in segs)

        # 1. Validasi konsistensi cap metadata untuk seluruh fragmen satu source record
        cap_secs = [s.get("cap_seconds") if s.get("cap_seconds") is not None else inp.get("cap_seconds") for s in segs]
        cap_cats = [s.get("cap_category") if s.get("cap_category") is not None else inp.get("cap_category") for s in segs]

        has_none = any(c is None for c in cap_secs)
        has_num = any(c is not None for c in cap_secs)
        has_negative = any(c is not None and c < 0 for c in cap_secs)
        unique_nums = {c for c in cap_secs if c is not None}
        unique_cats = {c for c in cap_cats if c is not None}

        if (has_none and has_num) or has_negative or len(unique_nums) > 1 or len(unique_cats) > 1:
            exclusions["INVALID_CAP_METADATA"] += 1
            blocked_source_count += 1
            blocked_seconds_per_reason["INVALID_CAP_METADATA"] += total_raw
            continue

        cap_sec = cap_secs[0] if cap_secs else None

        # 2. Activitytype 0000 check
        act_type = (inp.get("activitytype") or segs[0].get("activitytype") or "").strip()
        if act_type == "0000":
            exclusions["ACTIVITYTYPE_0000"] += 1
            blocked_source_count += 1
            blocked_seconds_per_reason["ACTIVITYTYPE_0000"] += total_raw
            continue

        # 3. Subcont role check
        serial = segs[0].get("serialnumber") or inp.get("serialnumber") or ""
        serial_str = str(serial).strip()
        sn_clean = re.sub(r"\s+", "", serial_str).upper()
        role = user_roles.get(sn_clean, "")
        if role.strip().upper() == "SUBCONT":
            exclusions["SUBCONT_ROLE"] += 1
            blocked_source_count += 1
            blocked_seconds_per_reason["SUBCONT_ROLE"] += total_raw
            continue

        # 4. Operator day open check
        if any((serial_str, s["local_date"]) in open_operator_days for s in segs):
            exclusions["OPERATOR_DAY_OPEN"] += 1
            blocked_source_count += 1
            blocked_seconds_per_reason["OPERATOR_DAY_OPEN"] += total_raw
            continue

        # 5. Explicit staging exclusion check
        src_ts = segs[0].get("source_tsnumber") or inp.get("source_tsnumber") or inp.get("tsnumber")
        if str(src_ts) in explicit_exclusions:
            exclusions["EXPLICIT_STAGING_EXCLUSION"] += 1
            blocked_source_count += 1
            blocked_seconds_per_reason["EXPLICIT_STAGING_EXCLUSION"] += total_raw
            continue

        # 6. Serialnumber check
        if not serial_str:
            exclusions["MISSING_REQUIRED_SAP_FIELD"] += 1
            blocked_source_count += 1
            blocked_seconds_per_reason["MISSING_REQUIRED_SAP_FIELD"] += total_raw
            continue

        # 7. Productive records check
        is_prod = bool(segs[0].get("is_productive"))
        order_no = segs[0].get("order_no") or inp.get("order_no")
        op_no = segs[0].get("operation_no") if segs[0].get("operation_no") is not None else inp.get("operation_no")
        try:
            op_int = int(op_no) if op_no is not None else None
        except (ValueError, TypeError):
            op_int = None

        po = None
        master_conf = ""
        if is_prod:
            c_type = segs[0].get("confirmation_type")
            c_src = segs[0].get("classification_source")
            if not c_type or c_type == "UNKNOWN" or c_src == "UNKNOWN":
                exclusions["UNKNOWN_CONFIRMATION"] += 1
                blocked_source_count += 1
                blocked_seconds_per_reason["UNKNOWN_CONFIRMATION"] += total_raw
                continue

            if not order_no or not str(order_no).strip():
                exclusions["MISSING_ORDER"] += 1
                blocked_source_count += 1
                blocked_seconds_per_reason["MISSING_ORDER"] += total_raw
                continue

            if op_int is None or op_int <= 0:
                exclusions["MISSING_OPERATION"] += 1
                blocked_source_count += 1
                blocked_seconds_per_reason["MISSING_OPERATION"] += total_raw
                continue

            ord_clean = str(order_no).strip().lstrip("0")
            op_clean = str(op_int).lstrip("0")
            po = master_orders.get((ord_clean, op_clean))
            if po is None:
                exclusions["MASTER_OPERATION_NOT_FOUND"] += 1
                blocked_source_count += 1
                blocked_seconds_per_reason["MASTER_OPERATION_NOT_FOUND"] += total_raw
                continue

            master_conf = str(po.get("confirmation_number") or "").strip()
            if not master_conf:
                exclusions["MISSING_CONFIRMATION_NUMBER"] += 1
                blocked_source_count += 1
                blocked_seconds_per_reason["MISSING_CONFIRMATION_NUMBER"] += total_raw
                continue

        # 8. Pre-cap calculations
        fragments = []
        for seg in segs:
            if is_prod:
                seg_id = seg.get("cleaned_segment_id")
                if seg_id and seg_id in alloc_by_cleaned_id:
                    slices = alloc_by_cleaned_id[seg_id]
                else:
                    all_slices = alloc_by_ts_date.get((seg["source_tsnumber"], str(seg["local_date"])), [])
                    slices = [
                        s for s in all_slices
                        if s["slice_start"] >= seg["segment_start"] and s["slice_end"] <= seg["segment_end"]
                    ]
                pre_cap = sum(s["allocated_seconds"] for s in slices)
            else:
                pre_cap = seg.get("remaining_seconds", 0)

            fragments.append({
                "cleaned_segment": seg,
                "input_row": inp,
                "input_id": seg.get("input_id"),
                "source_tsnumber": seg["source_tsnumber"],
                "segment_sequence": seg["segment_sequence"],
                "segment_start": seg["segment_start"],
                "segment_end": seg["segment_end"],
                "local_date": seg["local_date"],
                "raw_seconds": seg["raw_seconds"],
                "cleaned_seconds": seg.get("remaining_seconds", 0),
                "pre_cap_seconds": pre_cap,
                "cap_seconds": cap_sec,
                "is_productive": is_prod,
                "order_no": order_no,
                "operation_no": op_int,
                "master_po": po,
                "master_conf": master_conf,
                "role": role,
            })

        # 9. Cap calculation per source record
        fragments.sort(key=lambda f: (f["segment_start"], f["segment_sequence"]))
        total_pre_cap = sum(f["pre_cap_seconds"] for f in fragments)
        total_pre_cap_sec += total_pre_cap

        if cap_sec is not None:
            cap_configured_source_count += 1
            record_effective = min(total_pre_cap, cap_sec)
            deducted = total_pre_cap - record_effective
            if deducted > 0:
                cap_applied_source_count += 1
        else:
            uncapped_source_count += 1
            record_effective = total_pre_cap

        remaining_allowance = record_effective

        # 10. Distribute effective seconds & construct payload
        for frag in fragments:
            # Saring fragmen sebelum cutoff plant jika record melintasi batas tengah malam cutoff
            if cutoff_date is not None and frag["local_date"] < cutoff_date:
                exclusions["PRE_CUTOFF_FRAGMENT"] = exclusions.get("PRE_CUTOFF_FRAGMENT", 0) + 1
                blocked_seconds_per_reason["PRE_CUTOFF_FRAGMENT"] = blocked_seconds_per_reason.get("PRE_CUTOFF_FRAGMENT", 0) + frag["pre_cap_seconds"]
                continue

            alloc = min(frag["pre_cap_seconds"], remaining_allowance)
            frag["sap_effective_seconds"] = alloc
            remaining_allowance -= alloc

            if alloc <= 0:
                exclusions["ZERO_EFFECTIVE_SECONDS"] += 1
                blocked_seconds_per_reason["ZERO_EFFECTIVE_SECONDS"] += frag["pre_cap_seconds"]
                continue

            tz = ZoneInfo(plant_timezone)
            effective_start = frag["segment_start"]
            effective_end = effective_start + timedelta(seconds=alloc)

            if effective_end <= effective_start or int(round((effective_end - effective_start).total_seconds())) != alloc:
                ready_invariant_violation_count += 1
                raise EtlError(
                    f"Inkonsistensi timestamp untuk source_tsnumber={frag['source_tsnumber']}: "
                    f"effective_start={effective_start}, effective_end={effective_end}, alloc={alloc}"
                )

            loc_start = effective_start.astimezone(tz)
            loc_end = effective_end.astimezone(tz)
            c_seg = frag["cleaned_segment"]
            serial = c_seg.get("serialnumber") or inp.get("serialnumber") or ""
            serial_str = str(serial).strip()
            pernr_origin = serial_str.zfill(8)

            role_str = frag["role"].strip().upper() if frag["role"] else ""
            if role_str in ("OUTSOURCE", "ADMINISTRATOR"):
                pernr = "11009413"
            else:
                pernr = pernr_origin

            if frag["is_productive"]:
                aufnr = str(frag["order_no"]).strip().zfill(12)
                vornr = str(frag["operation_no"]).zfill(4)
                rueck = frag["master_conf"]
                frag_po = frag["master_po"] or {}
                flgat = str(frag_po.get("sequence_category") or "").strip()
                plnfl = str(frag_po.get("sequence_number") or "").strip()
                vornr_b = str(frag_po.get("branch_operation_no") or "").strip()
                vornr_r = str(frag_po.get("return_operation_no") or "").strip()
                zconf_type = str(c_seg.get("confirmation_type") or "").strip()
                lstar = ""
            else:
                aufnr = ""
                vornr = ""
                rueck = ""
                flgat = ""
                plnfl = ""
                vornr_b = ""
                vornr_r = ""
                zconf_type = ""
                lstar = str(inp.get("activitytype") or c_seg.get("activitytype") or "").strip()

            arbpl = str(inp.get("workcentercode") or c_seg.get("workcentercode") or "").strip()
            isdd = loc_start.strftime("%Y%m%d")
            isdz = loc_start.strftime("%H%M%S")
            iedd = loc_end.strftime("%Y%m%d")
            iedz = loc_end.strftime("%H%M%S")

            source_version = inp.get("source_hash") or inp.get("source_version") or ""
            source_key = f"{plant}:{frag['source_tsnumber']}:{source_version}:{allocation_version}:{ready_version}:{frag['local_date']}:{frag['segment_sequence']}"

            enrichment_snapshot = {
                "role": frag["role"] if frag["role"] else None,
                "is_outsource_or_admin": role_str in ("OUTSOURCE", "ADMINISTRATOR"),
                "master_confirmation_number": frag["master_conf"] if frag["is_productive"] else None,
                "sequence_category": flgat if frag["is_productive"] else None,
                "sequence_number": plnfl if frag["is_productive"] else None,
                "branch_operation_no": vornr_b if frag["is_productive"] else None,
                "return_operation_no": vornr_r if frag["is_productive"] else None,
                "eligibility": {
                    "subcont": False,
                    "activitytype_0000": False,
                    "operator_day_open": False,
                    "explicit_exclusion": False,
                },
            }

            payload = {
                "WERKS": plant,
                "PERNR": pernr,
                "PERNR_ORIGIN": pernr_origin,
                "RUECK": rueck,
                "AUFNR": aufnr,
                "VORNR": vornr,
                "FLGAT": flgat,
                "PLNFL": plnfl,
                "VORNR_B": vornr_b,
                "VORNR_R": vornr_r,
                "ZCONF_TYPE": zconf_type,
                "ARBPL": arbpl,
                "LSTAR": lstar,
                "ISDD": isdd,
                "ISDZ": isdz,
                "IEDD": iedd,
                "IEDZ": iedz,
                "AUERU": "",
                "ZBARCODEID": "",
                "date_checkin": loc_start.date().isoformat(),
                "date_checkout": loc_end.date().isoformat(),
                "hour_checkin": loc_start.strftime("%H:%M:%S"),
                "hour_checkout": loc_end.strftime("%H:%M:%S"),
                "longdate_checkin": effective_start.astimezone(timezone.utc).isoformat(),
                "longdate_checkout": effective_end.astimezone(timezone.utc).isoformat(),
                "order_no": str(frag["order_no"]).strip() if frag["order_no"] else None,
                "operation_no": frag["operation_no"],
                "workcentercode": arbpl or None,
                "confirmationnumber": rueck or None,
                "activitytype": lstar or None,
                "confirmation_type": c_seg.get("confirmation_type"),
                "classification_source": c_seg.get("classification_source"),
                "classification_reason": c_seg.get("classification_reason"),
                "raw_seconds": frag["raw_seconds"],
                "cleaned_seconds": frag["cleaned_seconds"],
                "allocated_seconds": frag["pre_cap_seconds"],
                "cap_seconds": frag["cap_seconds"],
                "sap_effective_seconds": alloc,
                "hours": round(alloc / 3600.0, 4),
                "source_key": source_key,
                "ready_rule_version": ready_version,
                "enrichment_snapshot": enrichment_snapshot,
            }

            # Strict Required Field Validation
            if not payload["WERKS"] or len(payload["WERKS"]) < 4:
                raise EtlError(f"Payload field WERKS invalid: {payload['WERKS']}")
            if len(payload["PERNR"]) != 8:
                raise EtlError(f"Payload field PERNR invalid: {payload['PERNR']}")
            if len(payload["PERNR_ORIGIN"]) != 8:
                raise EtlError(f"Payload field PERNR_ORIGIN invalid: {payload['PERNR_ORIGIN']}")
            if len(payload["ISDD"]) != 8 or len(payload["IEDD"]) != 8 or len(payload["ISDZ"]) != 6 or len(payload["IEDZ"]) != 6:
                raise EtlError(f"Payload date/time fields invalid: ISDD={payload['ISDD']}, ISDZ={payload['ISDZ']}, IEDD={payload['IEDD']}, IEDZ={payload['IEDZ']}")

            if frag["is_productive"]:
                if not payload["RUECK"]:
                    raise EtlError(f"Productive payload RUECK is empty: {payload['RUECK']}")
                if len(payload["AUFNR"]) != 12:
                    raise EtlError(f"Productive payload AUFNR invalid: {payload['AUFNR']}")
                if len(payload["VORNR"]) != 4:
                    raise EtlError(f"Productive payload VORNR invalid: {payload['VORNR']}")
                if payload["ZCONF_TYPE"] not in ("RG", "OV", "RW"):
                    raise EtlError(f"Productive payload ZCONF_TYPE invalid: {payload['ZCONF_TYPE']}")
                if payload["LSTAR"] != "":
                    raise EtlError(f"Productive payload LSTAR must be empty, got {payload['LSTAR']}")
            else:
                if not payload["LSTAR"]:
                    raise EtlError("Non-productive payload LSTAR is empty")
                if any([payload["RUECK"], payload["AUFNR"], payload["VORNR"], payload["FLGAT"], payload["PLNFL"], payload["VORNR_B"], payload["VORNR_R"], payload["ZCONF_TYPE"]]):
                    raise EtlError(f"Non-productive payload contains productive fields: {payload}")

            sap_ready_row = {
                "input_id": frag["input_id"],
                "plant": plant,
                "source_tsnumber": frag["source_tsnumber"],
                "source_version": source_version,
                "allocation_version": allocation_version,
                "ready_rule_version": ready_version,
                "local_date": frag["local_date"],
                "segment_sequence": frag["segment_sequence"],
                "source_key": source_key,
                "enrichment_snapshot": enrichment_snapshot,
                "payload": payload,
                "raw_seconds": frag["raw_seconds"],
                "cleaned_seconds": frag["cleaned_seconds"],
                "allocated_seconds": frag["pre_cap_seconds"],
                "cap_seconds": frag["cap_seconds"],
                "sap_effective_seconds": alloc,
                "status": "SAP_READY",
            }
            sap_ready_plan.append(sap_ready_row)
            if frag["is_productive"]:
                productive_count += 1
            else:
                non_productive_count += 1
            total_sap_effective_sec += alloc

    total_cap_deducted_sec = total_pre_cap_sec - total_sap_effective_sec

    # Invariant validations
    if total_pre_cap_sec != total_sap_effective_sec + total_cap_deducted_sec:
        ready_invariant_violation_count += 1
        raise EtlError(
            f"F4 Invariant violation: total_pre_cap_seconds ({total_pre_cap_sec}) != "
            f"total_sap_effective_seconds ({total_sap_effective_sec}) + total_cap_deducted_seconds ({total_cap_deducted_sec})"
        )

    for row in sap_ready_plan:
        if row["payload"].get("ZCONF_TYPE") == "UNKNOWN" or row["payload"].get("confirmation_type") == "UNKNOWN":
            ready_invariant_violation_count += 1
            raise EtlError(f"F4 Invariant violation: UNKNOWN confirmation leaked into SAP-ready: {row['source_key']}")

    sap_metrics = {
        "sap_ready_count": len(sap_ready_plan),
        "productive_sap_ready_count": productive_count,
        "non_productive_sap_ready_count": non_productive_count,
        "total_pre_cap_seconds": total_pre_cap_sec,
        "total_cap_deducted_seconds": total_cap_deducted_sec,
        "total_sap_effective_seconds": total_sap_effective_sec,
        "total_sap_hours": round(total_sap_effective_sec / 3600.0, 4),
        "cap_configured_source_count": cap_configured_source_count,
        "cap_applied_source_count": cap_applied_source_count,
        "uncapped_source_count": uncapped_source_count,
        "blocked_source_count": blocked_source_count,
        "ready_invariant_violation_count": ready_invariant_violation_count,
        "blocked_seconds_per_reason": blocked_seconds_per_reason,
        "sap_ready_exclusions": exclusions,
    }
    return sap_ready_plan, sap_metrics, exclusions


def sap_ready_plan_checksum(plan: list[dict]) -> str:
    """Hash deterministik dari rencana SAP-ready."""
    canonical_rows = []
    for row in sorted(plan, key=lambda r: (str(r["local_date"]), r["source_tsnumber"], r["segment_sequence"])):
        canonical_rows.append({
            "plant": row["plant"],
            "source_tsnumber": row["source_tsnumber"],
            "source_version": row["source_version"],
            "allocation_version": row["allocation_version"],
            "ready_rule_version": row.get("ready_rule_version", READY_RULE_VERSION),
            "local_date": str(row["local_date"]),
            "segment_sequence": row["segment_sequence"],
            "source_key": row["source_key"],
            "raw_seconds": row["raw_seconds"],
            "cleaned_seconds": row["cleaned_seconds"],
            "allocated_seconds": row["allocated_seconds"],
            "cap_seconds": row["cap_seconds"],
            "sap_effective_seconds": row["sap_effective_seconds"],
            "enrichment_snapshot": row.get("enrichment_snapshot", {}),
            "payload": row["payload"],
        })
    canonical_json = json.dumps(canonical_rows, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Dry-run / execute
# ---------------------------------------------------------------------------

def database_fingerprint(cur) -> str:
    """Digest tabel-tabel pipeline dan source untuk mendeteksi penulisan yang tidak sah."""
    cur.execute(
        """
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
        """
    )
    existing_tables = {r["table_name"] if isinstance(r, dict) else r[0] for r in cur.fetchall()}

    digest = hashlib.sha256()
    for table in PIPELINE_TABLES:
        if table in existing_tables:
            cur.execute(f"SELECT COUNT(*) AS c FROM public.{table}")
            digest.update(f"{table}:{scalar(cur.fetchone())}\n".encode("utf-8"))
        else:
            digest.update(f"{table}:absent\n".encode("utf-8"))

    if "timesheet_etl_run" in existing_tables:
        cur.execute(
            """
            SELECT COALESCE(md5(string_agg(run_id::text || ':' || status || ':' || input_count::text || ':' || coalesce(cleaned_segment_count::text, '') || ':' || coalesce(allocated_segment_count::text, '') || ':' || coalesce(sap_ready_count::text, ''), ',' ORDER BY run_id)), '')
            FROM public.timesheet_etl_run
            """
        )
        digest.update(f"run_md5:{scalar(cur.fetchone())}\n".encode("utf-8"))

    if "timesheet_cleaned_segment" in existing_tables:
        cur.execute(
            """
            SELECT COALESCE(md5(string_agg(cleaned_segment_id::text || ':' || source_tsnumber::text || ':' || rule_version || ':' || segment_sequence::text, ',' ORDER BY cleaned_segment_id)), '')
            FROM public.timesheet_cleaned_segment
            """
        )
        digest.update(f"clean_md5:{scalar(cur.fetchone())}\n".encode("utf-8"))

    if "timesheet_allocated_segment" in existing_tables:
        cur.execute(
            """
            SELECT COALESCE(md5(string_agg(allocated_segment_id::text || ':' || source_tsnumber::text || ':' || allocation_version || ':' || slice_start::text, ',' ORDER BY allocated_segment_id)), '')
            FROM public.timesheet_allocated_segment
            """
        )
        digest.update(f"alloc_md5:{scalar(cur.fetchone())}\n".encode("utf-8"))

    if "timesheet_sap_ready" in existing_tables:
        cur.execute(
            """
            SELECT COALESCE(md5(string_agg(sap_ready_id::text || ':' || source_key || ':' || coalesce(ready_rule_version, '') || ':' || sap_effective_seconds::text || ':' || coalesce(enrichment_snapshot::text, ''), ',' ORDER BY sap_ready_id)), '')
            FROM public.timesheet_sap_ready
            """
        )
        digest.update(f"sap_ready_md5:{scalar(cur.fetchone())}\n".encode("utf-8"))

    if "timesheet_transaction" in existing_tables:
        cur.execute(
            """
            SELECT COALESCE(md5(string_agg(tsnumber::text || ':' || coalesce(modified_at::text, ''), ',' ORDER BY tsnumber)), '')
            FROM public.timesheet_transaction
            """
        )
        digest.update(f"tx_md5:{scalar(cur.fetchone())}\n".encode("utf-8"))

    return digest.hexdigest()


def run_dry_run(
    cur,
    *,
    cfg: dict,
    dbname: str,
    from_ts: datetime,
    to_ts: datetime,
    allocation_version: str,
    clean_rule_version: str = CLEAN_RULE_VERSION,
    ready_version: str = READY_RULE_VERSION,
    quarantine_duplicates: bool = False,
) -> dict:
    before = database_fingerprint(cur)
    captured = capture_candidates(
        cur, plant=cfg["plant"], tz=cfg["timezone"], from_ts=from_ts, to_ts=to_ts
    )
    plan = build_input_plan(
        captured["rows"], plant=cfg["plant"], allocation_version=allocation_version
    )
    for i, row in enumerate(captured["rows"]):
        plan[i]["serialnumber"] = row["serialnumber"]

    in_checksum = plan_checksum(plan)

    cleaned_plan = build_cleaned_plan(
        plan,
        plant=cfg["plant"],
        plant_timezone=cfg["timezone"],
        rule_version=clean_rule_version,
        sap_rules=cfg.get("sap_rules"),
        quarantine_duplicates=quarantine_duplicates,
    )

    work_count = 0
    break_count = 0
    unknown_conf_count = 0
    canonical_counts = {"RG": 0, "OV": 0, "RW": 0}
    legacy_fallback_count = 0
    total_raw_sec = 0
    total_work_sec = 0
    total_break_sec = 0
    cap_meta_count = 0

    seen_cap_inputs = set()
    for seg in cleaned_plan:
        kind = seg["segment_kind"]
        raw = seg["raw_seconds"]
        total_raw_sec += raw

        if kind == "WORK":
            work_count += 1
            total_work_sec += raw
        elif kind == "BREAK":
            break_count += 1
            total_break_sec += raw

        c_class = seg.get("classification_source")
        c_type = seg.get("confirmation_type")
        if c_class == "UNKNOWN":
            unknown_conf_count += 1
        elif c_class == "CANONICAL" and c_type in canonical_counts:
            canonical_counts[c_type] += 1
        elif c_class == "LEGACY_FALLBACK":
            legacy_fallback_count += 1

        if seg.get("cap_seconds") is not None and seg["source_tsnumber"] not in seen_cap_inputs:
            seen_cap_inputs.add(seg["source_tsnumber"])
            cap_meta_count += 1

    # F3: Allocation
    target_work = [
        s for s in cleaned_plan
        if s.get("segment_kind") == "WORK" and s.get("is_productive") and s.get("remaining_seconds", 0) > 0
    ]
    comp_work = fetch_companion_work_segments(
        cur,
        plant=cfg["plant"],
        tz_name=cfg["timezone"],
        target_work_segments=target_work,
        from_ts=from_ts,
        to_ts=to_ts,
        clean_rule_version=clean_rule_version,
        allocation_version=allocation_version,
        sap_rules=cfg.get("sap_rules"),
        target_inputs=captured["rows"],
    )

    allocated_plan, alloc_metrics = build_allocated_plan(
        cleaned_plan,
        plant=cfg["plant"],
        allocation_version=allocation_version,
        companion_segments=comp_work,
    )

    # F4: SAP-Ready
    sap_ready_plan, sap_metrics, sap_exclusions = build_sap_ready_plan(
        plan,
        cleaned_plan,
        allocated_plan,
        plant=cfg["plant"],
        plant_timezone=cfg["timezone"],
        allocation_version=allocation_version,
        ready_version=ready_version,
        cur=cur,
        cutoff_date=cfg.get("cutoff_date"),
    )
    out_checksum = sap_ready_plan_checksum(sap_ready_plan)

    after = database_fingerprint(cur)

    if before != after:
        raise EtlError(
            "dry-run MENGUBAH database (fingerprint berubah) — mode ini wajib read-only"
        )

    return {
        "mode": "dry-run",
        "database": dbname,
        "plant": cfg["plant"],
        "plant_timezone": cfg["timezone"],
        "window": {"from_ts": from_ts.isoformat(), "to_ts": to_ts.isoformat()},
        "allocation_version": allocation_version,
        "clean_rule_version": clean_rule_version,
        "ready_rule_version": ready_version,
        "input_count": len(plan),
        "candidates": len(plan),
        "open_not_captured": captured["open_count"],
        "exclusions": captured["exclusions"],
        "invalid_interval_reported": captured["invalid_count"],
        "subsecond_reported": captured["subsecond_count"],
        "cleaned_segments": len(cleaned_plan),
        "work_segment_count": work_count,
        "break_segment_count": break_count,
        "unknown_confirmation_count": unknown_conf_count,
        "canonical_confirmation_counts": canonical_counts,
        "legacy_fallback_count": legacy_fallback_count,
        "total_raw_seconds": total_raw_sec,
        "total_work_seconds": total_work_sec,
        "total_break_seconds": total_break_sec,
        "inputs_with_cap_metadata": cap_meta_count,
        "allocated_segment_count": alloc_metrics["allocated_segment_count"],
        "target_allocated_seconds": alloc_metrics["target_allocated_seconds"],
        "companion_allocated_seconds": alloc_metrics["companion_allocated_seconds"],
        "all_allocated_seconds": alloc_metrics["all_allocated_seconds"],
        "total_union_seconds": alloc_metrics["total_union_seconds"],
        "allocation_delta_seconds": alloc_metrics["allocation_delta_seconds"],
        "operator_day_violation_count": alloc_metrics["operator_day_violation_count"],
        "sap_ready_count": sap_metrics["sap_ready_count"],
        "productive_sap_ready_count": sap_metrics["productive_sap_ready_count"],
        "non_productive_sap_ready_count": sap_metrics["non_productive_sap_ready_count"],
        "total_pre_cap_seconds": sap_metrics["total_pre_cap_seconds"],
        "total_cap_deducted_seconds": sap_metrics["total_cap_deducted_seconds"],
        "total_sap_effective_seconds": sap_metrics["total_sap_effective_seconds"],
        "total_sap_hours": sap_metrics["total_sap_hours"],
        "cap_configured_source_count": sap_metrics["cap_configured_source_count"],
        "cap_applied_source_count": sap_metrics["cap_applied_source_count"],
        "uncapped_source_count": sap_metrics["uncapped_source_count"],
        "blocked_source_count": sap_metrics["blocked_source_count"],
        "ready_invariant_violation_count": sap_metrics["ready_invariant_violation_count"],
        "blocked_seconds_per_reason": sap_metrics["blocked_seconds_per_reason"],
        "sap_ready_exclusions": sap_exclusions,
        "plan_checksum": in_checksum,
        "output_checksum": out_checksum,
        "fingerprint_before": before,
        "fingerprint_after": after,
        "wrote_rows": 0,
    }


EXECUTE_INSERT_RUN_SQL = """
INSERT INTO public.timesheet_etl_run
  (plant, from_ts, to_ts, plant_timezone, allocation_version, status,
   created_by, input_count, input_checksum)
VALUES (%(plant)s, %(from_ts)s, %(to_ts)s, %(plant_timezone)s, %(allocation_version)s,
        'CAPTURED', %(created_by)s, %(input_count)s, %(input_checksum)s)
RETURNING run_id
"""

EXECUTE_INSERT_INPUT_SQL = """
INSERT INTO public.timesheet_etl_input
  (run_id, plant, source_tsnumber, source_updated_at, source_hash, allocation_version,
   serialnumber, activitytype, order_no, operation_no, workcentercode,
   confirmationnumber, state_flag, longdate_checkin, longdate_checkout,
   raw_seconds, local_date_checkin, raw_snapshot)
VALUES
  (%(run_id)s, %(plant)s, %(source_tsnumber)s, %(source_updated_at)s, %(source_hash)s,
   %(allocation_version)s, %(serialnumber)s, %(activitytype)s, %(order_no)s,
   %(operation_no)s, %(workcentercode)s, %(confirmationnumber)s, %(state_flag)s,
   %(longdate_checkin)s, %(longdate_checkout)s, %(raw_seconds)s, %(local_date_checkin)s,
   %(raw_snapshot)s::jsonb)
ON CONFLICT ON CONSTRAINT uq_timesheet_etl_input_version DO NOTHING
RETURNING input_id
"""

EXECUTE_SELECT_INPUT_SQL = """
SELECT input_id FROM public.timesheet_etl_input
WHERE plant = %(plant)s AND source_tsnumber = %(source_tsnumber)s
  AND source_hash = %(source_hash)s AND allocation_version = %(allocation_version)s
"""

EXECUTE_LINK_SQL = """
INSERT INTO public.timesheet_etl_run_input (run_id, input_id)
VALUES (%s, %s)
ON CONFLICT (run_id, input_id) DO NOTHING
"""

EXECUTE_INSERT_CLEANED_SEGMENT_SQL = """
INSERT INTO public.timesheet_cleaned_segment
  (run_id, input_id, plant, source_tsnumber, rule_version, segment_sequence,
   segment_start, segment_end, local_date, segment_kind, confirmation_type,
   classification_source, classification_reason, is_productive, break_rule,
   cap_rule, cap_seconds, cap_category, raw_seconds, deducted_seconds,
   remaining_seconds)
VALUES
  (%(run_id)s, %(input_id)s, %(plant)s, %(source_tsnumber)s, %(rule_version)s,
   %(segment_sequence)s, %(segment_start)s, %(segment_end)s, %(local_date)s,
   %(segment_kind)s, %(confirmation_type)s, %(classification_source)s,
   %(classification_reason)s, %(is_productive)s, %(break_rule)s,
   %(cap_rule)s, %(cap_seconds)s, %(cap_category)s, %(raw_seconds)s,
   %(deducted_seconds)s, %(remaining_seconds)s)
ON CONFLICT (input_id, rule_version, segment_sequence) DO NOTHING
RETURNING cleaned_segment_id
"""

EXECUTE_SELECT_CLEANED_SEGMENT_SQL = """
SELECT
  cleaned_segment_id,
  segment_start, segment_end, local_date, segment_kind,
  confirmation_type, classification_source, classification_reason,
  is_productive, break_rule, cap_rule, cap_seconds, cap_category,
  raw_seconds, deducted_seconds, remaining_seconds
FROM public.timesheet_cleaned_segment
WHERE input_id = %(input_id)s
  AND rule_version = %(rule_version)s
  AND segment_sequence = %(segment_sequence)s
"""

EXECUTE_INSERT_ALLOCATED_SEGMENT_SQL = """
INSERT INTO public.timesheet_allocated_segment
  (run_id, cleaned_segment_id, input_id, plant, source_tsnumber,
   allocation_version, slice_start, slice_end, local_date,
   active_count, numerator, denominator, allocated_seconds)
VALUES
  (%(run_id)s, %(cleaned_segment_id)s, %(input_id)s, %(plant)s, %(source_tsnumber)s,
   %(allocation_version)s, %(slice_start)s, %(slice_end)s, %(local_date)s,
   %(active_count)s, %(numerator)s, %(denominator)s, %(allocated_seconds)s)
ON CONFLICT (cleaned_segment_id, allocation_version, slice_start) DO NOTHING
RETURNING allocated_segment_id
"""

EXECUTE_SELECT_ALLOCATED_SEGMENT_SQL = """
SELECT
  slice_end, local_date, active_count, numerator, denominator, allocated_seconds
FROM public.timesheet_allocated_segment
WHERE cleaned_segment_id = %(cleaned_segment_id)s
  AND allocation_version = %(allocation_version)s
  AND slice_start = %(slice_start)s
"""

EXECUTE_INSERT_SAP_READY_SQL = """
INSERT INTO public.timesheet_sap_ready
  (run_id, input_id, plant, source_tsnumber, source_version, allocation_version,
   ready_rule_version, local_date, segment_sequence, source_key, payload, enrichment_snapshot, raw_seconds, cleaned_seconds,
   allocated_seconds, cap_seconds, sap_effective_seconds, status)
VALUES
  (%(run_id)s, %(input_id)s, %(plant)s, %(source_tsnumber)s, %(source_version)s, %(allocation_version)s,
   %(ready_rule_version)s, %(local_date)s, %(segment_sequence)s, %(source_key)s, %(payload)s::jsonb, %(enrichment_snapshot)s::jsonb, %(raw_seconds)s, %(cleaned_seconds)s,
   %(allocated_seconds)s, %(cap_seconds)s, %(sap_effective_seconds)s, %(status)s)
ON CONFLICT ON CONSTRAINT uq_timesheet_sap_ready_identity DO NOTHING
RETURNING sap_ready_id
"""

EXECUTE_SELECT_SAP_READY_SQL = """
SELECT
  sap_ready_id, plant, source_tsnumber, source_version, allocation_version,
  ready_rule_version, local_date, segment_sequence, source_key, payload, enrichment_snapshot, raw_seconds, cleaned_seconds,
  allocated_seconds, cap_seconds, sap_effective_seconds, status
FROM public.timesheet_sap_ready
WHERE plant = %(plant)s
  AND source_tsnumber = %(source_tsnumber)s
  AND source_version = %(source_version)s
  AND allocation_version = %(allocation_version)s
  AND ready_rule_version = %(ready_rule_version)s
  AND local_date = %(local_date)s
  AND segment_sequence = %(segment_sequence)s
"""

EXECUTE_LINK_SAP_READY_SQL = """
INSERT INTO public.timesheet_etl_run_sap_ready (run_id, sap_ready_id)
VALUES (%s, %s)
ON CONFLICT (run_id, sap_ready_id) DO NOTHING
"""

EXECUTE_UPDATE_INPUT_STATUS_SQL = """
UPDATE public.timesheet_etl_input
SET status = 'SAP_READY'
WHERE input_id = ANY(%(input_ids)s::uuid[])
  AND status IN ('CAPTURED', 'CLEANED', 'ALLOCATED')
"""

EXECUTE_UPDATE_RUN_STATUS_SQL = """
UPDATE public.timesheet_etl_run
SET status = 'SAP_READY',
    cleaned_segment_count = %(cleaned_count)s,
    allocated_segment_count = %(allocated_count)s,
    sap_ready_count = %(sap_ready_count)s,
    output_checksum = %(output_checksum)s,
    finished_at = now()
WHERE run_id = %(run_id)s
"""


def preview_persisted_sap_ready(
    cur,
    *,
    plant: str,
    run_id: str | None = None,
    ready_rule_version: str = READY_RULE_VERSION,
) -> dict:
    """Preview SAP-ready rows yang sudah dipersist di timesheet_sap_ready.

    Strictly read-only: tidak menjalankan ulang F1-F4, tidak membaca timesheet_transaction.
    Bila run_id disediakan, membaca baris yang secara eksplisit terhubung ke run tersebut lewat timesheet_etl_run_sap_ready.
    """
    fp_before = database_fingerprint(cur)

    if run_id:
        cur.execute(
            """
            SELECT sr.sap_ready_id, sr.run_id, sr.input_id, sr.plant, sr.source_tsnumber, sr.source_version,
                   sr.allocation_version, sr.ready_rule_version, sr.local_date, sr.segment_sequence,
                   sr.source_key, sr.payload, sr.enrichment_snapshot, sr.raw_seconds, sr.cleaned_seconds, sr.allocated_seconds,
                   sr.cap_seconds, sr.sap_effective_seconds, sr.status
            FROM public.timesheet_sap_ready sr
            JOIN public.timesheet_etl_run_sap_ready rsr ON rsr.sap_ready_id = sr.sap_ready_id
            WHERE sr.plant = %s AND sr.ready_rule_version = %s AND rsr.run_id = %s
            ORDER BY sr.local_date, sr.source_tsnumber, sr.segment_sequence
            """,
            (plant, ready_rule_version, run_id),
        )
    else:
        cur.execute(
            """
            SELECT sr.sap_ready_id, sr.run_id, sr.input_id, sr.plant, sr.source_tsnumber, sr.source_version,
                   sr.allocation_version, sr.ready_rule_version, sr.local_date, sr.segment_sequence,
                   sr.source_key, sr.payload, sr.enrichment_snapshot, sr.raw_seconds, sr.cleaned_seconds, sr.allocated_seconds,
                   sr.cap_seconds, sr.sap_effective_seconds, sr.status
            FROM public.timesheet_sap_ready sr
            WHERE sr.plant = %s AND sr.ready_rule_version = %s
            ORDER BY sr.local_date, sr.source_tsnumber, sr.segment_sequence
            """,
            (plant, ready_rule_version),
        )
    rows = cur.fetchall()

    plan = []
    total_effective = 0
    prod_count = 0
    non_prod_count = 0
    for r in rows:
        payload = r["payload"] if isinstance(r["payload"], dict) else json.loads(r["payload"])
        snapshot = r.get("enrichment_snapshot") or {}
        if isinstance(snapshot, str):
            snapshot = json.loads(snapshot)
        total_effective += int(r["sap_effective_seconds"])
        if payload.get("ZCONF_TYPE") or (payload.get("confirmation_type") and payload.get("confirmation_type") != "NON_PRODUCTIVE"):
            prod_count += 1
        else:
            non_prod_count += 1
        plan.append({
            "plant": r["plant"],
            "source_tsnumber": r["source_tsnumber"],
            "source_version": r["source_version"],
            "allocation_version": r["allocation_version"],
            "ready_rule_version": r["ready_rule_version"],
            "local_date": r["local_date"],
            "segment_sequence": r["segment_sequence"],
            "source_key": r["source_key"],
            "raw_seconds": r["raw_seconds"],
            "cleaned_seconds": r["cleaned_seconds"],
            "allocated_seconds": r["allocated_seconds"],
            "cap_seconds": r["cap_seconds"],
            "sap_effective_seconds": r["sap_effective_seconds"],
            "enrichment_snapshot": snapshot,
            "payload": payload,
        })

    checksum = sap_ready_plan_checksum(plan)

    fp_after = database_fingerprint(cur)
    if fp_before != fp_after:
        raise EtlError("preview_persisted_sap_ready MENGUBAH database (fingerprint berubah)")

    return {
        "mode": "preview_persisted",
        "plant": plant,
        "ready_rule_version": ready_rule_version,
        "run_id": str(run_id) if run_id else None,
        "sap_ready_count": len(rows),
        "productive_sap_ready_count": prod_count,
        "non_productive_sap_ready_count": non_prod_count,
        "total_sap_effective_seconds": total_effective,
        "total_sap_hours": round(total_effective / 3600.0, 4),
        "output_checksum": checksum,
        "rows": plan,
    }


def compute_central_payload_checksum(payload: dict) -> str:
    """Hash SHA-256 deterministik dari payload SAP."""
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def preview_publish(
    cur_plant,
    *,
    plant: str,
    run_id: str | None = None,
    ready_rule_version: str = READY_RULE_VERSION,
    limit: int | None = None,
) -> dict:
    """Preview publish read-only: membaca baris timesheet_sap_ready yang siap dipublish.
    
    Menampilkan jumlah baris, payload SAP, source_key, detik, dan checksum
    yang persis sama dengan artefak SAP-ready persisted.
    Tidak mengubah state plant database ataupun central database.
    """
    fp_before = database_fingerprint(cur_plant)

    if run_id:
        cur_plant.execute(
            """
            SELECT sr.sap_ready_id, sr.run_id, sr.input_id, sr.plant, sr.source_tsnumber, sr.source_version,
                   sr.allocation_version, sr.ready_rule_version, sr.local_date, sr.segment_sequence,
                   sr.source_key, sr.payload, sr.enrichment_snapshot, sr.raw_seconds, sr.cleaned_seconds, sr.allocated_seconds,
                   sr.cap_seconds, sr.sap_effective_seconds, sr.status, sr.central_staging_id, sr.central_checksum
            FROM public.timesheet_sap_ready sr
            JOIN public.timesheet_etl_run_sap_ready rsr ON rsr.sap_ready_id = sr.sap_ready_id
            WHERE sr.plant = %s AND sr.ready_rule_version = %s AND rsr.run_id = %s
            ORDER BY sr.local_date, sr.source_tsnumber, sr.segment_sequence
            """ + (f" LIMIT {limit}" if limit else ""),
            (plant, ready_rule_version, run_id),
        )
    else:
        cur_plant.execute(
            """
            SELECT sr.sap_ready_id, sr.run_id, sr.input_id, sr.plant, sr.source_tsnumber, sr.source_version,
                   sr.allocation_version, sr.ready_rule_version, sr.local_date, sr.segment_sequence,
                   sr.source_key, sr.payload, sr.enrichment_snapshot, sr.raw_seconds, sr.cleaned_seconds, sr.allocated_seconds,
                   sr.cap_seconds, sr.sap_effective_seconds, sr.status, sr.central_staging_id, sr.central_checksum
            FROM public.timesheet_sap_ready sr
            WHERE sr.plant = %s AND sr.ready_rule_version = %s
            ORDER BY sr.local_date, sr.source_tsnumber, sr.segment_sequence
            """ + (f" LIMIT {limit}" if limit else ""),
            (plant, ready_rule_version),
        )
    rows = cur_plant.fetchall()

    plan = []
    status_counts = defaultdict(int)
    total_effective = 0
    prod_count = 0
    non_prod_count = 0

    for r in rows:
        payload = r["payload"] if isinstance(r["payload"], dict) else json.loads(r["payload"])
        snapshot = r.get("enrichment_snapshot") or {}
        if isinstance(snapshot, str):
            snapshot = json.loads(snapshot)
        total_effective += int(r["sap_effective_seconds"])
        status_counts[r["status"]] += 1
        if payload.get("ZCONF_TYPE") or (payload.get("confirmation_type") and payload.get("confirmation_type") != "NON_PRODUCTIVE"):
            prod_count += 1
        else:
            non_prod_count += 1
        plan.append({
            "plant": r["plant"],
            "source_tsnumber": r["source_tsnumber"],
            "source_version": r["source_version"],
            "allocation_version": r["allocation_version"],
            "ready_rule_version": r["ready_rule_version"],
            "local_date": str(r["local_date"]),
            "segment_sequence": r["segment_sequence"],
            "source_key": r["source_key"],
            "raw_seconds": int(r["raw_seconds"]),
            "cleaned_seconds": int(r["cleaned_seconds"]),
            "allocated_seconds": int(r["allocated_seconds"]),
            "cap_seconds": int(r["cap_seconds"]) if r["cap_seconds"] is not None else None,
            "sap_effective_seconds": int(r["sap_effective_seconds"]),
            "status": r["status"],
            "payload": payload,
            "enrichment_snapshot": snapshot,
        })

    out_checksum = sap_ready_plan_checksum(plan) if plan else "0" * 64

    fp_after = database_fingerprint(cur_plant)
    if fp_before != fp_after:
        raise EtlError("preview_publish MENGUBAH database (fingerprint berubah)")

    return {
        "mode": "preview_publish",
        "plant": plant,
        "run_id": str(run_id) if run_id else None,
        "ready_rule_version": ready_rule_version,
        "candidate_count": len(plan),
        "status_breakdown": dict(status_counts),
        "productive_count": prod_count,
        "non_productive_count": non_prod_count,
        "total_sap_effective_seconds": total_effective,
        "total_sap_hours": round(total_effective / 3600.0, 4),
        "output_checksum": out_checksum,
        "sample_source_keys": [p["source_key"] for p in plan[:5]],
    }


def assert_semantic_contract_match(candidate_row: dict, central_row: dict) -> None:
    """Bandingkan seluruh kontrak semantik antara candidate row dan central row secara ketat.
    
    Validasi:
    - payload JSON secara semantik tanpa menyamakan null dan string kosong
    - total_seconds
    - is_productive
    - source_ref_id
    - werks (plant)
    - provenance_snapshot
    """
    sk = candidate_row["source_key"]
    cand_p = candidate_row["payload"] if isinstance(candidate_row["payload"], dict) else json.loads(candidate_row["payload"])
    cent_p = central_row["payload"] if isinstance(central_row["payload"], dict) else json.loads(central_row["payload"])

    mismatches = []

    # 1. Bandingkan seluruh field SAP payload tanpa menyamakan None dan string kosong ""
    all_keys = sorted(set(cand_p.keys()) | set(cent_p.keys()))
    for k in all_keys:
        if k in ("PROVENANCE_SNAPSHOT", "ZTIMESHEETID"):
            continue  # Abaikan legacy wrapper key atau central-generated identity
        v_cand = cand_p.get(k)
        v_cent = cent_p.get(k)
        # Strict comparison: None != ""
        if v_cand != v_cent:
            mismatches.append(f"payload.{k} (central={v_cent!r} vs candidate={v_cand!r})")

    # 2. total_seconds
    cand_sec = int(candidate_row["sap_effective_seconds"])
    cent_sec = int(central_row["total_seconds"])
    if cand_sec != cent_sec:
        mismatches.append(f"total_seconds (central={cent_sec!r} vs candidate={cand_sec!r})")

    # 3. is_productive
    cand_is_prod = (cand_p.get("confirmation_type") != "NONE") and (not cand_p.get("activitytype"))
    cent_is_prod = bool(central_row["is_productive"])
    if cand_is_prod != cent_is_prod:
        mismatches.append(f"is_productive (central={cent_is_prod!r} vs candidate={cand_is_prod!r})")

    # 4. source_ref_id
    cand_ref = str(candidate_row["source_tsnumber"])
    cent_ref = str(central_row["source_ref_id"])
    if cand_ref != cent_ref:
        mismatches.append(f"source_ref_id (central={cent_ref!r} vs candidate={cand_ref!r})")

    # 5. werks / plant
    cand_werks = str(candidate_row["plant"])
    cent_werks = str(central_row["werks"])
    if cand_werks != cent_werks:
        mismatches.append(f"werks (central={cent_werks!r} vs candidate={cand_werks!r})")

    # 6. provenance_snapshot
    cand_prov = {
        "raw": int(candidate_row["raw_seconds"]),
        "cleaned": int(candidate_row["cleaned_seconds"]),
        "alloc": int(candidate_row["allocated_seconds"]),
        "cap": int(candidate_row["cap_seconds"]) if candidate_row["cap_seconds"] is not None else None,
        "sec": int(candidate_row["sap_effective_seconds"]),
        "ready_rule_version": str(candidate_row["ready_rule_version"]),
    }
    cent_prov = central_row["provenance_snapshot"] if isinstance(central_row["provenance_snapshot"], dict) else (
        json.loads(central_row["provenance_snapshot"]) if central_row["provenance_snapshot"] else {}
    )
    if cand_prov != cent_prov:
        mismatches.append(f"provenance_snapshot (central={cent_prov!r} vs candidate={cand_prov!r})")

    if mismatches:
        raise EtlError(
            f"Semantic drift terdeteksi pada central staging source_key={sk}: "
            f"perbedaan [{', '.join(mismatches)}]"
        )


def extract_central_version_tuple(row: dict) -> tuple[str, str, str] | None:
    """Ekstrak tuple (source_version, allocation_version, ready_rule_version) dari row central staging.
    
    Mengembalikan None jika source_key tidak memiliki format versi yang valid atau
    tidak cocok dengan werks / source_ref_id.
    """
    sk = str(row.get("source_key") or "")
    parts = sk.split(":")
    if len(parts) >= 5:
        if row.get("werks") and parts[0] != str(row["werks"]):
            return None
        if row.get("source_ref_id") and parts[1] != str(row["source_ref_id"]):
            return None
        return (parts[2], parts[3], parts[4])
    return None


def assert_no_version_conflicts(
    cur_plant,
    cur_central,
    *,
    plant: str,
    candidate_rows: list[dict],
) -> None:
    """Periksa semua artefak di plant DB dan central DB untuk source_tsnumber kandidat.
    
    Mendeteksi status SAP_READY, PUBLISHING, STAGED, dan POSTED.
    Jika versi lain sudah atau sedang dipublish, tolak operasi fail-closed sebelum perubahan state.
    """
    if not candidate_rows:
        return

    # 1. Validasi keunikan versi dalam batch kandidat sendiri
    ts_cand_versions = defaultdict(set)
    for r in candidate_rows:
        ts = int(r["source_tsnumber"])
        ver = (r.get("source_version"), r.get("allocation_version"), r.get("ready_rule_version"))
        ts_cand_versions[ts].add(ver)

    ambiguous_candidates = [ts for ts, vers in ts_cand_versions.items() if len(vers) > 1]
    if ambiguous_candidates:
        raise EtlError(
            f"Ambiguous active SAP_READY versions in candidate batch for source_tsnumbers: {sorted(ambiguous_candidates)}"
        )

    candidate_tsnumbers = sorted(ts_cand_versions.keys())
    ts_expected_ver = {ts: next(iter(vers)) for ts, vers in ts_cand_versions.items()}

    # 2. Periksa di Plant DB (timesheet_sap_ready): status SAP_READY, PUBLISHING, STAGED, dan POSTED
    if cur_plant:
        cur_plant.execute(
            """
            SELECT source_tsnumber, source_version, allocation_version, ready_rule_version, status, source_key
            FROM public.timesheet_sap_ready
            WHERE plant = %s AND source_tsnumber = ANY(%s)
              AND status IN ('SAP_READY', 'PUBLISHING', 'STAGED', 'POSTED')
            """,
            (plant, candidate_tsnumbers),
        )
        plant_conflicts = []
        for row in cur_plant.fetchall():
            ts = int(row["source_tsnumber"])
            row_ver = (row["source_version"], row["allocation_version"], row["ready_rule_version"])
            exp_ver = ts_expected_ver.get(ts)
            if exp_ver and row_ver != exp_ver:
                plant_conflicts.append(
                    f"tsnumber={ts} (status={row['status']}, existing_ver={row_ver} vs target_ver={exp_ver}, source_key={row['source_key']})"
                )

        if plant_conflicts:
            raise EtlError(
                f"Version conflict terdeteksi di plant DB untuk source_tsnumbers: [{'; '.join(plant_conflicts)}]. "
                "Operasi publish/reconcile dibatalkan sebelum perubahan state."
            )

    # 3. Periksa di Central DB (sap_timesheet_staging)
    if cur_central:
        cur_central.execute(
            """
            SELECT id, source_key, source_ref_id, status, werks
            FROM public.sap_timesheet_staging
            WHERE source_system = 'TIMESHEET' AND werks = %s AND source_ref_id = ANY(%s)
            """,
            (plant, [str(ts) for ts in candidate_tsnumbers]),
        )
        central_conflicts = []
        for row in cur_central.fetchall():
            ts_str = str(row["source_ref_id"])
            ts = int(ts_str) if ts_str.isdigit() else ts_str
            exp_ver = ts_expected_ver.get(ts) or ts_expected_ver.get(int(ts) if str(ts).isdigit() else ts)
            cent_ver = extract_central_version_tuple(row)
            if not cent_ver or cent_ver != exp_ver:
                sk = row["source_key"]
                st = row["status"]
                central_conflicts.append(
                    f"source_ref_id={ts} (central_status={st}, existing_central_ver={cent_ver}, existing_central_key={sk} vs target_ver={exp_ver})"
                )

        if central_conflicts:
            raise EtlError(
                f"Version conflict terdeteksi di central staging untuk source_tsnumbers: [{'; '.join(central_conflicts)}]. "
                "Versi lain sudah pernah dipublish/staged/posted ke central. Operasi dibatalkan."
            )


def transition_sap_ready_to_publishing(
    cur_plant,
    *,
    plant: str,
    candidate_rows: list[dict],
    cur_central=None,
) -> int:
    """Transisi baris timesheet_sap_ready dari SAP_READY ke PUBLISHING.
    
    Kunci field payroll pada timesheet_staging_freeze sebelum menghubungi central staging.
    Deteksi dan tolak jika ada lebih dari satu versi aktif/published untuk source_tsnumber yang sama.
    """
    if not candidate_rows:
        return 0

    assert_no_version_conflicts(cur_plant, cur_central, plant=plant, candidate_rows=candidate_rows)

    ready_ids = [r["sap_ready_id"] for r in candidate_rows]

    # 1. Kunci payroll pada timesheet_staging_freeze
    freeze_map = {}
    for r in candidate_rows:
        ts = int(r["source_tsnumber"])
        snap = {
            "raw_seconds": int(r["raw_seconds"]),
            "cleaned_seconds": int(r["cleaned_seconds"]),
            "allocated_seconds": int(r["allocated_seconds"]),
            "cap_seconds": int(r["cap_seconds"]) if r["cap_seconds"] is not None else None,
            "sap_effective_seconds": int(r["sap_effective_seconds"]),
            "ready_rule_version": str(r["ready_rule_version"]),
        }
        note = f"ETL F5 publishing {r['source_key']}"
        freeze_map[ts] = (ts, plant, "PUBLISHING", note, json.dumps(snap))

    freeze_values = list(freeze_map.values())

    psycopg2.extras.execute_values(
        cur_plant,
        """
        INSERT INTO public.timesheet_staging_freeze (tsnumber, plant, first_seen_status, frozen_at, note, allocation_snapshot)
        VALUES %s
        ON CONFLICT (tsnumber) DO UPDATE SET
          first_seen_status = CASE WHEN timesheet_staging_freeze.first_seen_status = 'STAGED' THEN 'STAGED' ELSE 'PUBLISHING' END,
          allocation_snapshot = EXCLUDED.allocation_snapshot
        """,
        freeze_values,
        template="(%s, %s, %s, now(), %s, %s::jsonb)",
        page_size=1000,
    )

    # 2. Update status timesheet_sap_ready -> PUBLISHING
    cur_plant.execute(
        """
        UPDATE public.timesheet_sap_ready
        SET status = 'PUBLISHING'
        WHERE sap_ready_id = ANY(%s::uuid[])
          AND status = 'SAP_READY'
        """,
        (ready_ids,),
    )
    return cur_plant.rowcount


def insert_central_staging_batch(
    cur_central,
    rows: list[dict],
) -> dict[str, tuple[str, str]]:
    """Insert batch ke mps_sap_staging_test idempoten berdasarkan (source_system, source_key).
    
    Membandingkan seluruh kontrak semantik pada central row yang sudah ada:
    - payload final (tanpa menyamakan null dan string kosong)
    - total_seconds
    - is_productive
    - source_ref_id
    - werks (plant)
    - provenance_snapshot
    Setelah INSERT ... ON CONFLICT DO NOTHING, membaca ulang seluruh baris central dan
    memvalidasi kembali kontrak semantik sebelum mengembalikan staging_results.
    Fail-closed bila terjadi perbedaan apa pun pada kontrak semantik.
    Returns: mapping {source_key: (str(staging_id), central_checksum)}
    """
    if not rows:
        return {}

    source_keys = [r["source_key"] for r in rows]

    # 1. Cek baris existing di central
    cur_central.execute(
        """
        SELECT id, source_key, payload, status, total_seconds, is_productive, source_ref_id, werks, provenance_snapshot
        FROM public.sap_timesheet_staging
        WHERE source_system = 'TIMESHEET' AND source_key = ANY(%s)
        """,
        (source_keys,),
    )
    existing_map = {}
    for er in cur_central.fetchall():
        sk = er["source_key"]
        p = er["payload"] if isinstance(er["payload"], dict) else json.loads(er["payload"])
        prov = er["provenance_snapshot"] if isinstance(er["provenance_snapshot"], dict) else (
            json.loads(er["provenance_snapshot"]) if er["provenance_snapshot"] else {}
        )
        existing_map[sk] = {
            "id": er["id"],
            "payload": p,
            "status": er["status"],
            "total_seconds": er["total_seconds"],
            "is_productive": er["is_productive"],
            "source_ref_id": er["source_ref_id"],
            "werks": er["werks"],
            "provenance_snapshot": prov,
        }

    results = {}
    rows_to_insert = []

    for r in rows:
        sk = r["source_key"]
        candidate_payload = r["payload"] if isinstance(r["payload"], dict) else json.loads(r["payload"])
        expected_checksum = compute_central_payload_checksum(candidate_payload)

        cand_is_productive = (candidate_payload.get("confirmation_type") != "NONE") and (not candidate_payload.get("activitytype"))
        cand_prov_snap = {
            "raw": int(r["raw_seconds"]),
            "cleaned": int(r["cleaned_seconds"]),
            "alloc": int(r["allocated_seconds"]),
            "cap": int(r["cap_seconds"]) if r["cap_seconds"] is not None else None,
            "sec": int(r["sap_effective_seconds"]),
            "ready_rule_version": str(r["ready_rule_version"]),
        }

        if sk in existing_map:
            ex = existing_map[sk]
            assert_semantic_contract_match(r, ex)
            results[sk] = (str(ex["id"]), compute_central_payload_checksum(ex["payload"]))
        else:
            rows_to_insert.append((r, candidate_payload, cand_prov_snap, cand_is_productive, expected_checksum))

    if rows_to_insert:
        insert_records = []
        for r, p, prov_snap, is_productive, _ in rows_to_insert:
            ts_start = datetime.fromisoformat(p["longdate_checkin"]) if p.get("longdate_checkin") else None
            ts_end = datetime.fromisoformat(p["longdate_checkout"]) if p.get("longdate_checkout") else None
            synth_start = ts_start.replace(tzinfo=None) if ts_start else None
            synth_end = ts_end.replace(tzinfo=None) if ts_end else None

            insert_records.append((
                "TIMESHEET",
                r["source_key"],
                False,
                str(r["source_tsnumber"]),
                r["plant"],
                p.get("PERNR", ""),
                p.get("PERNR_ORIGIN", ""),
                p.get("RUECK", ""),
                p.get("AUFNR", ""),
                p.get("VORNR", ""),
                p.get("FLGAT", ""),
                p.get("PLNFL", ""),
                p.get("VORNR_B", ""),
                p.get("VORNR_R", ""),
                p.get("ZCONF_TYPE", ""),
                p.get("ARBPL", ""),
                p.get("LSTAR", ""),
                p.get("ISDD", ""),
                p.get("ISDZ", ""),
                p.get("IEDD", ""),
                p.get("IEDZ", ""),
                p.get("AUERU", ""),
                p.get("ZBARCODEID", ""),
                json.dumps(p),
                synth_start,
                synth_start,
                synth_end,
                int(r["sap_effective_seconds"]),
                1,
                synth_start,
                synth_end,
                json.dumps(prov_snap),
                "PENDING",
            ))

        PAGE_SIZE = 1000
        for page_start in range(0, len(insert_records), PAGE_SIZE):
            page = insert_records[page_start : page_start + PAGE_SIZE]
            psycopg2.extras.execute_values(
                cur_central,
                """
                INSERT INTO public.sap_timesheet_staging (
                  source_system, source_key, is_correction, source_ref_id, werks,
                  pernr, pernr_origin, rueck, aufnr, vornr, flgat, plnfl, vornr_b, vornr_r,
                  zconf_type, arbpl, lstar, isdd, isdz, iedd, iedz, aueru, zbarcodeid,
                  payload, bucket_start, synthetic_start, synthetic_end, total_seconds,
                  source_row_count, source_min_start, source_max_end, provenance_snapshot,
                  status, created_at, updated_at
                )
                VALUES %s
                ON CONFLICT (source_system, source_key) DO NOTHING
                """,
                page,
                template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, now(), now())",
                page_size=PAGE_SIZE,
            )

        # Update payload to inject ZTIMESHEETID from central generated column ztimesheetid
        cur_central.execute(
            """
            UPDATE public.sap_timesheet_staging
            SET payload = jsonb_set(payload, '{ZTIMESHEETID}', to_jsonb(ztimesheetid)),
                updated_at = now()
            WHERE source_system = 'TIMESHEET'
              AND source_key = ANY(%s)
              AND NOT (payload ? 'ZTIMESHEETID')
            """,
            (source_keys,),
        )

        # Retrieve and strictly validate inserted/existing ids and all semantic fields
        cur_central.execute(
            """
            SELECT id, source_key, payload, status, total_seconds, is_productive, source_ref_id, werks, provenance_snapshot
            FROM public.sap_timesheet_staging
            WHERE source_system = 'TIMESHEET' AND source_key = ANY(%s)
            """,
            (source_keys,),
        )
        post_inserted_map = {}
        for res_row in cur_central.fetchall():
            sk = res_row["source_key"]
            p = res_row["payload"] if isinstance(res_row["payload"], dict) else json.loads(res_row["payload"])
            prov = res_row["provenance_snapshot"] if isinstance(res_row["provenance_snapshot"], dict) else (
                json.loads(res_row["provenance_snapshot"]) if res_row["provenance_snapshot"] else {}
            )
            post_inserted_map[sk] = {
                "id": res_row["id"],
                "payload": p,
                "status": res_row["status"],
                "total_seconds": res_row["total_seconds"],
                "is_productive": res_row["is_productive"],
                "source_ref_id": res_row["source_ref_id"],
                "werks": res_row["werks"],
                "provenance_snapshot": prov,
            }

        for r in rows:
            sk = r["source_key"]
            if sk not in post_inserted_map:
                raise EtlError(f"Baris central staging tidak ditemukan setelah insert untuk source_key={sk}")
            cent_row = post_inserted_map[sk]
            assert_semantic_contract_match(r, cent_row)
            results[sk] = (str(cent_row["id"]), compute_central_payload_checksum(cent_row["payload"]))

        # Insert provenance into sap_staging_source
        prov_records = []
        for r, p, _, _, _ in rows_to_insert:
            sk = r["source_key"]
            if sk in results:
                sid = int(results[sk][0])
                ts_start = datetime.fromisoformat(p["longdate_checkin"]) if p.get("longdate_checkin") else None
                prov_records.append((
                    sid,
                    "TIMESHEET",
                    r["plant"],
                    str(r["source_tsnumber"]),
                    ts_start,
                    int(r["sap_effective_seconds"]),
                ))

        if prov_records:
            psycopg2.extras.execute_values(
                cur_central,
                """
                INSERT INTO public.sap_staging_source (
                  staging_id, source_system, plant, source_row_id, bucket_start, seconds, created_at
                ) VALUES %s
                ON CONFLICT (staging_id, source_system, plant, source_row_id, bucket_start)
                DO UPDATE SET seconds = EXCLUDED.seconds
                WHERE sap_staging_source.posted_at IS NULL
                """,
                prov_records,
                template="(%s, %s, %s, %s, %s, %s, now())",
                page_size=1000,
            )

    return results


def finalize_sap_ready_to_staged(
    cur_plant,
    staging_results: dict[str, tuple[str, str]],
    tsnumbers: list[int],
) -> int:
    """Finalisasi baris timesheet_sap_ready dari PUBLISHING ke STAGED."""
    if not staging_results:
        return 0

    update_values = [
        (source_key, staging_id, checksum)
        for source_key, (staging_id, checksum) in staging_results.items()
    ]

    psycopg2.extras.execute_values(
        cur_plant,
        """
        UPDATE public.timesheet_sap_ready AS sr
        SET status = 'STAGED',
            published_at = now(),
            central_staging_id = v.staging_id,
            central_checksum = v.checksum
        FROM (VALUES %s) AS v(source_key, staging_id, checksum)
        WHERE sr.source_key = v.source_key
          AND sr.status = 'PUBLISHING'
        """,
        update_values,
        template="(%s, %s, %s)",
        page_size=1000,
    )
    finalized_count = cur_plant.rowcount

    if tsnumbers:
        cur_plant.execute(
            """
            UPDATE public.timesheet_staging_freeze
            SET first_seen_status = 'STAGED'
            WHERE tsnumber = ANY(%s::integer[])
              AND first_seen_status = 'PUBLISHING'
            """,
            (tsnumbers,),
        )

    return finalized_count


def reconcile_publishing_state(
    cur_plant,
    conn_plant,
    cur_central,
    conn_central,
    *,
    plant: str,
    run_id: str | None = None,
    ready_rule_version: str = READY_RULE_VERSION,
) -> dict:
    """Reconciler untuk memulihkan baris PUBLISHING yang terputus di tengah jalan.
    
    Menjamin:
    - Jika row sudah ada di central -> finalisasi plant ke STAGED tanpa duplikasi central.
    - Jika row belum ada di central -> insert ke central lalu finalisasi plant ke STAGED.
    """
    if run_id:
        cur_plant.execute(
            """
            SELECT sr.sap_ready_id, sr.run_id, sr.input_id, sr.plant, sr.source_tsnumber, sr.source_version,
                   sr.allocation_version, sr.ready_rule_version, sr.local_date, sr.segment_sequence,
                   sr.source_key, sr.payload, sr.enrichment_snapshot, sr.raw_seconds, sr.cleaned_seconds, sr.allocated_seconds,
                   sr.cap_seconds, sr.sap_effective_seconds, sr.status
            FROM public.timesheet_sap_ready sr
            JOIN public.timesheet_etl_run_sap_ready rsr ON rsr.sap_ready_id = sr.sap_ready_id
            WHERE sr.plant = %s AND sr.ready_rule_version = %s AND rsr.run_id = %s AND sr.status = 'PUBLISHING'
            ORDER BY sr.local_date, sr.source_tsnumber, sr.segment_sequence
            """,
            (plant, ready_rule_version, run_id),
        )
    else:
        cur_plant.execute(
            """
            SELECT sr.sap_ready_id, sr.run_id, sr.input_id, sr.plant, sr.source_tsnumber, sr.source_version,
                   sr.allocation_version, sr.ready_rule_version, sr.local_date, sr.segment_sequence,
                   sr.source_key, sr.payload, sr.enrichment_snapshot, sr.raw_seconds, sr.cleaned_seconds, sr.allocated_seconds,
                   sr.cap_seconds, sr.sap_effective_seconds, sr.status
            FROM public.timesheet_sap_ready sr
            WHERE sr.plant = %s AND sr.ready_rule_version = %s AND sr.status = 'PUBLISHING'
            ORDER BY sr.local_date, sr.source_tsnumber, sr.segment_sequence
            """,
            (plant, ready_rule_version),
        )
    publishing_rows = cur_plant.fetchall()
    if not publishing_rows:
        return {
            "status": "NO_OP",
            "plant": plant,
            "reconciled_count": 0,
            "already_in_central": 0,
            "newly_inserted_central": 0,
        }

    # Guard: periksa version conflict sebelum perubahan state atau insert
    assert_no_version_conflicts(cur_plant, cur_central, plant=plant, candidate_rows=publishing_rows)

    # Central insert / lookup
    staging_results = insert_central_staging_batch(cur_central, publishing_rows)
    conn_central.commit()

    # Finalize in plant
    tsnumbers = sorted({int(r["source_tsnumber"]) for r in publishing_rows})
    finalized_count = finalize_sap_ready_to_staged(cur_plant, staging_results, tsnumbers)
    conn_plant.commit()

    if run_id:
        cur_plant.execute(
            """
            SELECT count(*)
            FROM public.timesheet_sap_ready
            WHERE run_id = %s AND status NOT IN ('STAGED', 'INVALIDATED')
            """,
            (run_id,),
        )
        remaining = cur_plant.fetchone()
        rem_count = remaining["count"] if isinstance(remaining, dict) else remaining[0]
        if rem_count == 0:
            cur_plant.execute(
                """
                UPDATE public.timesheet_etl_run
                SET status = 'STAGED',
                    finished_at = now()
                WHERE run_id = %s
                """,
                (run_id,),
            )
            conn_plant.commit()

    return {
        "status": "RECONCILED",
        "plant": plant,
        "reconciled_count": finalized_count,
        "staging_ids": [sid for sid, _ in staging_results.values()],
    }


def run_publish(
    conn_plant,
    conn_central,
    *,
    plant: str,
    run_id: str | None = None,
    ready_rule_version: str = READY_RULE_VERSION,
    limit: int | None = None,
    batch_size: int = 500,
    env: str = "lab",
) -> dict:
    """Jalankan publish tahap F5 secara aman dan terisolasi."""
    if env == "prod" and not run_id:
        raise EtlError(
            "Mode prod pada --publish wajib menyertakan --run-id spesifik (dari hasil --execute) "
            "untuk mencegah publish seluruh data yang tidak terkontrol."
        )

    with conn_plant.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur_plant:
        with conn_central.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur_central:
            # 1. Assert schema
            assert_central_staging_schema(cur_central)

            # 2. Reconcile lingering PUBLISHING rows first
            reconcile_res = reconcile_publishing_state(
                cur_plant, conn_plant, cur_central, conn_central,
                plant=plant, run_id=run_id, ready_rule_version=ready_rule_version
            )

            # 3. Fetch SAP_READY candidate rows
            if run_id:
                cur_plant.execute(
                    """
                    SELECT sr.sap_ready_id, sr.run_id, sr.input_id, sr.plant, sr.source_tsnumber, sr.source_version,
                   sr.allocation_version, sr.ready_rule_version, sr.local_date, sr.segment_sequence,
                   sr.source_key, sr.payload, sr.enrichment_snapshot, sr.raw_seconds, sr.cleaned_seconds, sr.allocated_seconds,
                   sr.cap_seconds, sr.sap_effective_seconds, sr.status
                    FROM public.timesheet_sap_ready sr
                    JOIN public.timesheet_etl_run_sap_ready rsr ON rsr.sap_ready_id = sr.sap_ready_id
                    WHERE sr.plant = %s AND sr.ready_rule_version = %s AND rsr.run_id = %s AND sr.status = 'SAP_READY'
                    ORDER BY sr.local_date, sr.source_tsnumber, sr.segment_sequence
                    """ + (f" LIMIT {limit}" if limit else ""),
                    (plant, ready_rule_version, run_id),
                )
            else:
                cur_plant.execute(
                    """
                    SELECT sr.sap_ready_id, sr.run_id, sr.input_id, sr.plant, sr.source_tsnumber, sr.source_version,
                   sr.allocation_version, sr.ready_rule_version, sr.local_date, sr.segment_sequence,
                   sr.source_key, sr.payload, sr.enrichment_snapshot, sr.raw_seconds, sr.cleaned_seconds, sr.allocated_seconds,
                   sr.cap_seconds, sr.sap_effective_seconds, sr.status
                    FROM public.timesheet_sap_ready sr
                    WHERE sr.plant = %s AND sr.ready_rule_version = %s AND sr.status = 'SAP_READY'
                    ORDER BY sr.local_date, sr.source_tsnumber, sr.segment_sequence
                    """ + (f" LIMIT {limit}" if limit else ""),
                    (plant, ready_rule_version),
                )
            candidates = cur_plant.fetchall()
            if not candidates:
                if run_id:
                    cur_plant.execute(
                        """
                        SELECT count(*)
                        FROM public.timesheet_sap_ready
                        WHERE run_id = %s AND status NOT IN ('STAGED', 'INVALIDATED')
                        """,
                        (run_id,),
                    )
                    remaining = cur_plant.fetchone()
                    rem_count = remaining["count"] if isinstance(remaining, dict) else remaining[0]
                    if rem_count == 0:
                        cur_plant.execute(
                            """
                            UPDATE public.timesheet_etl_run
                            SET status = 'STAGED',
                                finished_at = now()
                            WHERE run_id = %s AND status <> 'STAGED'
                            """,
                            (run_id,),
                        )
                        conn_plant.commit()

                return {
                    "mode": "publish",
                    "plant": plant,
                    "run_id": str(run_id) if run_id else None,
                    "ready_rule_version": ready_rule_version,
                    "reconciled_count": reconcile_res.get("reconciled_count", 0),
                    "published_count": 0,
                    "total_staged_in_run": reconcile_res.get("reconciled_count", 0),
                    "staging_ids_sample": [],
                    "status": "STAGED",
                }

            # Guard: periksa version conflict sebelum transisi atau perubahan state apa pun
            assert_no_version_conflicts(cur_plant, cur_central, plant=plant, candidate_rows=candidates)

            total_published = 0
            all_staging_ids = []

            for i in range(0, len(candidates), batch_size):
                batch = candidates[i : i + batch_size]
                # Step A: Plant -> PUBLISHING & freeze
                transition_sap_ready_to_publishing(cur_plant, plant=plant, candidate_rows=batch, cur_central=cur_central)
                conn_plant.commit()

                # Step B: Central -> insert & provenance
                staging_results = insert_central_staging_batch(cur_central, batch)
                conn_central.commit()

                # Step C: Plant -> finalize to STAGED
                batch_tsnumbers = sorted({int(r["source_tsnumber"]) for r in batch})
                finalized = finalize_sap_ready_to_staged(cur_plant, staging_results, batch_tsnumbers)
                conn_plant.commit()

                total_published += finalized
                all_staging_ids.extend([sid for sid, _ in staging_results.values()])

            # Jika seluruh baris sap_ready pada run ini telah STAGED (atau INVALIDATED),
            # perbarui header run status ke 'STAGED'
            if run_id:
                cur_plant.execute(
                    """
                    SELECT count(*)
                    FROM public.timesheet_sap_ready
                    WHERE run_id = %s AND status NOT IN ('STAGED', 'INVALIDATED')
                    """,
                    (run_id,),
                )
                remaining = cur_plant.fetchone()
                rem_count = remaining["count"] if isinstance(remaining, dict) else remaining[0]
                if rem_count == 0:
                    cur_plant.execute(
                        """
                        UPDATE public.timesheet_etl_run
                        SET status = 'STAGED',
                            finished_at = now()
                        WHERE run_id = %s
                        """,
                        (run_id,),
                    )
                    conn_plant.commit()

            return {
                "mode": "publish",
                "plant": plant,
                "run_id": str(run_id) if run_id else None,
                "ready_rule_version": ready_rule_version,
                "reconciled_count": reconcile_res.get("reconciled_count", 0),
                "published_count": total_published,
                "total_staged_in_run": total_published + reconcile_res.get("reconciled_count", 0),
                "staging_ids_sample": all_staging_ids[:10],
                "status": "STAGED",
            }


def compare_with_legacy_staging(
    cur_plant,
    *,
    plant: str,
    from_ts: datetime,
    to_ts: datetime,
    cfg: dict,
    dbname: str,
    ready_version: str = READY_RULE_VERSION,
    clean_rule_version: str = CLEAN_RULE_VERSION,
    allocation_version: str = ALLOCATION_VERSION,
) -> dict:
    """Bandingkan hasil ETL baru dengan staging lama secara read-only pada window yang sama.
    
    Melaporkan perbedaan per operator, tanggal, dan source tsnumber beserta alasan eligibility.
    """
    captured = capture_candidates(
        cur_plant, plant=plant, tz=cfg["timezone"], from_ts=from_ts, to_ts=to_ts
    )
    plan = build_input_plan(
        captured["rows"], plant=cfg["plant"], allocation_version=allocation_version
    )
    for i, row in enumerate(captured["rows"]):
        plan[i]["serialnumber"] = row["serialnumber"]

    cleaned_plan = build_cleaned_plan(
        plan,
        plant=cfg["plant"],
        plant_timezone=cfg["timezone"],
        rule_version=clean_rule_version,
        sap_rules=cfg.get("sap_rules"),
    )

    # F3: Allocation
    target_work = [
        s for s in cleaned_plan
        if s.get("segment_kind") == "WORK" and s.get("is_productive") and s.get("remaining_seconds", 0) > 0
    ]
    comp_work = fetch_companion_work_segments(
        cur_plant,
        plant=cfg["plant"],
        tz_name=cfg["timezone"],
        target_work_segments=target_work,
        from_ts=from_ts,
        to_ts=to_ts,
        clean_rule_version=clean_rule_version,
        allocation_version=allocation_version,
        sap_rules=cfg.get("sap_rules"),
        target_inputs=captured["rows"],
    )

    allocated_plan, alloc_metrics = build_allocated_plan(
        cleaned_plan,
        plant=cfg["plant"],
        allocation_version=allocation_version,
        companion_segments=comp_work,
    )

    # F4: SAP-Ready
    sap_ready_plan, sap_metrics, sap_exclusions = build_sap_ready_plan(
        plan,
        cleaned_plan,
        allocated_plan,
        plant=cfg["plant"],
        plant_timezone=cfg["timezone"],
        allocation_version=allocation_version,
        ready_version=ready_version,
        cur=cur_plant,
    )

    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "legacy"))
    import stage_timesheet_transaction as stt

    orig_env = {
        k: os.environ.get(k)
        for k in ["PLANT_SSB", "DB_NAME", "DB_HOST", "DB_PORT", "DB_USER"]
    }
    os.environ["PLANT_SSB"] = plant
    os.environ["DB_NAME"] = dbname
    os.environ["DB_HOST"] = "localhost"
    os.environ["DB_PORT"] = "5432"
    os.environ["DB_USER"] = os.environ.get("MPS2_ETL_USER", "postgres")
    try:
        legacy_rows, legacy_blocked = stt.fetch_rows(from_ts=from_ts, to_ts=to_ts, limit=100000)
        legacy_by_ts = {}
        for r in legacy_rows:
            ts = int(r["source_ref_id"])
            legacy_by_ts[ts] = {
                "tsnumber": ts,
                "serialnumber": str(r.get("serialnumber") or ""),
                "sap_effective_seconds": int(r.get("total_seconds") or (r.get("provenance_snapshot") or {}).get("sec") or 0),
                "zconf_type": str(r.get("zconf_type") or ""),
                "date": str(r.get("isdd") or ""),
            }
    finally:
        for k, v in orig_env.items():
            if v is not None:
                os.environ[k] = v
            else:
                os.environ.pop(k, None)

    new_by_ts = {}
    for r in sap_ready_plan:
        ts = int(r["source_tsnumber"])
        payload = r["payload"] if isinstance(r["payload"], dict) else json.loads(r["payload"])
        sec = int(r["sap_effective_seconds"])
        op = str(payload.get("PERNR_ORIGIN") or payload.get("PERNR") or "")
        conf_type = str(payload.get("confirmation_type") or payload.get("ZCONF_TYPE") or "")
        dt = str(r["local_date"])
        seq = int(r.get("segment_sequence", 1))

        if ts not in new_by_ts:
            new_by_ts[ts] = {
                "tsnumber": ts,
                "serialnumber": op,
                "sap_effective_seconds": 0,
                "confirmation_type": conf_type,
                "date": dt,
                "fragments": [],
            }
        new_by_ts[ts]["sap_effective_seconds"] += sec
        new_by_ts[ts]["fragments"].append({
            "local_date": dt,
            "segment_sequence": seq,
            "sap_effective_seconds": sec,
            "source_key": r.get("source_key"),
            "confirmation_type": conf_type,
        })

    all_ts = sorted(set(legacy_by_ts.keys()) | set(new_by_ts.keys()))
    
    exact_match = 0
    seconds_diff = 0
    in_legacy_only = 0
    in_new_only = 0
    
    operator_diffs = defaultdict(lambda: {"legacy_sec": 0, "new_sec": 0, "legacy_count": 0, "new_count": 0, "reasons": set()})
    date_diffs = defaultdict(lambda: {"legacy_sec": 0, "new_sec": 0, "legacy_count": 0, "new_count": 0})
    discrepancy_samples = []

    for ts in all_ts:
        leg = legacy_by_ts.get(ts)
        nw = new_by_ts.get(ts)

        if leg and nw:
            if leg["sap_effective_seconds"] == nw["sap_effective_seconds"]:
                exact_match += 1
            else:
                seconds_diff += 1
                op = nw["serialnumber"] or leg["serialnumber"]
                dt = nw["date"] or leg["date"]
                operator_diffs[op]["legacy_sec"] += leg["sap_effective_seconds"]
                operator_diffs[op]["new_sec"] += nw["sap_effective_seconds"]
                operator_diffs[op]["legacy_count"] += 1
                operator_diffs[op]["new_count"] += 1
                operator_diffs[op]["reasons"].add("ALLOCATION_OR_CAP_DIVERGENCE")
                
                # Attribusikan date_diffs per fragment jika ada
                if nw.get("fragments"):
                    for frag in nw["fragments"]:
                        date_diffs[frag["local_date"]]["new_sec"] += frag["sap_effective_seconds"]
                else:
                    date_diffs[dt]["new_sec"] += nw["sap_effective_seconds"]
                date_diffs[dt]["new_count"] += 1
                
                date_diffs[leg["date"]]["legacy_sec"] += leg["sap_effective_seconds"]
                date_diffs[leg["date"]]["legacy_count"] += 1

                if len(discrepancy_samples) < 20:
                    sample = {
                        "tsnumber": ts,
                        "operator": op,
                        "date": dt,
                        "type": "SECONDS_DIFF",
                        "legacy_sec": leg["sap_effective_seconds"],
                        "new_sec": nw["sap_effective_seconds"],
                        "delta_sec": nw["sap_effective_seconds"] - leg["sap_effective_seconds"],
                    }
                    if nw.get("fragments") and len(nw["fragments"]) > 1:
                        sample["fragments"] = nw["fragments"]
                    discrepancy_samples.append(sample)
        elif leg and not nw:
            in_legacy_only += 1
            op = leg["serialnumber"]
            dt = leg["date"]
            operator_diffs[op]["legacy_sec"] += leg["sap_effective_seconds"]
            operator_diffs[op]["legacy_count"] += 1
            date_diffs[dt]["legacy_sec"] += leg["sap_effective_seconds"]
            date_diffs[dt]["legacy_count"] += 1
            if len(discrepancy_samples) < 20:
                discrepancy_samples.append({
                    "tsnumber": ts,
                    "operator": op,
                    "date": dt,
                    "type": "LEGACY_ONLY",
                    "legacy_sec": leg["sap_effective_seconds"],
                    "new_sec": 0,
                    "reason_in_new": "EXCLUDED_IN_NEW_PIPELINE",
                })
        elif nw and not leg:
            in_new_only += 1
            op = nw["serialnumber"]
            dt = nw["date"]
            operator_diffs[op]["new_sec"] += nw["sap_effective_seconds"]
            operator_diffs[op]["new_count"] += 1
            if nw.get("fragments"):
                for frag in nw["fragments"]:
                    date_diffs[frag["local_date"]]["new_sec"] += frag["sap_effective_seconds"]
            else:
                date_diffs[dt]["new_sec"] += nw["sap_effective_seconds"]
            date_diffs[dt]["new_count"] += 1
            if len(discrepancy_samples) < 20:
                sample = {
                    "tsnumber": ts,
                    "operator": op,
                    "date": dt,
                    "type": "NEW_ONLY",
                    "legacy_sec": 0,
                    "new_sec": nw["sap_effective_seconds"],
                }
                if nw.get("fragments") and len(nw["fragments"]) > 1:
                    sample["fragments"] = nw["fragments"]
                discrepancy_samples.append(sample)

    return {
        "mode": "compare_legacy",
        "plant": plant,
        "window": {"from_ts": from_ts.isoformat(), "to_ts": to_ts.isoformat()},
        "summary": {
            "total_evaluated_tsnumbers": len(all_ts),
            "new_sap_ready_count": sap_metrics["sap_ready_count"],
            "legacy_staging_count": len(legacy_by_ts),
            "exact_match_count": exact_match,
            "seconds_difference_count": seconds_diff,
            "in_legacy_only_count": in_legacy_only,
            "in_new_only_count": in_new_only,
            "new_pipeline_exclusions": sap_exclusions,
            "new_pipeline_capture_exclusions": captured["exclusions"],
        },
        "discrepancy_samples": discrepancy_samples,
    }


def run_execute(
    cur,
    conn,
    *,
    cfg: dict,
    dbname: str,
    from_ts: datetime,
    to_ts: datetime,
    allocation_version: str,
    clean_rule_version: str = CLEAN_RULE_VERSION,
    ready_version: str = READY_RULE_VERSION,
    created_by: str,
    quarantine_duplicates: bool = False,
) -> dict:
    """Buat satu run manifest, snapshot input, cleaned segments, allocated segments, dan sap ready. Satu transaksi atomik."""
    captured = capture_candidates(
        cur, plant=cfg["plant"], tz=cfg["timezone"], from_ts=from_ts, to_ts=to_ts
    )
    plan = build_input_plan(
        captured["rows"], plant=cfg["plant"], allocation_version=allocation_version
    )
    for i, row in enumerate(captured["rows"]):
        plan[i]["serialnumber"] = row["serialnumber"]

    in_checksum = plan_checksum(plan)

    cur.execute(
        EXECUTE_INSERT_RUN_SQL,
        {
            "plant": cfg["plant"],
            "from_ts": from_ts,
            "to_ts": to_ts,
            "plant_timezone": cfg["timezone"],
            "allocation_version": allocation_version,
            "created_by": created_by,
            "input_count": len(plan),
            "input_checksum": in_checksum,
        },
    )
    run_id = scalar(cur.fetchone())

    inserted_inputs = 0
    linked_inputs = 0
    resolved_inputs = []
    input_ids = []

    for item in plan:
        params = dict(item)
        params["run_id"] = run_id
        params["plant"] = cfg["plant"]
        cur.execute(EXECUTE_INSERT_INPUT_SQL, params)
        row = cur.fetchone()
        if row is not None:
            input_id = scalar(row)
            inserted_inputs += 1
        else:
            cur.execute(EXECUTE_SELECT_INPUT_SQL, params)
            existing = cur.fetchone()
            if not existing:
                raise EtlError(
                    f"konflik unique input tanpa baris yang cocok untuk tsnumber {item['source_tsnumber']}"
                )
            input_id = scalar(existing)
        cur.execute(EXECUTE_LINK_SQL, (run_id, input_id))
        linked_inputs += 1
        input_ids.append(input_id)

        resolved_item = dict(item)
        resolved_item["input_id"] = input_id
        resolved_inputs.append(resolved_item)

    reused_inputs = len(plan) - inserted_inputs

    # F2: Cleansing
    cleaned_plan = build_cleaned_plan(
        resolved_inputs,
        plant=cfg["plant"],
        plant_timezone=cfg["timezone"],
        rule_version=clean_rule_version,
        sap_rules=cfg.get("sap_rules"),
        quarantine_duplicates=quarantine_duplicates,
        cur=cur,
    )

    inserted_segments = 0
    reused_segments = 0

    work_count = 0
    break_count = 0
    unknown_conf_count = 0
    canonical_counts = {"RG": 0, "OV": 0, "RW": 0}
    legacy_fallback_count = 0
    total_raw_sec = 0
    total_work_sec = 0
    total_break_sec = 0
    cap_meta_count = 0

    seen_cap_inputs = set()
    for seg in cleaned_plan:
        seg_params = dict(seg)
        seg_params["run_id"] = run_id
        cur.execute(EXECUTE_INSERT_CLEANED_SEGMENT_SQL, seg_params)
        seg_row = cur.fetchone()
        if seg_row is not None:
            seg["cleaned_segment_id"] = scalar(seg_row)
            inserted_segments += 1
        else:
            # Conflict pada (input_id, rule_version, segment_sequence)
            cur.execute(EXECUTE_SELECT_CLEANED_SEGMENT_SQL, seg_params)
            existing = cur.fetchone()
            if not existing:
                raise EtlError(
                    f"konflik unique cleaned_segment tanpa baris yang cocok untuk input_id "
                    f"{seg['input_id']}, seq {seg['segment_sequence']}"
                )
            seg["cleaned_segment_id"] = scalar(existing)

            # Bandingkan seluruh field semantik
            mismatches = []
            if _canonical_value(existing["segment_start"]) != _canonical_value(seg["segment_start"]):
                mismatches.append(f"segment_start (DB={existing['segment_start']!r} vs plan={seg['segment_start']!r})")
            if _canonical_value(existing["segment_end"]) != _canonical_value(seg["segment_end"]):
                mismatches.append(f"segment_end (DB={existing['segment_end']!r} vs plan={seg['segment_end']!r})")
            if str(existing["local_date"]) != str(seg["local_date"]):
                mismatches.append(f"local_date (DB={existing['local_date']!r} vs plan={seg['local_date']!r})")
            if existing["segment_kind"] != seg["segment_kind"]:
                mismatches.append(f"segment_kind (DB={existing['segment_kind']!r} vs plan={seg['segment_kind']!r})")
            if (existing["confirmation_type"] or None) != (seg["confirmation_type"] or None):
                mismatches.append(f"confirmation_type (DB={existing['confirmation_type']!r} vs plan={seg['confirmation_type']!r})")
            if (existing["classification_source"] or None) != (seg["classification_source"] or None):
                mismatches.append(f"classification_source (DB={existing['classification_source']!r} vs plan={seg['classification_source']!r})")
            if (existing["classification_reason"] or None) != (seg["classification_reason"] or None):
                mismatches.append(f"classification_reason (DB={existing['classification_reason']!r} vs plan={seg['classification_reason']!r})")
            if bool(existing["is_productive"]) != bool(seg["is_productive"]):
                mismatches.append(f"is_productive (DB={existing['is_productive']!r} vs plan={seg['is_productive']!r})")
            if (existing["break_rule"] or None) != (seg["break_rule"] or None):
                mismatches.append(f"break_rule (DB={existing['break_rule']!r} vs plan={seg['break_rule']!r})")
            if (existing["cap_rule"] or None) != (seg["cap_rule"] or None):
                mismatches.append(f"cap_rule (DB={existing['cap_rule']!r} vs plan={seg['cap_rule']!r})")

            db_cap_sec = int(existing["cap_seconds"]) if existing["cap_seconds"] is not None else None
            plan_cap_sec = int(seg["cap_seconds"]) if seg["cap_seconds"] is not None else None
            if db_cap_sec != plan_cap_sec:
                mismatches.append(f"cap_seconds (DB={db_cap_sec!r} vs plan={plan_cap_sec!r})")

            if (existing["cap_category"] or None) != (seg["cap_category"] or None):
                mismatches.append(f"cap_category (DB={existing['cap_category']!r} vs plan={seg['cap_category']!r})")
            if int(existing["raw_seconds"]) != int(seg["raw_seconds"]):
                mismatches.append(f"raw_seconds (DB={existing['raw_seconds']!r} vs plan={seg['raw_seconds']!r})")
            if int(existing["deducted_seconds"]) != int(seg["deducted_seconds"]):
                mismatches.append(f"deducted_seconds (DB={existing['deducted_seconds']!r} vs plan={seg['deducted_seconds']!r})")
            if int(existing["remaining_seconds"]) != int(seg["remaining_seconds"]):
                mismatches.append(f"remaining_seconds (DB={existing['remaining_seconds']!r} vs plan={seg['remaining_seconds']!r})")

            if mismatches:
                raise EtlError(
                    f"Drift terdeteksi pada cleaned_segment input_id={seg['input_id']}, seq={seg['segment_sequence']}: "
                    f"perbedaan field [{', '.join(mismatches)}]"
                )
            reused_segments += 1

        kind = seg["segment_kind"]
        raw = seg["raw_seconds"]
        total_raw_sec += raw

        if kind == "WORK":
            work_count += 1
            total_work_sec += raw
        elif kind == "BREAK":
            break_count += 1
            total_break_sec += raw

        c_class = seg.get("classification_source")
        c_type = seg.get("confirmation_type")
        if c_class == "UNKNOWN":
            unknown_conf_count += 1
        elif c_class == "CANONICAL" and c_type in canonical_counts:
            canonical_counts[c_type] += 1
        elif c_class == "LEGACY_FALLBACK":
            legacy_fallback_count += 1

        if seg.get("cap_seconds") is not None and seg["source_tsnumber"] not in seen_cap_inputs:
            seen_cap_inputs.add(seg["source_tsnumber"])
            cap_meta_count += 1

    # F3: Allocation
    target_work = [
        s for s in cleaned_plan
        if s.get("segment_kind") == "WORK" and s.get("is_productive") and s.get("remaining_seconds", 0) > 0
    ]
    comp_work = fetch_companion_work_segments(
        cur,
        plant=cfg["plant"],
        tz_name=cfg["timezone"],
        target_work_segments=target_work,
        from_ts=from_ts,
        to_ts=to_ts,
        clean_rule_version=clean_rule_version,
        allocation_version=allocation_version,
        sap_rules=cfg.get("sap_rules"),
        target_inputs=resolved_inputs,
    )

    allocated_plan, alloc_metrics = build_allocated_plan(
        cleaned_plan,
        plant=cfg["plant"],
        allocation_version=allocation_version,
        companion_segments=comp_work,
    )

    inserted_allocated = 0
    reused_allocated = 0

    for alloc_seg in allocated_plan:
        alloc_params = dict(alloc_seg)
        alloc_params["run_id"] = run_id
        cur.execute(EXECUTE_INSERT_ALLOCATED_SEGMENT_SQL, alloc_params)
        alloc_row = cur.fetchone()
        if alloc_row is not None:
            inserted_allocated += 1
        else:
            cur.execute(EXECUTE_SELECT_ALLOCATED_SEGMENT_SQL, alloc_params)
            existing = cur.fetchone()
            if not existing:
                raise EtlError(
                    f"konflik unique allocated_segment tanpa baris yang cocok untuk cleaned_segment_id "
                    f"{alloc_seg['cleaned_segment_id']}, slice_start {alloc_seg['slice_start']}"
                )

            mismatches = []
            if _canonical_value(existing["slice_end"]) != _canonical_value(alloc_seg["slice_end"]):
                mismatches.append(f"slice_end (DB={existing['slice_end']!r} vs plan={alloc_seg['slice_end']!r})")
            if str(existing["local_date"]) != str(alloc_seg["local_date"]):
                mismatches.append(f"local_date (DB={existing['local_date']!r} vs plan={alloc_seg['local_date']!r})")
            if int(existing["active_count"]) != int(alloc_seg["active_count"]):
                mismatches.append(f"active_count (DB={existing['active_count']!r} vs plan={alloc_seg['active_count']!r})")
            if int(existing["numerator"]) != int(alloc_seg["numerator"]):
                mismatches.append(f"numerator (DB={existing['numerator']!r} vs plan={alloc_seg['numerator']!r})")
            if int(existing["denominator"]) != int(alloc_seg["denominator"]):
                mismatches.append(f"denominator (DB={existing['denominator']!r} vs plan={alloc_seg['denominator']!r})")
            if int(existing["allocated_seconds"]) != int(alloc_seg["allocated_seconds"]):
                mismatches.append(f"allocated_seconds (DB={existing['allocated_seconds']!r} vs plan={alloc_seg['allocated_seconds']!r})")

            if mismatches:
                raise EtlError(
                    f"Drift terdeteksi pada allocated_segment cleaned_segment_id={alloc_seg['cleaned_segment_id']}, "
                    f"slice_start={alloc_seg['slice_start']}: perbedaan field [{', '.join(mismatches)}]"
                )
            reused_allocated += 1

    # F4: SAP-Ready
    sap_ready_plan, sap_metrics, sap_exclusions = build_sap_ready_plan(
        resolved_inputs,
        cleaned_plan,
        allocated_plan,
        plant=cfg["plant"],
        plant_timezone=cfg["timezone"],
        allocation_version=allocation_version,
        ready_version=ready_version,
        cur=cur,
        cutoff_date=cfg.get("cutoff_date"),
    )
    out_checksum = sap_ready_plan_checksum(sap_ready_plan)

    inserted_sap_ready = 0
    reused_sap_ready = 0
    linked_sap_ready = 0

    for ready_row in sap_ready_plan:
        ready_params = dict(ready_row)
        ready_params["run_id"] = run_id
        ready_params["ready_rule_version"] = ready_version
        ready_params["payload"] = json.dumps(ready_row["payload"])
        ready_params["enrichment_snapshot"] = json.dumps(ready_row.get("enrichment_snapshot", {}))
        cur.execute(EXECUTE_INSERT_SAP_READY_SQL, ready_params)
        ready_res = cur.fetchone()
        if ready_res is not None:
            sap_ready_id = scalar(ready_res)
            inserted_sap_ready += 1
        else:
            cur.execute(EXECUTE_SELECT_SAP_READY_SQL, ready_params)
            existing = cur.fetchone()
            if not existing:
                raise EtlError(
                    f"konflik unique sap_ready tanpa baris yang cocok untuk source_key {ready_row['source_key']}"
                )
            sap_ready_id = scalar(existing)

            mismatches = []
            if str(existing["ready_rule_version"]) != str(ready_row["ready_rule_version"]):
                mismatches.append(f"ready_rule_version (DB={existing['ready_rule_version']!r} vs plan={ready_row['ready_rule_version']!r})")
            if str(existing["source_key"]) != str(ready_row["source_key"]):
                mismatches.append(f"source_key (DB={existing['source_key']!r} vs plan={ready_row['source_key']!r})")
            if int(existing["raw_seconds"]) != int(ready_row["raw_seconds"]):
                mismatches.append(f"raw_seconds (DB={existing['raw_seconds']!r} vs plan={ready_row['raw_seconds']!r})")
            if int(existing["cleaned_seconds"]) != int(ready_row["cleaned_seconds"]):
                mismatches.append(f"cleaned_seconds (DB={existing['cleaned_seconds']!r} vs plan={ready_row['cleaned_seconds']!r})")
            if int(existing["allocated_seconds"]) != int(ready_row["allocated_seconds"]):
                mismatches.append(f"allocated_seconds (DB={existing['allocated_seconds']!r} vs plan={ready_row['allocated_seconds']!r})")
            db_cap = int(existing["cap_seconds"]) if existing["cap_seconds"] is not None else None
            plan_cap = int(ready_row["cap_seconds"]) if ready_row["cap_seconds"] is not None else None
            if db_cap != plan_cap:
                mismatches.append(f"cap_seconds (DB={db_cap!r} vs plan={plan_cap!r})")
            if int(existing["sap_effective_seconds"]) != int(ready_row["sap_effective_seconds"]):
                mismatches.append(f"sap_effective_seconds (DB={existing['sap_effective_seconds']!r} vs plan={ready_row['sap_effective_seconds']!r})")

            db_payload = existing["payload"] if isinstance(existing["payload"], dict) else json.loads(existing["payload"])
            if db_payload != ready_row["payload"]:
                mismatches.append("payload")

            db_snapshot = existing.get("enrichment_snapshot") or {}
            if isinstance(db_snapshot, str):
                db_snapshot = json.loads(db_snapshot)
            if db_snapshot != ready_row.get("enrichment_snapshot", {}):
                mismatches.append("enrichment_snapshot")

            if mismatches:
                raise EtlError(
                    f"Drift terdeteksi pada timesheet_sap_ready source_key={ready_row['source_key']}: "
                    f"perbedaan field [{', '.join(mismatches)}]"
                )
            reused_sap_ready += 1

        cur.execute(EXECUTE_LINK_SAP_READY_SQL, (run_id, sap_ready_id))
        linked_sap_ready += 1

    # Update input rows to SAP_READY
    if input_ids:
        cur.execute(EXECUTE_UPDATE_INPUT_STATUS_SQL, {"input_ids": input_ids})

    # Update run row to SAP_READY
    cur.execute(
        EXECUTE_UPDATE_RUN_STATUS_SQL,
        {
            "run_id": run_id,
            "cleaned_count": len(cleaned_plan),
            "allocated_count": len(allocated_plan),
            "sap_ready_count": len(sap_ready_plan),
            "output_checksum": out_checksum,
        },
    )

    conn.commit()

    return {
        "mode": "execute",
        "database": dbname,
        "run_id": str(run_id),
        "plant": cfg["plant"],
        "plant_timezone": cfg["timezone"],
        "window": {"from_ts": from_ts.isoformat(), "to_ts": to_ts.isoformat()},
        "allocation_version": allocation_version,
        "clean_rule_version": clean_rule_version,
        "ready_rule_version": ready_version,
        "input_count": len(plan),
        "candidates": len(plan),
        "inserted": inserted_inputs,
        "reused": reused_inputs,
        "linked": linked_inputs,
        "inserted_inputs": inserted_inputs,
        "reused_inputs": reused_inputs,
        "linked_inputs": linked_inputs,
        "cleaned_segments": len(cleaned_plan),
        "inserted_segments": inserted_segments,
        "reused_segments": reused_segments,
        "allocated_segments": len(allocated_plan),
        "inserted_allocated": inserted_allocated,
        "reused_allocated": reused_allocated,
        "sap_ready_count": sap_metrics["sap_ready_count"],
        "inserted_sap_ready": inserted_sap_ready,
        "reused_sap_ready": reused_sap_ready,
        "linked_sap_ready": linked_sap_ready,
        "productive_sap_ready_count": sap_metrics["productive_sap_ready_count"],
        "non_productive_sap_ready_count": sap_metrics["non_productive_sap_ready_count"],
        "total_pre_cap_seconds": sap_metrics["total_pre_cap_seconds"],
        "total_cap_deducted_seconds": sap_metrics["total_cap_deducted_seconds"],
        "total_sap_effective_seconds": sap_metrics["total_sap_effective_seconds"],
        "total_sap_hours": sap_metrics["total_sap_hours"],
        "cap_configured_source_count": sap_metrics["cap_configured_source_count"],
        "cap_applied_source_count": sap_metrics["cap_applied_source_count"],
        "uncapped_source_count": sap_metrics["uncapped_source_count"],
        "blocked_source_count": sap_metrics["blocked_source_count"],
        "ready_invariant_violation_count": sap_metrics["ready_invariant_violation_count"],
        "blocked_seconds_per_reason": sap_metrics["blocked_seconds_per_reason"],
        "sap_ready_exclusions": sap_exclusions,
        "work_segment_count": work_count,
        "break_segment_count": break_count,
        "unknown_confirmation_count": unknown_conf_count,
        "canonical_confirmation_counts": canonical_counts,
        "legacy_fallback_count": legacy_fallback_count,
        "total_raw_seconds": total_raw_sec,
        "total_work_seconds": total_work_sec,
        "total_break_seconds": total_break_sec,
        "inputs_with_cap_metadata": cap_meta_count,
        "allocated_segment_count": alloc_metrics["allocated_segment_count"],
        "target_allocated_seconds": alloc_metrics["target_allocated_seconds"],
        "companion_allocated_seconds": alloc_metrics["companion_allocated_seconds"],
        "all_allocated_seconds": alloc_metrics["all_allocated_seconds"],
        "total_union_seconds": alloc_metrics["total_union_seconds"],
        "allocation_delta_seconds": alloc_metrics["allocation_delta_seconds"],
        "operator_day_violation_count": alloc_metrics["operator_day_violation_count"],
        "open_not_captured": captured["open_count"],
        "exclusions": captured["exclusions"],
        "invalid_interval_reported": captured["invalid_count"],
        "subsecond_reported": captured["subsecond_count"],
        "plan_checksum": in_checksum,
        "output_checksum": out_checksum,
        "wrote_rows": inserted_inputs + linked_inputs + inserted_segments + inserted_allocated + inserted_sap_ready + linked_sap_ready + 1,
        "status": "SAP_READY",
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_tz_aware(value: str) -> datetime:
    """Terima ISO8601 yang WAJIB punya offset. Naif ditolak, bukan ditebak."""
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"timestamp tidak dapat dibaca: {value!r} ({exc})")
    if parsed.tzinfo is None:
        raise argparse.ArgumentTypeError(
            f"timestamp wajib timezone-aware (mis. 2026-09-01T00:00:00+07:00): {value!r}"
        )
    return parsed


def resolve_auto_window(
    cur,
    *,
    plant: str,
    tz_name: str,
    cutoff_date: date | None = None,
) -> tuple[datetime, datetime] | None:
    """Tentukan window otomatis:
    from_ts: max(to_ts) dari run STAGED sebelumnya untuk plant ini.
             Dibatasi tidak boleh mundur sebelum plant cutoff_date.
             Jika belum ada run STAGED, gunakan plant cutoff_date jam 00:00:00.
    to_ts: awal hari ini pada timezone plant (midnight hari berjalan).
    """
    from datetime import time as dt_time
    tz = ZoneInfo(tz_name)
    now = datetime.now(tz)
    today_midnight = datetime.combine(now.date(), dt_time.min, tzinfo=tz)

    if cutoff_date is None:
        cur.execute(
            """
            SELECT timesheet_allocation_cutoff_date
            FROM public.plant_config
            WHERE plant_code = %s
            ORDER BY id LIMIT 1
            """,
            (plant,),
        )
        c_row = cur.fetchone()
        cutoff_date = c_row.get("timesheet_allocation_cutoff_date") if isinstance(c_row, dict) else (c_row[0] if c_row else None)

    if not cutoff_date:
        raise EtlError(
            f"timesheet_allocation_cutoff_date belum dikonfigurasi di plant_config untuk plant {plant} "
            "— menolak menentukan window otomatis tanpa cutoff."
        )

    cutoff_dt = datetime.combine(cutoff_date, dt_time.min, tzinfo=tz)

    cur.execute(
        """
        SELECT max(to_ts) AS last_to
        FROM public.timesheet_etl_run
        WHERE plant = %s AND status = 'STAGED'
        """,
        (plant,),
    )
    row = cur.fetchone()
    last_to = row["last_to"] if row and row.get("last_to") else None

    if last_to:
        if last_to.tzinfo is None:
            last_to = last_to.replace(tzinfo=tz)
        # Invariant: max(to_ts) run lama TIDAK boleh menarik proses kembali sebelum cutoff
        last_to = max(last_to, cutoff_dt)
    else:
        last_to = cutoff_dt

    if last_to >= today_midnight:
        return None

    return last_to, today_midnight


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="ETL timesheet berlapis — F1 capture + F2 cleansing + F3 allocation + F4 SAP-ready + F5 publish (lab & prod)."
    )
    parser.add_argument("--plant", required=True, help="plant code, mis. 5100 atau 5051")
    parser.add_argument(
        "--env",
        choices=["lab", "prod"],
        default="lab",
        help="lingkungan eksekusi: 'lab' (loopback DB test lokal) atau 'prod' (TLS + env vars). Default: 'lab'",
    )
    parser.add_argument("--from-ts", required=False, type=parse_tz_aware,
                        help="awal window (inklusif), ISO8601 dengan offset")
    parser.add_argument("--to-ts", required=False, type=parse_tz_aware,
                        help="akhir window (eksklusif), ISO8601 dengan offset")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true",
                      help="hanya SELECT dan kalkulasi in-memory; tidak menulis apa pun")
    mode.add_argument("--execute", action="store_true",
                      help="buat run manifest, snapshot input, cleaned segments, allocated segments, dan sap-ready")
    mode.add_argument("--stage", action="store_true",
                      help="jalankan pipeline lengkap dari awal (capture raw) sampai staging (publish ke central staging)")
    mode.add_argument("--preview-persisted", action="store_true",
                      help="baca langsung timesheet_sap_ready tanpa menjalankan ulang pipeline")
    mode.add_argument("--preview-publish", action="store_true",
                      help="preview read-only payload dan kandidat publish ke central staging")
    mode.add_argument("--publish", action="store_true",
                      help="publish timesheet_sap_ready ke central staging (mps_sap_staging_test)")
    mode.add_argument("--reconcile", action="store_true",
                      help="pulihkan baris dengan status PUBLISHING yang belum final")
    mode.add_argument("--compare-legacy", action="store_true",
                      help="bandingkan hasil pipeline baru dengan staging lama secara read-only")
    parser.add_argument("--auto-window", action="store_true",
                        help="hitung otomatis window dari run STAGED terakhir sampai batas hari selesai")
    parser.add_argument("--quarantine-duplicates", action="store_true",
                        help="karantina (INVALIDATED) record duplikat aktivitas produktif alih-alih membatalkan seluruh run")
    parser.add_argument("--run-id", default=None,
                      help="filter run_id spesifik untuk preview, publish, atau reconcile")
    parser.add_argument("--limit", type=int, default=None,
                      help="batasi jumlah baris yang diproses / dipublish")
    parser.add_argument("--batch-size", type=int, default=500,
                      help="ukuran batch insert central staging (default 500)")
    parser.add_argument("--central-db", default=DEFAULT_CENTRAL_DB,
                      help=f"nama database central staging lokal (default {DEFAULT_CENTRAL_DB})")
    parser.add_argument("--allocation-version", default=ALLOCATION_VERSION,
                        help=f"versi aturan alokasi (default {ALLOCATION_VERSION})")
    parser.add_argument("--clean-rule-version", default=CLEAN_RULE_VERSION,
                        help=f"versi aturan cleansing (default {CLEAN_RULE_VERSION})")
    parser.add_argument("--ready-version", default=READY_RULE_VERSION,
                        help=f"versi aturan sap-ready (default {READY_RULE_VERSION})")
    parser.add_argument("--created-by", default=None,
                        help="aktor yang tercatat pada run manifest (default: user OS)")
    parser.add_argument("--json", action="store_true", help="cetak ringkasan sebagai JSON")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    needs_window = (args.dry_run or args.execute or args.compare_legacy or args.stage) and not args.auto_window
    if needs_window:
        if not args.from_ts or not args.to_ts:
            print("ERROR: --from-ts dan --to-ts wajib disediakan untuk mode ini", file=sys.stderr)
            return 2
        if args.from_ts >= args.to_ts:
            print("ERROR: --from-ts harus lebih awal daripada --to-ts", file=sys.stderr)
            return 2

    if args.publish and args.env == "prod" and not args.run_id:
        print(
            "ERROR: Mode prod pada --publish wajib menyertakan --run-id spesifik (dari hasil --execute).",
            file=sys.stderr,
        )
        return 2

    created_by = args.created_by or os.environ.get("USERNAME") or os.environ.get("USER") or "unknown"

    try:
        dbname = resolve_database(args.plant, env=args.env)
        conn_plant = connect_plant(dbname, autocommit=False, env=args.env, plant=args.plant)
    except (EtlError, psycopg2.Error) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    try:
        if args.publish:
            try:
                conn_central = connect_central(
                    args.central_db if args.env == "lab" else None,
                    autocommit=False,
                    env=args.env,
                    plant_conn=conn_plant,
                )
            except (EtlError, psycopg2.Error) as exc:
                print(f"ERROR koneksi central: {exc}", file=sys.stderr)
                return 1
            try:
                summary = run_publish(
                    conn_plant, conn_central,
                    plant=args.plant, run_id=args.run_id,
                    ready_rule_version=args.ready_version,
                    limit=args.limit, batch_size=args.batch_size,
                    env=args.env,
                )
            finally:
                conn_central.close()
        elif args.reconcile:
            try:
                conn_central = connect_central(
                    args.central_db if args.env == "lab" else None,
                    autocommit=False,
                    env=args.env,
                    plant_conn=conn_plant,
                )
            except (EtlError, psycopg2.Error) as exc:
                print(f"ERROR koneksi central: {exc}", file=sys.stderr)
                return 1
            try:
                with conn_plant.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur_plant:
                    with conn_central.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur_central:
                        assert_central_staging_schema(cur_central)
                        summary = reconcile_publishing_state(
                            cur_plant, conn_plant, cur_central, conn_central,
                            plant=args.plant, run_id=args.run_id, ready_rule_version=args.ready_version,
                        )
            finally:
                conn_central.close()
        else:
            with conn_plant.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cfg = load_plant_config(cur, args.plant)
                if args.preview_publish:
                    summary = preview_publish(
                        cur, plant=args.plant, run_id=args.run_id,
                        ready_rule_version=args.ready_version, limit=args.limit,
                    )
                elif args.preview_persisted:
                    summary = preview_persisted_sap_ready(
                        cur, plant=args.plant, run_id=args.run_id, ready_rule_version=args.ready_version
                    )
                elif args.compare_legacy:
                    summary = compare_with_legacy_staging(
                        cur, plant=args.plant, from_ts=args.from_ts, to_ts=args.to_ts,
                        cfg=cfg, dbname=dbname, ready_version=args.ready_version,
                        clean_rule_version=args.clean_rule_version,
                        allocation_version=args.allocation_version,
                    )
                elif args.dry_run:
                    from_ts = args.from_ts
                    to_ts = args.to_ts
                    if args.auto_window and (not from_ts or not to_ts):
                        win = resolve_auto_window(
                            cur,
                            plant=args.plant,
                            tz_name=cfg["timezone"],
                            cutoff_date=cfg.get("cutoff_date"),
                        )
                        if not win:
                            print("INFO: Staging up-to-date (tidak ada window baru yang siap di-stage).", file=sys.stderr)
                            return 0
                        from_ts, to_ts = win
                    summary = run_dry_run(
                        cur, cfg=cfg, dbname=dbname, from_ts=from_ts, to_ts=to_ts,
                        allocation_version=args.allocation_version,
                        clean_rule_version=args.clean_rule_version,
                        ready_version=args.ready_version,
                        quarantine_duplicates=args.quarantine_duplicates,
                    )
                elif args.stage:
                    from_ts = args.from_ts
                    to_ts = args.to_ts
                    if args.auto_window and (not from_ts or not to_ts):
                        win = resolve_auto_window(
                            cur,
                            plant=args.plant,
                            tz_name=cfg["timezone"],
                            cutoff_date=cfg.get("cutoff_date"),
                        )
                        if not win:
                            print("INFO: Staging up-to-date (tidak ada window baru yang siap di-stage).", file=sys.stderr)
                            return 0
                        from_ts, to_ts = win
                    exec_summary = run_execute(
                        cur, conn_plant, cfg=cfg, dbname=dbname, from_ts=from_ts, to_ts=to_ts,
                        allocation_version=args.allocation_version,
                        clean_rule_version=args.clean_rule_version,
                        ready_version=args.ready_version,
                        created_by=created_by,
                        quarantine_duplicates=args.quarantine_duplicates,
                    )
                    if exec_summary.get("sap_ready_count", 0) > 0:
                        conn_central = connect_central(
                            args.central_db if args.env == "lab" else None,
                            autocommit=False,
                            env=args.env,
                            plant_conn=conn_plant,
                        )
                        try:
                            pub_summary = run_publish(
                                conn_plant, conn_central,
                                plant=args.plant, run_id=exec_summary["run_id"],
                                ready_rule_version=args.ready_version,
                                limit=args.limit, batch_size=args.batch_size,
                                env=args.env,
                            )
                            summary = {**exec_summary, "publish": pub_summary, "mode": "stage"}
                        finally:
                            conn_central.close()
                    else:
                        summary = {**exec_summary, "mode": "stage", "published_count": 0}
                else:
                    summary = run_execute(
                        cur, conn_plant, cfg=cfg, dbname=dbname, from_ts=args.from_ts, to_ts=args.to_ts,
                        allocation_version=args.allocation_version,
                        clean_rule_version=args.clean_rule_version,
                        ready_version=args.ready_version,
                        created_by=created_by,
                        quarantine_duplicates=args.quarantine_duplicates,
                    )
    except EtlError as exc:
        conn_plant.rollback()
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    except psycopg2.Error as exc:
        conn_plant.rollback()
        print(f"ERROR database: {exc}", file=sys.stderr)
        return 1
    finally:
        conn_plant.close()

    if args.json:
        print(json.dumps(summary, indent=2, default=str))
    else:
        print(f"mode                       : {summary['mode']}")
        if "database" in summary:
            print(f"database                   : {summary['database']}")
        print(f"plant                      : {summary['plant']}{' (' + summary['plant_timezone'] + ')' if 'plant_timezone' in summary else ''}")
        if "window" in summary:
            print(f"window                     : {summary['window']['from_ts']} -> {summary['window']['to_ts']}")
        if "allocation_version" in summary:
            print(f"allocation_version         : {summary['allocation_version']}")
        if "clean_rule_version" in summary:
            print(f"clean_rule_version         : {summary['clean_rule_version']}")
        if "ready_rule_version" in summary:
            print(f"ready_rule_version         : {summary['ready_rule_version']}")
        if "input_count" in summary:
            print(f"input count                : {summary['input_count']}")
            print(f"open (tidak diambil)       : {summary['open_not_captured']}")
            print(f"exclusions                 :")
            print(f"  INVALID_INTERVAL         : {summary['exclusions']['INVALID_INTERVAL']} (dilaporkan, tidak diambil)")
            print(f"  DURATION_LT_1_SECOND     : {summary['exclusions']['DURATION_LT_1_SECOND']} (dilaporkan, tidak diambil)")
            print(f"WORK segment count         : {summary['work_segment_count']}")
            print(f"BREAK segment count        : {summary['break_segment_count']}")
            print(f"UNKNOWN confirmation count : {summary['unknown_confirmation_count']}")
            print(f"canonical RG/OV/RW count   : RG={summary['canonical_confirmation_counts']['RG']}, OV={summary['canonical_confirmation_counts']['OV']}, RW={summary['canonical_confirmation_counts']['RW']}")
            print(f"legacy fallback count      : {summary['legacy_fallback_count']}")
            print(f"total raw seconds          : {summary['total_raw_seconds']}")
            print(f"total WORK seconds         : {summary['total_work_seconds']}")
            print(f"total BREAK seconds        : {summary['total_break_seconds']}")
            print(f"inputs with cap metadata   : {summary['inputs_with_cap_metadata']}")
            print(f"allocated segment count    : {summary['allocated_segment_count']}")
            print(f"target allocated seconds   : {summary['target_allocated_seconds']}")
            print(f"companion allocated seconds: {summary['companion_allocated_seconds']}")
            print(f"all allocated seconds      : {summary['all_allocated_seconds']}")
            print(f"total union seconds        : {summary['total_union_seconds']}")
            print(f"allocation delta seconds   : {summary['allocation_delta_seconds']}")
            print(f"operator-day violations    : {summary['operator_day_violation_count']}")
        if "sap_ready_count" in summary:
            print(f"SAP-ready count            : {summary['sap_ready_count']}")
        if "productive_sap_ready_count" in summary:
            print(f"  productive SAP-ready     : {summary['productive_sap_ready_count']}")
        if "non_productive_sap_ready_count" in summary:
            print(f"  non-productive SAP-ready : {summary['non_productive_sap_ready_count']}")
        if "total_pre_cap_seconds" in summary:
            print(f"total pre-cap seconds      : {summary['total_pre_cap_seconds']}")
            print(f"total cap deducted seconds : {summary['total_cap_deducted_seconds']}")
        if "total_sap_effective_seconds" in summary:
            print(f"total SAP effective seconds: {summary['total_sap_effective_seconds']}")
            print(f"total SAP hours            : {summary['total_sap_hours']}")
        if "cap_configured_source_count" in summary:
            print(f"cap configured source count: {summary['cap_configured_source_count']}")
            print(f"cap applied source count   : {summary['cap_applied_source_count']}")
            print(f"uncapped source count      : {summary['uncapped_source_count']}")
            print(f"blocked source count       : {summary['blocked_source_count']}")
            print(f"invariant violations       : {summary['ready_invariant_violation_count']}")
        if "sap_ready_exclusions" in summary:
            print(f"SAP-ready exclusions       :")
            for reason, count in summary["sap_ready_exclusions"].items():
                print(f"  {reason:<26}: {count}")
        if summary["mode"] == "execute":
            print(f"run_id                     : {summary['run_id']}")
            print(f"inserted inputs            : {summary['inserted_inputs']}")
            print(f"reused inputs              : {summary['reused_inputs']}")
            print(f"lineage rows               : {summary['linked_inputs']}")
            print(f"inserted cleaned segments  : {summary['inserted_segments']}")
            print(f"reused cleaned segments    : {summary['reused_segments']}")
            print(f"inserted allocated segments: {summary['inserted_allocated']}")
            print(f"reused allocated segments  : {summary['reused_allocated']}")
            print(f"inserted SAP-ready         : {summary['inserted_sap_ready']}")
            print(f"reused SAP-ready           : {summary['reused_sap_ready']}")
            print(f"status                     : {summary['status']}")
        elif summary["mode"] == "publish":
            print(f"run_id                     : {summary.get('run_id')}")
            print(f"reconciled count           : {summary.get('reconciled_count')}")
            print(f"published count            : {summary.get('published_count')}")
            print(f"total staged in run        : {summary.get('total_staged_in_run')}")
            print(f"status                     : {summary.get('status')}")
        elif summary["mode"] == "preview_publish":
            print(f"run_id                     : {summary.get('run_id')}")
            print(f"candidate count            : {summary.get('candidate_count')}")
            print(f"status breakdown           : {summary.get('status_breakdown')}")
            print(f"output checksum            : {summary.get('output_checksum')}")
        elif summary["mode"] == "reconcile":
            print(f"reconciled count           : {summary.get('reconciled_count')}")
            print(f"status                     : {summary.get('status')}")
        elif summary["mode"] == "compare_legacy":
            s = summary.get("summary", {})
            print(f"total evaluated tsnumbers  : {s.get('total_evaluated_tsnumbers')}")
            print(f"new SAP-ready count        : {s.get('new_sap_ready_count')}")
            print(f"legacy staging count       : {s.get('legacy_staging_count')}")
            print(f"exact match count          : {s.get('exact_match_count')}")
            print(f"seconds difference count   : {s.get('seconds_difference_count')}")
            print(f"in legacy only count       : {s.get('in_legacy_only_count')}")
            print(f"in new only count          : {s.get('in_new_only_count')}")
        if "output_checksum" in summary:
            print(f"output checksum            : {summary['output_checksum']}")
        if "wrote_rows" in summary:
            print(f"wrote_rows                 : {summary['wrote_rows']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

