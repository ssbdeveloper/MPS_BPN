#!/usr/bin/env python3
"""manage_local_lab.py

Manajemen laboratorium PostgreSQL lokal terisolasi:
- Refresh snapshot production secara read-only ke mps_timesheet_lab.
- Recreate database test clone (mps_timesheet_bpn_test, mps_timesheet_ckp_test, mps_sap_staging_test).
- Validasi seluruh koneksi & FDW strictly localhost / loopback.

ATURAN KEAMANAN:
- Seluruh tindakan destruktif HANYA boleh menarget database allowlist lokal:
    {"mps_timesheet_lab", "mps_timesheet_bpn_test", "mps_timesheet_ckp_test", "mps_sap_staging_test"}
- Wajib menyertakan flag --confirm-local-reset untuk aksi destruktif.
- Fail-closed jika target host bukan localhost/loopback.
- Password production/lokal tidak pernah dicetak ke stdout, stderr, docs, atau logs.
"""

from __future__ import annotations

import argparse
import io
import os
import subprocess
import sys
from pathlib import Path
import psycopg2
from dotenv import dotenv_values

# Resolve repository root dari lokasi file (bukan hardcoded)
REPO_ROOT = Path(__file__).resolve().parents[3]

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
ALLOWED_LOCAL_DBS = {
    "mps_timesheet_lab",
    "mps_timesheet_bpn_test",
    "mps_timesheet_ckp_test",
    "mps_sap_staging_test",
}
ALLOWED_PLANTS = {
    "5051": {"name": "Balikpapan", "host": "100.86.231.55", "test_db": "mps_timesheet_bpn_test", "snapshot_schema": "bpn_snapshot"},
    "5100": {"name": "Cikupa", "host": "100.80.101.53", "test_db": "mps_timesheet_ckp_test", "snapshot_schema": "ckp_snapshot"},
}


def load_secrets() -> tuple[str, str]:
    env_file = REPO_ROOT / ".env"
    cfg = dotenv_values(str(env_file)) if env_file.exists() else {}
    prod_pwd = cfg.get("DB_PASSWORD") or cfg.get("SRC_PASSWORD") or os.environ.get("SRC_PASSWORD") or ""
    local_pwd = cfg.get("LOCAL_DB_PASSWORD") or os.environ.get("LOCAL_DB_PASSWORD") or ""
    if not local_pwd:
        pgpass_path = Path(os.environ.get("APPDATA", "")) / "postgresql" / "pgpass.conf"
        if pgpass_path.exists():
            for line in pgpass_path.read_text().splitlines():
                parts = line.strip().split(":")
                if len(parts) >= 5 and parts[0] in ("localhost", "*", "127.0.0.1") and parts[3] == "postgres":
                    local_pwd = parts[4]
                    break
    return prod_pwd, local_pwd


def assert_local_target(host: str, dbname: str) -> None:
    if host not in LOCAL_HOSTS:
        raise RuntimeError(f"Target host '{host}' ditolak: hanya localhost yang diizinkan.")
    if dbname not in ALLOWED_LOCAL_DBS:
        raise RuntimeError(f"Target db '{dbname}' ditolak: bukan database allowlist {sorted(ALLOWED_LOCAL_DBS)}.")


def get_local_conn(dbname: str, autocommit: bool = True):
    assert_local_target("localhost", dbname)
    conn = psycopg2.connect(host="localhost", port=5432, dbname=dbname, user="postgres")
    # Must commit any implicit transaction before setting autocommit to avoid:
    # ProgrammingError: set_session cannot be used inside a transaction
    conn.commit()
    conn.autocommit = autocommit
    with conn.cursor() as cur:
        cur.execute("SELECT inet_server_addr()")
        addr = cur.fetchone()[0]
        if addr is not None and str(addr).strip() not in ("127.0.0.1", "::1"):
            conn.close()
            raise RuntimeError(f"Koneksi lokal bukan loopback: inet_server_addr={addr}")
    return conn


def get_prod_readonly_conn(host: str, port: int = 5433):
    prod_pwd, _ = load_secrets()
    conn = psycopg2.connect(
        host=host, port=port, dbname="ptssb", user="tag", password=prod_pwd, connect_timeout=10
    )
    conn.set_session(readonly=True)
    return conn


