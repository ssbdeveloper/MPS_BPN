"""Read-only preflight for EWS date-range shift overrides (spec Q1-Q4).

Connects to each plant with a READ ONLY session, asserts
`transaction_read_only = on`, and prints aggregate results only.
Credentials are read from the repo-root .env and never printed.

Usage:
    python database/tests/ews/preflight_shift_override_readonly.py [--plant 5100|5051|all]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import dotenv_values

REPO_ROOT = Path(__file__).resolve().parents[3]
PLANTS = {
    "5100": {"name": "Cikupa", "host": "100.80.101.53"},
    "5051": {"name": "Balikpapan", "host": "100.86.231.55"},
}
SOW_TABLES = {
    # table: (date column, blocking predicate) -- mirrors public.ews_sow_blocking_refs()
    "sow_machine_capacity": ("schedule_date", "is_active"),
    "sow_schedule": ("schedule_date", "schedule_status <> 'CANCELLED'"),
    "sow_schedule_batch": ("schedule_date", "batch_status <> 'CANCELLED'"),
    "sow_overtime_request": ("overtime_date", "request_status IN ('PENDING','APPROVED')"),
}
STATUS_COLUMN = {
    "sow_machine_capacity": "is_active",
    "sow_schedule": "schedule_status",
    "sow_schedule_batch": "batch_status",
    "sow_overtime_request": "request_status",
}


def connect(host: str):
    cfg = dotenv_values(str(REPO_ROOT / ".env"))
    pwd = cfg.get("DB_PASSWORD") or os.environ.get("SRC_PASSWORD") or ""
    conn = psycopg2.connect(host=host, port=5433, dbname="ptssb", user="tag",
                            password=pwd, connect_timeout=10)
    conn.set_session(readonly=True)
    with conn.cursor() as cur:
        cur.execute("SHOW transaction_read_only")
        if cur.fetchone()[0] != "on":
            raise RuntimeError("session is not read-only; aborting")
    return conn


def rows(cur, sql, params=None):
    cur.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def q1_schema(cur):
    out = {}
    out["shift_definition_columns"] = [r["column_name"] for r in rows(cur, """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='shift_definition' ORDER BY ordinal_position""")]
    out["shift_definition_indexes"] = rows(cur, """
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='shift_definition' ORDER BY 1""")
    out["resolver_exists"] = rows(cur, """
        SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='resolve_shift_definition'""")
    out["roster_effective_exists"] = rows(cur, """
        SELECT table_schema, table_name FROM information_schema.views
        WHERE table_schema='ews' AND table_name='roster_effective'""")
    out["sow_triggers"] = rows(cur, """
        SELECT c.relname AS table_name, t.tgname
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND NOT t.tgisinternal
          AND c.relname IN ('shift_definition','sow_machine_capacity','sow_schedule',
                            'sow_schedule_batch','sow_overtime_request')
        ORDER BY 1,2""")
    out["status_checks"] = rows(cur, """
        SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE contype='c' AND conrelid::regclass::text IN
          ('sow_schedule','sow_schedule_batch','sow_overtime_request','public.sow_schedule',
           'public.sow_schedule_batch','public.sow_overtime_request')
          AND pg_get_constraintdef(oid) ILIKE '%status%'""")
    out["default_isolation"] = rows(cur, "SHOW default_transaction_isolation")
    out["migrations_20260916"] = rows(cur, """
        SELECT filename FROM public.schema_migrations
        WHERE filename ILIKE '20260916%' ORDER BY 1""") if rows(cur, """
        SELECT 1 AS x FROM information_schema.tables
        WHERE table_schema='public' AND table_name='schema_migrations'""") else "no ledger"
    out["plant_timezone"] = rows(cur, """
        SELECT timezone FROM public.plant_config LIMIT 1""") if rows(cur, """
        SELECT 1 AS x FROM information_schema.columns
        WHERE table_schema='public' AND table_name='plant_config' AND column_name='timezone'""") else None
    return out


def q2_baseline(cur, has_roster_code):
    rc = "roster_shift_code" if has_roster_code else "NULL::text AS roster_shift_code"
    out = {}
    out["defaults"] = rows(cur, f"""
        SELECT id, shift_code, {rc}, start_time::text, end_time::text, crosses_midnight,
               {'standard_hours,' if has_roster_code else ''} default_capacity_hours, is_active
        FROM public.shift_definition WHERE is_default ORDER BY start_time""")
    out["future_overrides"] = rows(cur, f"""
        SELECT COUNT(*) AS n,
               COUNT(*) FILTER (WHERE is_active) AS active,
               COUNT(*) FILTER (WHERE {'roster_shift_code IS NULL' if has_roster_code else 'true'}) AS unmapped,
               MIN(effective_date)::text AS min_date, MAX(effective_date)::text AS max_date
        FROM public.shift_definition
        WHERE NOT is_default AND effective_date >= CURRENT_DATE""")
    out["all_overrides"] = rows(cur, f"""
        SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE is_active) AS active,
               COUNT(*) FILTER (WHERE {'roster_shift_code IS NULL' if has_roster_code else 'true'}) AS unmapped
        FROM public.shift_definition WHERE NOT is_default""")
    return out


def q3_mismatch(cur):
    out = {}
    for table, (dcol, pred) in SOW_TABLES.items():
        out[table] = rows(cur, f"""
            SELECT COUNT(*) AS blocking_rows,
                   COUNT(*) FILTER (WHERE t.shift_id IS NULL) AS null_shift,
                   COUNT(*) FILTER (WHERE t.shift_id IS NOT NULL AND NOT EXISTS (
                       SELECT 1 FROM public.resolve_shift_definition(t.{dcol}) r
                       WHERE r.id = t.shift_id)) AS not_resolved,
                   COUNT(*) FILTER (WHERE t.{dcol} >= CURRENT_DATE AND t.shift_id IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM public.resolve_shift_definition(t.{dcol}) r
                                       WHERE r.id = t.shift_id)) AS not_resolved_future
            FROM public.{table} t WHERE {pred}""")[0]
        out[table]["status_values"] = rows(cur, f"""
            SELECT {STATUS_COLUMN[table]}::text AS status, COUNT(*) AS n
            FROM public.{table} GROUP BY 1 ORDER BY 1""")
    return out


def q4_future_volume(cur):
    out = {}
    for table, (dcol, pred) in SOW_TABLES.items():
        out[table] = rows(cur, f"""
            SELECT COUNT(DISTINCT {dcol}) AS dates_with_refs, COUNT(*) AS rows
            FROM public.{table}
            WHERE {pred} AND {dcol} BETWEEN CURRENT_DATE AND CURRENT_DATE + 61""")[0]
    out["dates_blocked_any"] = rows(cur, " UNION ".join(
        f"SELECT {dcol} AS d FROM public.{t} WHERE {p} AND {dcol} BETWEEN CURRENT_DATE AND CURRENT_DATE + 61"
        for t, (dcol, p) in SOW_TABLES.items()).join(["SELECT COUNT(DISTINCT d) AS n FROM (", ") x"]))[0]
    return out


def run(plant):
    meta = PLANTS[plant]
    conn = connect(meta["host"])
    try:
        with conn.cursor() as cur:
            schema = q1_schema(cur)
            has_rc = "roster_shift_code" in schema["shift_definition_columns"]
            result = {"plant": plant, "name": meta["name"], "Q1": schema,
                      "Q2": q2_baseline(cur, has_rc)}
            if schema["resolver_exists"]:
                result["Q3"] = q3_mismatch(cur)
            else:
                result["Q3"] = "resolve_shift_definition missing"
            result["Q4"] = q4_future_volume(cur)
        conn.rollback()
        return result
    finally:
        conn.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plant", default="all", choices=["all", *PLANTS])
    args = ap.parse_args()
    plants = list(PLANTS) if args.plant == "all" else [args.plant]
    report = []
    for p in plants:
        try:
            report.append(run(p))
        except Exception as exc:  # report and continue with the next plant
            report.append({"plant": p, "error": f"{type(exc).__name__}: {exc}"})
    json.dump(report, sys.stdout, indent=2, default=str)
    print()


if __name__ == "__main__":
    main()
