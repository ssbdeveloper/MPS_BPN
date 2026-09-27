#!/usr/bin/env python3
"""Audit READ-ONLY schema central staging production vs local lab.

KETAT read-only:
  - koneksi di-set SESSION CHARACTERISTICS AS TRANSACTION READ ONLY
  - hanya SELECT terhadap information_schema / pg_catalog
  - tidak ada CREATE / ALTER / INSERT / UPDATE / DELETE / migration

Output: JSON schema diff ke stdout + file.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import dotenv_values

REPO_ROOT = Path(__file__).resolve().parents[3]
ENV = dotenv_values(REPO_ROOT / ".env")

# Tabel central staging yang dipakai pipeline timesheet.
STAGING_TABLES = [
    "sap_timesheet_staging",
    "sap_staging_source",
    "sap_staging_exclusion",
    "sap_stage_cursor",
    "sap_staging_eligibility_audit",
]


def prod_conn():
    """Koneksi production READ-ONLY (kredensial dari .env)."""
    conn = psycopg2.connect(
        host=ENV.get("DB_HOST"),
        port=int(ENV.get("DB_PORT") or 5433),
        dbname=ENV.get("DB_NAME"),
        user=ENV.get("DB_USER"),
        password=ENV.get("DB_PASSWORD"),
        connect_timeout=15,
        options="-c default_transaction_read_only=on",
    )
    conn.set_session(readonly=True, autocommit=True)
    return conn


def local_conn():
    conn = psycopg2.connect(
        host="localhost", port=5432, dbname="mps_sap_staging_test",
        user="postgres", password=ENV.get("DB_PASSWORD"), connect_timeout=10,
    )
    conn.set_session(readonly=True, autocommit=True)
    return conn


COLUMN_SQL = """
SELECT table_name, column_name, data_type, is_nullable,
       coalesce(character_maximum_length, -1),
       coalesce(numeric_precision, -1), coalesce(numeric_scale, -1)
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = ANY(%s)
ORDER BY table_name, column_name
"""

INDEX_SQL = """
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = ANY(%s)
ORDER BY tablename, indexname
"""

CONSTRAINT_SQL = """
SELECT c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid)
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = ANY(%s)
ORDER BY c.relname, con.conname
"""


def snapshot(conn, label: str) -> dict:
    out = {"label": label, "columns": {}, "indexes": {}, "constraints": {}, "missing_tables": []}
    with conn.cursor() as cur:
        cur.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema='public' AND table_name = ANY(%s)",
            (STAGING_TABLES,),
        )
        present = {r[0] for r in cur.fetchall()}
        out["missing_tables"] = sorted(set(STAGING_TABLES) - present)

        cur.execute(COLUMN_SQL, (STAGING_TABLES,))
        for t, col, dt, nullable, clen, nprec, nscale in cur.fetchall():
            out["columns"].setdefault(t, {})[col] = {
                "type": dt, "nullable": nullable,
                "len": clen, "prec": nprec, "scale": nscale,
            }

        cur.execute(INDEX_SQL, (STAGING_TABLES,))
        for t, name, ddl in cur.fetchall():
            out["indexes"].setdefault(t, {})[name] = ddl

        cur.execute(CONSTRAINT_SQL, (STAGING_TABLES,))
        for t, name, ddl in cur.fetchall():
            out["constraints"].setdefault(t, {})[name] = ddl
    return out


def diff(prod: dict, local: dict) -> dict:
    report = {"tables": {}, "summary": {}}
    n_missing_local = n_missing_prod = n_type = 0

    for t in STAGING_TABLES:
        pcols = prod["columns"].get(t, {})
        lcols = local["columns"].get(t, {})
        entry = {
            "prod_has_table": t not in prod["missing_tables"],
            "local_has_table": t not in local["missing_tables"],
            "only_in_prod": sorted(set(pcols) - set(lcols)),
            "only_in_local": sorted(set(lcols) - set(pcols)),
            "type_mismatch": [],
            "nullable_mismatch": [],
        }
        for col in sorted(set(pcols) & set(lcols)):
            p, l = pcols[col], lcols[col]
            if p["type"] != l["type"]:
                entry["type_mismatch"].append(
                    {"column": col, "prod": p["type"], "local": l["type"]}
                )
            if p["nullable"] != l["nullable"]:
                entry["nullable_mismatch"].append(
                    {"column": col, "prod": p["nullable"], "local": l["nullable"]}
                )
        n_missing_local += len(entry["only_in_prod"])
        n_missing_prod += len(entry["only_in_local"])
        n_type += len(entry["type_mismatch"])
        report["tables"][t] = entry

    report["summary"] = {
        "kolom_ada_di_prod_tidak_di_lokal": n_missing_local,
        "kolom_ada_di_lokal_tidak_di_prod": n_missing_prod,
        "tipe_berbeda": n_type,
        "tabel_hilang_di_prod": prod["missing_tables"],
        "tabel_hilang_di_lokal": local["missing_tables"],
    }
    return report


def main():
    print(f"[*] Prod target: {ENV.get('DB_HOST')}:{ENV.get('DB_PORT') or 5433}"
          f"/{ENV.get('DB_NAME')} user={ENV.get('DB_USER')} (READ ONLY)")
    pc = prod_conn()
    try:
        with pc.cursor() as cur:
            cur.execute("SHOW transaction_read_only")
            ro = cur.fetchone()[0]
            print(f"[*] transaction_read_only = {ro}")
            if ro != "on":
                raise SystemExit("ABORT: sesi production tidak read-only")
        prod = snapshot(pc, "production")
    finally:
        pc.close()

    lc = local_conn()
    try:
        local = snapshot(lc, "mps_sap_staging_test")
    finally:
        lc.close()

    report = {"prod": prod, "local": local, "diff": diff(prod, local)}
    out_path = Path(os.environ.get("LOCALAPPDATA", "/tmp")) / "Temp" / "staging_schema_diff.json"
    out_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(json.dumps(report["diff"], indent=2, ensure_ascii=False, default=str))
    print(f"\n[+] Laporan lengkap: {out_path}")


if __name__ == "__main__":
    main()