def run_checked(cmd: list[str], what: str, env=None, stdin_bytes: bytes | None = None, cwd=None) -> str:
    """Jalankan subprocess dan GAGAL KERAS bila returncode != 0.

    Review menemukan pengelola lab bisa memberi 'sukses palsu' karena stderr
    subprocess dibuang. Semua pemanggilan pg_dump/psql/node wajib lewat sini
    supaya returncode dicek dan stderr ikut terbawa ke pesan error.
    """
    proc = subprocess.Popen(
        cmd,
        env=env,
        cwd=cwd,
        stdin=subprocess.PIPE if stdin_bytes is not None else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    out, err = proc.communicate(input=stdin_bytes)
    if proc.returncode != 0:
        raise RuntimeError(
            f"{what} gagal (rc={proc.returncode}):\n"
            + err.decode("utf-8", errors="replace")
        )
    return out.decode("utf-8", errors="replace")


# Daftar function kustom (non-extension) yang boleh dipasang ke clone lab.
#
# Disusun dari PENGUKURAN NYATA terhadap clone lokal:
#   public + prokind='f' + bukan anggota extension.
# Versi lama memuat 8 nama yang tidak ada satu pun di database mana pun
# ("allocate_timesheet_interval", "timesheet_freeze_guard", ...). Akibatnya
# install_functions menyaring SEMUA function, mengembalikan 0, dan rebuild
# tetap melaporkan sukses — clone lahir tanpa trigger timesheet.
# Jangan tambah nama dari ingatan; ukur dulu dengan
# database/tests/timesheet/test_lab_function_allowlist.py.
TIMESHEET_FUNCTION_ALLOWLIST = {
    "fn_delete_dup_sow",
    "generate_remaining_hours_notifications",
    "mch_transaction_freeze_posted",
    "mch_transaction_invalidate_pending_bundles",
    "refresh_mv_kanban_order_board",
    "resolve_shift_definition",
    "sap_staging_mark_segments_posted",
    "seed_sow_sub_operation_from_standard",
    "set_modified_at",
    "set_ms_project_updated_at",
    "set_sow_scheduling_updated_at",
    "timesheet_correction_audit_append_only",
    "timesheet_guard_frozen_payroll",
    "timesheet_mark_staged",
    "timesheet_sync_derived_time",
    "trg_set_sync_modified",
    "update_modified_column",
    "update_nnva_updated_at",
    "update_updated_at_column",
}

# Function yang WAJIB ada di clone lab. Bila salah satu hilang, clone tidak
# punya trigger derived-time / freeze guard / audit append-only dan setiap
# test di atasnya tidak bermakna. install_functions menolak sukses tanpa ini.
REQUIRED_PIPELINE_FUNCTIONS = {
    "resolve_shift_definition",
    "timesheet_correction_audit_append_only",
    "timesheet_guard_frozen_payroll",
    "timesheet_mark_staged",
    "timesheet_sync_derived_time",
}

# Tabel kontrak yang WAJIB ada setelah rebuild. Dibuat oleh migration
# 20260922/20260922b, bukan oleh DDL salinan di pengelola lab.
REQUIRED_CLONE_TABLES = {
    "timesheet_transaction",
    "timesheet_correction_audit",
    "timesheet_staging_freeze",
    "timesheet_staging_outbox",
}

# Trigger kontrak pada timesheet_transaction.
REQUIRED_CLONE_TRIGGERS = {
    "trg_timesheet_sync_derived_time",
    "trg_z_timesheet_guard_frozen_payroll",
}

# Schema tempat definisi function production disimpan di mps_timesheet_lab.
FUNCTION_SNAPSHOT_TABLE = "lab_meta.timesheet_function_snapshot"

# Migration kontrak timesheet yang membentuk clone lab. Urutannya WAJIB persis
# seperti daftar ini: Fase B bergantung pada tabel/kolom dari Fase A.
LAB_MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations" / "api"
LAB_MIGRATION_FILES = [
    "20260922_timesheet_derived_time_contract.sql",
    "20260922b_timesheet_freeze_and_audit.sql",
    # Pipeline ETL berlapis (F0). `--only=` membuat urutan eksplisit: migration
    # kontrak lebih dulu, pipeline menyusul.
    "20260923_timesheet_etl_pipeline.sql",
]


def verify_clone_contract(target_db: str) -> dict:
    """Buktikan clone benar-benar punya function + tabel kontrak timesheet.

    Dipanggil di akhir rebuild. Ini gerbang terakhir terhadap 'sukses palsu':
    tanpa function pipeline atau tanpa tabel state, clone tidak boleh dinyatakan
    siap — sekalipun semua perintah psql keluar dengan kode nol.
    """
    conn = get_local_conn(target_db)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT p.proname FROM pg_proc p "
                "JOIN pg_namespace n ON n.oid = p.pronamespace "
                "LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e' "
                "WHERE n.nspname = 'public' AND p.prokind = 'f' AND d.objid IS NULL"
            )
            funcs = {r[0] for r in cur.fetchall()}

            missing_funcs = sorted(REQUIRED_PIPELINE_FUNCTIONS - funcs)
            if missing_funcs:
                raise RuntimeError(
                    f"Clone {target_db} tidak memuat function wajib: {missing_funcs}"
                )

            cur.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
            )
            tables = {r[0] for r in cur.fetchall()}
            missing_tables = sorted(REQUIRED_CLONE_TABLES - tables)
            if missing_tables:
                raise RuntimeError(
                    f"Clone {target_db} tidak memuat tabel kontrak: {missing_tables}"
                )

            # Trigger derived-time harus benar-benar terpasang, bukan hanya
            # function-nya ada.
            cur.execute(
                "SELECT tgname FROM pg_trigger t "
                "JOIN pg_class c ON c.oid = t.tgrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'public' AND NOT t.tgisinternal "
                "  AND c.relname = 'timesheet_transaction'"
            )
            triggers = {r[0] for r in cur.fetchall()}
            missing_triggers = sorted(REQUIRED_CLONE_TRIGGERS - triggers)
            if missing_triggers:
                raise RuntimeError(
                    f"Clone {target_db} kekurangan trigger kontrak: {missing_triggers}"
                )
        return {"functions": len(funcs), "tables": len(tables), "triggers": len(triggers)}
    finally:
        conn.close()


