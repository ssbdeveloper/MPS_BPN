#!/usr/bin/env python3
"""run_sql_migration_tests.py

Menjalankan test migration SQL Fase A & Fase B terhadap database terisolasi lokal.
Database sementara (mps2_test_sql_migrations) dibuat dan dihapus untuk tiap test.

SAFETY:
- Target strictly localhost:5432 / loopback.
- Database terisolasi mps2_test_sql_migrations diizinkan oleh _guard_not_production.sql.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
import psycopg2

REPO_ROOT = Path(__file__).resolve().parents[3]
TEST_DIR = REPO_ROOT / "database" / "tests" / "timesheet"
TEMP_DB = "mps2_test_sql_migrations"


def get_admin_conn():
    conn = psycopg2.connect(host="localhost", port=5432, dbname="postgres", user="postgres")
    conn.autocommit = True
    return conn


def reset_temp_db():
    conn = get_admin_conn()
    with conn.cursor() as cur:
        cur.execute(f"DROP DATABASE IF EXISTS {TEMP_DB};")
        cur.execute(f"CREATE DATABASE {TEMP_DB};")
    conn.close()


def drop_temp_db():
    conn = get_admin_conn()
    with conn.cursor() as cur:
        cur.execute(f"DROP DATABASE IF EXISTS {TEMP_DB};")
    conn.close()


def run_test_file(sql_file_path: Path):
    print(f"[*] Running {sql_file_path.name}...")
    reset_temp_db()
    res = subprocess.run(
        [
            "psql",
            "-h", "localhost",
            "-p", "5432",
            "-U", "postgres",
            "-d", TEMP_DB,
            "-v", "ON_ERROR_STOP=1",
            "-f", str(sql_file_path),
        ],
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        print(f"ERROR: {sql_file_path.name} FAILED (rc={res.returncode}):")
        if res.stdout:
            print("STDOUT:", res.stdout)
        if res.stderr:
            print("STDERR:", res.stderr)
        drop_temp_db()
        raise RuntimeError(f"SQL migration test {sql_file_path.name} failed.")

    print(f"[+] {sql_file_path.name} PASSED.")
    drop_temp_db()


def main():
    test_files = [
        TEST_DIR / "test_20260922_timesheet_derived_time_contract.sql",
        TEST_DIR / "test_20260922b_timesheet_freeze_and_audit.sql",
    ]
    for tf in test_files:
        run_test_file(tf)
    print("=== ALL SQL MIGRATION TESTS PASSED 100% ===")


if __name__ == "__main__":
    main()