def apply_lab_migrations(target_db: str) -> int:
    """Terapkan migration kontrak timesheet ke clone lab lewat runner resmi.

    Rebuild tidak boleh menyalin DDL sendiri maupun menjalankan psql langsung:
    `timesheet_staging_freeze`/`timesheet_staging_outbox` dibuat migration Fase
    B, dan function `timesheet_mark_staged` menulis ke tabel itu. Versi lama
    memasang function dari snapshot sebelum tabel ada sehingga gagal (atau,
    pada varian yang menelan exception, lahir tanpa trigger).

    Runner resmi juga MENCATAT migration ke schema_migrations, yang dibutuhkan
    Test 1. Tidak ada koneksi ke plant: runner diarahkan ke localhost lewat env.
    """
    _, local_pwd = load_secrets()
    env = os.environ.copy()
    env.update(
        {
            "DB_HOST": "localhost",
            "DB_PORT": "5432",
            "DB_NAME": target_db,
            "DB_USER": "postgres",
            "DB_PASSWORD": local_pwd,
        }
    )
    only = ",".join(LAB_MIGRATION_FILES)
    run_checked(
        [
            "node", "database/migrate.js",
            f"--only={only}",
            # Clone lab selalu punya drift ledger historis (snapshot membawa
            # schema_migrations production, sementara folder migration berisi
            # lebih banyak file). Flag ini hard-guard di migrate.js: hanya
            # localhost/loopback + hanya database test lab.
            "--allow-historical-drift",
        ],
        what=f"migrate.js --only kontrak timesheet -> {target_db}",
        env=env,
        cwd=str(REPO_ROOT),
    )
    return len(LAB_MIGRATION_FILES)


def function_snapshot_exists(plant_code: str) -> bool:
    """True bila snapshot function lokal untuk plant ini sudah terisi."""
    lab_conn = get_local_conn("mps_timesheet_lab")
    try:
        with lab_conn.cursor() as cur:
            cur.execute("SELECT to_regclass(%s)", (FUNCTION_SNAPSHOT_TABLE,))
            if cur.fetchone()[0] is None:
                return False
            cur.execute(
                f"SELECT count(*) FROM {FUNCTION_SNAPSHOT_TABLE} WHERE plant_code = %s",
                (plant_code,),
            )
            return cur.fetchone()[0] > 0
    finally:
        lab_conn.close()


def harvest_functions_from_local_clone(plant_code: str, source_db: str) -> int:
    """Panen definisi function dari CLONE LOKAL (bukan production) ke snapshot.

    Dipakai saat snapshot lab masih kosong. Sumbernya clone lokal yang sudah
    terbukti sah, jadi operasi ini 100% offline: tidak ada koneksi ke Cikupa
    maupun Balikpapan. Fail-closed bila function pipeline wajib tidak lengkap.
    """
    src_conn = get_local_conn(source_db)
    with src_conn.cursor() as cur:
        cur.execute("""
            SELECT p.proname, pg_get_functiondef(p.oid)
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
            WHERE n.nspname = 'public'
              AND p.prokind = 'f'
              AND d.objid IS NULL
            ORDER BY p.proname;
        """)
        funcs = [(n, d) for n, d in cur.fetchall() if n in TIMESHEET_FUNCTION_ALLOWLIST]
    src_conn.close()

    found = {n for n, _ in funcs}
    missing = sorted(REQUIRED_PIPELINE_FUNCTIONS - found)
    if missing:
        raise RuntimeError(
            f"Clone lokal {source_db} tidak memuat function pipeline wajib: {missing}. "
            "Panen dibatalkan — snapshot akan menyimpan clone yang tidak sah."
        )

    lab_conn = get_local_conn("mps_timesheet_lab")
    with lab_conn.cursor() as cur:
        cur.execute("CREATE SCHEMA IF NOT EXISTS lab_meta;")
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS {FUNCTION_SNAPSHOT_TABLE} (
              plant_code text NOT NULL,
              proname    text NOT NULL,
              definition text NOT NULL,
              captured_at timestamptz NOT NULL DEFAULT now(),
              PRIMARY KEY (plant_code, proname)
            );
        """)
        cur.execute(f"DELETE FROM {FUNCTION_SNAPSHOT_TABLE} WHERE plant_code = %s", (plant_code,))
        for name, fdef in funcs:
            cur.execute(
                f"INSERT INTO {FUNCTION_SNAPSHOT_TABLE} (plant_code, proname, definition) "
                f"VALUES (%s, %s, %s)",
                (plant_code, name, fdef),
            )
    lab_conn.close()
    return len(funcs)


def install_functions(cur, funcs) -> int:
    """Pasang definisi function ke cursor tujuan.

    FAIL-CLOSED: satu function gagal -> RuntimeError, dan clone tanpa salah
    satu REQUIRED_PIPELINE_FUNCTIONS juga -> RuntimeError. Versi lama menelan
    exception jadi WARN dan mengembalikan 0 tanpa keluhan, sehingga clone bisa
    'sukses' tanpa trigger apa pun.
    """
    installed = 0
    installed_names = set()
    for name, fdef in funcs:
        if name not in TIMESHEET_FUNCTION_ALLOWLIST:
            continue
        try:
            cur.execute(fdef)
        except Exception as exc:
            raise RuntimeError(
                f"Instalasi function {name!r} gagal — clone lab tidak sah: {exc}"
            ) from exc
        installed += 1
        installed_names.add(name)

    missing = sorted(REQUIRED_PIPELINE_FUNCTIONS - installed_names)
    if missing:
        raise RuntimeError(
            f"Clone lab tidak memuat function pipeline wajib: {missing}. "
            "Tanpa ini trigger derived-time / freeze guard / audit tidak hidup "
            "dan test di atasnya tidak bermakna."
        )
    return installed


def snapshot_functions_to_lab(src_host: str, plant_code: str) -> int:
    """Tarik definisi function production (read-only) ke mps_timesheet_lab.

    Dipanggil HANYA oleh refresh-snapshots. Setelah ini rebuild clone bisa
    berjalan offline sepenuhnya dari snapshot lokal.
    """
    src_conn = get_prod_readonly_conn(src_host, 5433)
    with src_conn.cursor() as cur:
        cur.execute("""
            SELECT p.proname, pg_get_functiondef(p.oid)
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
            WHERE n.nspname = 'public'
              AND p.prokind = 'f'
              AND d.objid IS NULL
            ORDER BY p.proname;
        """)
        funcs = [(n, d) for n, d in cur.fetchall() if n in TIMESHEET_FUNCTION_ALLOWLIST]
    src_conn.close()

    lab_conn = get_local_conn("mps_timesheet_lab")
    with lab_conn.cursor() as cur:
        cur.execute("CREATE SCHEMA IF NOT EXISTS lab_meta;")
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS {FUNCTION_SNAPSHOT_TABLE} (
              plant_code text NOT NULL,
              proname    text NOT NULL,
              definition text NOT NULL,
              captured_at timestamptz NOT NULL DEFAULT now(),
              PRIMARY KEY (plant_code, proname)
            );
        """)
        cur.execute(f"DELETE FROM {FUNCTION_SNAPSHOT_TABLE} WHERE plant_code = %s", (plant_code,))
        for name, fdef in funcs:
            cur.execute(
                f"INSERT INTO {FUNCTION_SNAPSHOT_TABLE} (plant_code, proname, definition) "
                f"VALUES (%s, %s, %s)",
                (plant_code, name, fdef),
            )
    lab_conn.close()
    return len(funcs)


def install_functions_from_lab(plant_code: str, target_db: str) -> int:
    """Pasang function ke clone dari snapshot lokal mps_timesheet_lab (offline)."""
    assert_local_target("localhost", target_db)

    lab_conn = get_local_conn("mps_timesheet_lab")
    with lab_conn.cursor() as cur:
        cur.execute("SELECT to_regclass(%s)", (FUNCTION_SNAPSHOT_TABLE,))
        if cur.fetchone()[0] is None:
            lab_conn.close()
            raise RuntimeError(
                f"Snapshot function belum ada di mps_timesheet_lab ({FUNCTION_SNAPSHOT_TABLE}). "
                "Jalankan --action refresh-snapshots lebih dulu."
            )
        cur.execute(
            f"SELECT proname, definition FROM {FUNCTION_SNAPSHOT_TABLE} "
            f"WHERE plant_code = %s ORDER BY proname",
            (plant_code,),
        )
        funcs = cur.fetchall()
    lab_conn.close()

    if not funcs:
        raise RuntimeError(
            f"Snapshot function kosong untuk plant {plant_code}. "
            "Jalankan --action refresh-snapshots lebih dulu."
        )

    dst_conn = get_local_conn(target_db)
    with dst_conn.cursor() as cur:
        installed = install_functions(cur, funcs)
    dst_conn.close()
    return installed




def validate_local_infrastructure() -> dict:
    results = {}
    for db in sorted(ALLOWED_LOCAL_DBS):
        try:
            conn = get_local_conn(db)
            with conn.cursor() as cur:
                cur.execute("SELECT inet_server_addr(), current_database(), current_user")
                addr, dbname, user = cur.fetchone()

                # Check FDW servers if any
                cur.execute("SELECT srvname, srvfdw, srvoptions FROM pg_foreign_server")
                servers = cur.fetchall()
                for srv in servers:
                    opts = " ".join(srv[2] or [])
                    if "localhost" not in opts and "127.0.0.1" not in opts and "::1" not in opts:
                        raise RuntimeError(f"Foreign server non-local terdeteksi di {dbname}: {srv}")
                results[db] = {
                    "status": "HEALTHY",
                    "server_addr": str(addr) if addr else "unix_socket/pipe",
                    "user": user,
                    "foreign_servers": [s[0] for s in servers],
                }
            conn.close()
        except Exception as exc:
            results[db] = {"status": "ERROR", "detail": str(exc)}
    return results


def recreate_staging_db() -> None:
    print("[*] Recreating mps_sap_staging_test base tables...")
    conn = get_local_conn("mps_sap_staging_test")
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("""
            DROP TABLE IF EXISTS public.sap_timesheet_staging CASCADE;
            CREATE TABLE public.sap_timesheet_staging (
              id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
              ztimesheetid text GENERATED ALWAYS AS (id::text) STORED,
              source_system text NOT NULL,
              source_key text NOT NULL,
              is_correction boolean NOT NULL DEFAULT false,
              source_ref_id text NOT NULL DEFAULT '',
              werks text NOT NULL,
              pernr text NOT NULL,
              pernr_origin text NOT NULL DEFAULT '',
              rueck text NOT NULL DEFAULT '',
              aufnr text NOT NULL DEFAULT '',
              vornr text NOT NULL DEFAULT '',
              flgat text NOT NULL DEFAULT '',
              plnfl text NOT NULL DEFAULT '',
              vornr_b text NOT NULL DEFAULT '',
              vornr_r text NOT NULL DEFAULT '',
              zconf_type text NOT NULL DEFAULT '',
              arbpl text NOT NULL DEFAULT '',
              lstar text NOT NULL DEFAULT '',
              isdd text NOT NULL DEFAULT '',
              isdz text NOT NULL DEFAULT '',
              iedd text NOT NULL DEFAULT '',
              iedz text NOT NULL DEFAULT '',
              aueru text NOT NULL DEFAULT '',
              zbarcodeid text NOT NULL DEFAULT '',
              payload jsonb NOT NULL DEFAULT '{}'::jsonb,
              bucket_start timestamp without time zone,
              synthetic_start timestamp without time zone,
              synthetic_end timestamp without time zone,
              total_seconds bigint,
              source_row_count integer NOT NULL DEFAULT 1,
              source_min_start timestamp without time zone,
              source_max_end timestamp without time zone,
              -- provenance_snapshot: satu-satunya kolom yang sengaja HANYA ada
              -- di lab. Migration AWS 20260922_sap_staging_provenance_snapshot.sql
              -- belum dipasang DBA di RDS central; drift ini dilacak sebagai
              -- blocker deploy dan dikunci di test_staging_schema_parity.py.
              provenance_snapshot jsonb,
              -- Kolom di bawah MENGIKUTI kontrak production (foreign table
              -- public.sap_timesheet_staging -> aws_staging/ssb_dw), hasil audit
              -- read-only 2026-09-23. Versi lama memakai kolom karangan
              -- (sap_status/sap_message/validation_message) yang TIDAK ADA di
              -- production, sekaligus kehilangan status/sap_response_text/
              -- posted_at/is_productive yang justru dipakai poster.
              status text NOT NULL DEFAULT 'PENDING',
              sap_response jsonb,
              sap_response_text text,
              sap_error text,
              posted_at timestamptz,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              is_productive boolean,
              CONSTRAINT sap_timesheet_staging_source_uk UNIQUE (source_system, source_key)
            );
            CREATE INDEX IF NOT EXISTS sap_timesheet_staging_status_idx ON public.sap_timesheet_staging (status, created_at);
            CREATE INDEX IF NOT EXISTS sap_timesheet_staging_source_idx ON public.sap_timesheet_staging (source_system, source_ref_id);

            DROP TABLE IF EXISTS public.sap_stage_cursor CASCADE;
            CREATE TABLE public.sap_stage_cursor (
              source_system text NOT NULL,
              plant text NOT NULL,
              last_processed_at timestamp without time zone NOT NULL,
              updated_at timestamptz NOT NULL DEFAULT now(),
              PRIMARY KEY (source_system, plant)
            );

            DROP TABLE IF EXISTS public.sap_staging_eligibility_audit CASCADE;
            CREATE TABLE public.sap_staging_eligibility_audit (
              source_system text NOT NULL,
              source_key text NOT NULL,
              source_ref_id text,
              source_date date,
              plant text NOT NULL DEFAULT '',
              eligibility_status text NOT NULL,
              block_reason text,
              block_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
              observed_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              PRIMARY KEY (source_system, source_key)
            );

            DROP TABLE IF EXISTS public.sap_staging_source CASCADE;
            CREATE TABLE public.sap_staging_source (
              id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
              staging_id bigint,
              source_system text NOT NULL,
              plant text NOT NULL DEFAULT '',
              source_row_id text NOT NULL,
              -- Kontrak production: bucket_start timestamptz, seconds bigint.
              -- Versi lama memakai `timestamp without time zone` + integer,
              -- sehingga lab menggeser batas segmen untuk plant non-UTC
              -- (Cikupa WIB / BPN WITA) dan menyembunyikan bug timezone.
              bucket_start timestamptz NOT NULL,
              seconds bigint NOT NULL,
              posted_at timestamptz,
              created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE UNIQUE INDEX IF NOT EXISTS uq_sap_staging_source_segment_per_bundle
              ON public.sap_staging_source (staging_id, source_system, plant, source_row_id, bucket_start);
            CREATE INDEX IF NOT EXISTS idx_sap_staging_source_segment
              ON public.sap_staging_source (source_system, plant, source_row_id, bucket_start);
            CREATE UNIQUE INDEX IF NOT EXISTS uq_sap_staging_source_posted_segment
              ON public.sap_staging_source (source_system, plant, source_row_id, bucket_start)
              WHERE (posted_at IS NOT NULL);

            DROP TABLE IF EXISTS public.sap_staging_exclusion CASCADE;
            CREATE TABLE public.sap_staging_exclusion (
              source_system text NOT NULL,
              plant text NOT NULL DEFAULT '',
              source_row_id text NOT NULL,
              excluded_by text,
              excluded_at timestamptz NOT NULL DEFAULT now(),
              note text,
              PRIMARY KEY (source_system, plant, source_row_id)
            );

            CREATE OR REPLACE FUNCTION public.sap_staging_mark_segments_posted()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF NEW.status = 'POSTED' AND OLD.status IS DISTINCT FROM 'POSTED' THEN
                UPDATE public.sap_staging_source
                   SET posted_at = COALESCE(NEW.posted_at, now())
                 WHERE staging_id = NEW.id AND posted_at IS NULL;
              END IF;
              RETURN NEW;
            END;
            $$;
            DROP TRIGGER IF EXISTS trg_sap_staging_mark_segments_posted ON public.sap_timesheet_staging;
            CREATE TRIGGER trg_sap_staging_mark_segments_posted
              AFTER UPDATE OF status ON public.sap_timesheet_staging
              FOR EACH ROW EXECUTE FUNCTION public.sap_staging_mark_segments_posted();
        """)
    conn.close()
    print("[+] mps_sap_staging_test base schema recreated successfully.")



def recreate_plant_clone(plant_code: str) -> None:
    plant_info = ALLOWED_PLANTS[plant_code]
    target_db = plant_info["test_db"]
    snapshot_schema = plant_info["snapshot_schema"]
    src_host = plant_info["host"]
    print(f"[*] Recreating {target_db} from snapshot {snapshot_schema}...")

    # Pastikan snapshot function lokal ADA SEBELUM tabel di-drop: panen
    # memakai clone ini sebagai sumber, jadi ia harus masih hidup. Bila
    # snapshot sudah ada, langkah ini tidak menyentuh apa pun.
    if not function_snapshot_exists(plant_code):
        planted = harvest_functions_from_local_clone(plant_code, target_db)
        print(
            f"  Snapshot function kosong; dipanen {planted} function dari clone "
            f"lokal {target_db} (offline, tanpa koneksi plant)."
        )

    # Drop and recreate schema public in target test db
    conn = get_local_conn(target_db)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
        cur.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")
        cur.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')
        cur.execute('CREATE EXTENSION IF NOT EXISTS btree_gist;')
        cur.execute("CREATE EXTENSION IF NOT EXISTS postgres_fdw;")

        # Drop all tables in public
        cur.execute("""
            DO $$ DECLARE
                r RECORD;
            BEGIN
                FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
                    EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
                END LOOP;
            END $$;
        """)

    # Copy tables from snapshot in mps_timesheet_lab
    tables = [
        "timesheet_transaction",
        "ph3_order",
        "sow",
        "usernfc",
        "shift_definition",
        "plant_config",
        "schema_migrations",
    ]
    for t in tables:
        dump_sql = run_checked(
            [
                "pg_dump", "-h", "localhost", "-p", "5432", "-U", "postgres", "-d", "mps_timesheet_lab",
                "--no-owner", "--no-acl",
                "-t", f"{snapshot_schema}.{t}",
            ],
            what=f"pg_dump snapshot lokal {snapshot_schema}.{t}",
        )

        # Replace snapshot schema with public
        sql_public = dump_sql.replace(f"{snapshot_schema}.{t}", f"public.{t}")
        sql_public = sql_public.replace(f"SCHEMA {snapshot_schema}", "SCHEMA public")

        run_checked(
            ["psql", "-h", "localhost", "-p", "5432", "-U", "postgres", "-d", target_db,
             "-v", "ON_ERROR_STOP=1"],
            what=f"psql restore {t} -> {target_db}",
            stdin_bytes=sql_public.encode("utf-8"),
        )

    # Terapkan migration kontrak timesheet: inilah yang membuat
    # timesheet_staging_freeze/outbox dan trigger timesheet. Wajib SEBELUM
    # function dari snapshot dipasang.
    n_mig = apply_lab_migrations(target_db)
    print(f"  {n_mig} migration kontrak diterapkan.")

    # Pasang function lain dari snapshot LOKAL — rebuild tidak menyentuh production.
    install_functions_from_lab(plant_code, target_db)

    # Fail-closed: buktikan function & tabel kontrak benar-benar ADA di clone.
    verify_clone_contract(target_db)

    # Configure local FDW strictly to localhost:5432/mps_sap_staging_test
    _, local_pwd = load_secrets()
    conn = get_local_conn(target_db)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("""
            DROP SERVER IF EXISTS aws_staging CASCADE;
            CREATE SERVER aws_staging
              FOREIGN DATA WRAPPER postgres_fdw
              OPTIONS (host 'localhost', port '5432', dbname 'mps_sap_staging_test');
            CREATE USER MAPPING IF NOT EXISTS FOR postgres
              SERVER aws_staging
              OPTIONS (user 'postgres', password %s);
            CREATE USER MAPPING IF NOT EXISTS FOR current_user
              SERVER aws_staging
              OPTIONS (user 'postgres', password %s);
            IMPORT FOREIGN SCHEMA public
              LIMIT TO (sap_timesheet_staging, sap_staging_source, sap_staging_exclusion)
              FROM SERVER aws_staging
              INTO public;
        """, (local_pwd, local_pwd))
        # Ensure timesheet_transaction.tsnumber has identity sequence matching production contract
        cur.execute("""
            DO $$
            DECLARE
                v_max int;
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'timesheet_transaction'
                ) THEN
                    SELECT COALESCE(MAX(tsnumber), 0) + 1 INTO v_max FROM public.timesheet_transaction;
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'timesheet_transaction'
                          AND column_name = 'tsnumber' AND is_identity = 'YES'
                    ) THEN
                        ALTER TABLE public.timesheet_transaction ALTER COLUMN tsnumber SET NOT NULL;
                        EXECUTE 'ALTER TABLE public.timesheet_transaction ALTER COLUMN tsnumber ADD GENERATED BY DEFAULT AS IDENTITY (START WITH ' || v_max || ')';
                    END IF;
                END IF;
            END $$;
        """)
        # Ledger schema_migrations TIDAK boleh dibersihkan di sini. Versi lama
        # menghapus baris 20260922% supaya "test clean migration", padahal
        # migration sudah diterapkan — ledger lalu berbohong dan Test 1 gagal.
        # Bila kelak butuh clone tanpa contract, buat database terpisah.
    conn.close()
    print(f"[+] {target_db} recreated and ready.")


def refresh_snapshots() -> None:
    print("[*] Refreshing snapshots from production read-only...")
    prod_pwd, _ = load_secrets()
    env_prod = os.environ.copy()
    env_prod["PGPASSWORD"] = prod_pwd

    tables = [
        "timesheet_transaction",
        "ph3_order",
        "sow",
        "usernfc",
        "shift_definition",
        "plant_config",
        "schema_migrations",
    ]

    for pcode, pinfo in ALLOWED_PLANTS.items():
        src_host = pinfo["host"]
        schema = pinfo["snapshot_schema"]
        print(f"  Fetching read-only data from {pinfo['name']} ({src_host}:5433) -> {schema}...")

        # Ensure schema exists in mps_timesheet_lab
        lab_conn = get_local_conn("mps_timesheet_lab")
        with lab_conn.cursor() as cur:
            cur.execute(f"CREATE SCHEMA IF NOT EXISTS {schema};")
        lab_conn.close()

        for t in tables:
            dump_sql = run_checked(
                [
                    "pg_dump", "-h", src_host, "-p", "5433", "-U", "tag", "-d", "ptssb",
                    "--no-owner", "--no-acl", "--clean", "--if-exists",
                    "-t", f"public.{t}",
                ],
                what=f"pg_dump (production read-only) public.{t} dari {src_host}",
                env=env_prod,
            )

            sql_snapshot = dump_sql.replace(f"public.{t}", f"{schema}.{t}")
            sql_snapshot = sql_snapshot.replace("SCHEMA public", f"SCHEMA {schema}")

            run_checked(
                ["psql", "-h", "localhost", "-p", "5432", "-U", "postgres", "-d", "mps_timesheet_lab",
                 "-v", "ON_ERROR_STOP=1"],
                what=f"psql restore snapshot {schema}.{t}",
                stdin_bytes=sql_snapshot.encode("utf-8"),
            )

        # Simpan definisi function (read-only) supaya rebuild clone bisa offline.
        n_funcs = snapshot_functions_to_lab(src_host, pcode)
        print(f"    {n_funcs} definisi function disimpan ke {FUNCTION_SNAPSHOT_TABLE} (plant {pcode}).")

    print("[+] Immutable snapshots refreshed in mps_timesheet_lab.")



def main():
    parser = argparse.ArgumentParser(description="Manage local laboratory databases")
    parser.add_argument(
        "--action",
        choices=["validate-local", "refresh-snapshots", "recreate-staging", "recreate-bpn", "recreate-ckp", "recreate-all"],
        required=True,
        help="Action to perform",
    )
    parser.add_argument(
        "--confirm-local-reset",
        action="store_true",
        help="Mandatory confirmation for destructive local resets",
    )
    args = parser.parse_args()

    if args.action == "validate-local":
        print("=== VALIDATING LOCAL INFRASTRUCTURE ===")
        res = validate_local_infrastructure()
        all_ok = True
        for db, info in res.items():
            print(f"  {db:25s}: {info['status']} ({info.get('server_addr')}) FDW: {info.get('foreign_servers', [])}")
            if info["status"] != "HEALTHY":
                all_ok = False
        if not all_ok:
            sys.exit(1)
        print("All local test databases are HEALTHY and strictly on loopback.")
        return

    if not args.confirm_local_reset:
        print("ERROR: Tindakan destruktif ditolak tanpa flag --confirm-local-reset.")
        sys.exit(1)

    if args.action == "refresh-snapshots":
        refresh_snapshots()
    elif args.action == "recreate-staging":
        recreate_staging_db()
    elif args.action == "recreate-bpn":
        recreate_plant_clone("5051")
    elif args.action == "recreate-ckp":
        recreate_plant_clone("5100")
    elif args.action == "recreate-all":
        recreate_staging_db()
        recreate_plant_clone("5051")
        recreate_plant_clone("5100")
        print("=== ALL TEST DATABASES RECREATED SUCCESSFULLY ===")


if __name__ == "__main__":
    main()
