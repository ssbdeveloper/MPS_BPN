#!/usr/bin/env python3
"""Unified Staging Worker (machine hours + timesheet ETL).

Memuat seluruh alur staging dari awal (raw transactions) sampai staging table
di central staging (sap_timesheet_staging, sap_staging_source, dsb.).

Layanan posting (pengiriman dari staging table ke SAP API) dijalankan oleh
docker terpisah (post_sap_staging.py).

Penggunaan:
    python stage_worker.py --loop               # Daemon untuk docker container
    python stage_worker.py --loop --interval 300 # Daemon polling per 5 menit
    python stage_worker.py --once               # Satu kali eksekusi (test/cron)
"""
from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from sap_staging_common import (
    app_timezone,
    env_int,
    env_value,
    plant_code,
    setup_logging,
)
import psycopg2.extras
import run_timesheet_etl as etl

log = setup_logging("stage_worker")

_RUNNING = True


def _handle_signal(signum, frame):
    global _RUNNING
    log.info("Sinyal berhenti diterima (sig=%s). Menyelesaikan siklus saat ini...", signum)
    _RUNNING = False


def run_machinehours_cycle(plant: str) -> None:
    """Jalankan siklus staging machine hours jika diaktifkan untuk plant ini."""
    try:
        import stage_machinehours as smh
        # stage_machinehours memiliki guard plant (5051, 5071, 5153).
        # Untuk 5100, smh.run() akan log warning dan return tanpa error.
        parser = smh.build_parser()
        args = parser.parse_args(["--catchup"])
        log.info("[MCH] Menjalankan staging machine hours (catchup)...")
        smh.run(args)
    except Exception as exc:
        log.exception("[MCH] Gagal staging machine hours: %s", exc)


def run_timesheet_cycle(
    plant: str,
    *,
    env: str = "prod",
    from_ts: datetime | None = None,
    to_ts: datetime | None = None,
    quarantine_duplicates: bool = True,
) -> dict | None:
    """Jalankan siklus staging timesheet ETL (awal -> clean -> allocate -> sap_ready -> central staging)."""
    log.info("[TS] Menjalankan staging timesheet ETL untuk plant %s (env=%s)...", plant, env)
    try:
        dbname = etl.resolve_database(plant, env=env)
        conn_plant = etl.connect_plant(dbname, autocommit=False, env=env, plant=plant)
    except Exception as exc:
        log.error("[TS] Gagal koneksi database plant %s: %s", plant, exc)
        return None

    try:
        with conn_plant.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cfg = etl.load_plant_config(cur, plant)
            tz_name = cfg["timezone"]

            # Tentukan window
            if not from_ts or not to_ts:
                win = etl.resolve_auto_window(cur, plant=plant, tz_name=tz_name)
                if not win:
                    log.info("[TS] Timesheet staging up-to-date (tidak ada window baru yang siap di-stage).")
                    return {"status": "UP_TO_DATE"}
                from_ts, to_ts = win

            log.info("[TS] Memproses window: %s -> %s", from_ts.isoformat(), to_ts.isoformat())

            # 1. Execute ETL
            exec_summary = etl.run_execute(
                cur,
                conn_plant,
                cfg=cfg,
                dbname=dbname,
                from_ts=from_ts,
                to_ts=to_ts,
                allocation_version=etl.ALLOCATION_VERSION,
                clean_rule_version=etl.CLEAN_RULE_VERSION,
                ready_version=etl.READY_RULE_VERSION,
                created_by="stage_worker",
                quarantine_duplicates=quarantine_duplicates,
            )

        sap_ready_count = exec_summary.get("sap_ready_count", 0)
        log.info(
            "[TS] ETL execute selesai (run_id=%s): input=%s, sap_ready=%s, hours=%.2f",
            exec_summary.get("run_id"),
            exec_summary.get("input_count"),
            sap_ready_count,
            exec_summary.get("total_sap_hours", 0.0),
        )

        # 2. Publish ke Central Staging
        if sap_ready_count > 0:
            conn_central = etl.connect_central(
                None if env == "prod" else etl.DEFAULT_CENTRAL_DB,
                autocommit=False,
                env=env,
                plant_conn=conn_plant,
            )
            try:
                pub_summary = etl.run_publish(
                    conn_plant,
                    conn_central,
                    plant=plant,
                    run_id=exec_summary["run_id"],
                    ready_rule_version=etl.READY_RULE_VERSION,
                    env=env,
                )
                log.info(
                    "[TS] Publish central berhasil: published=%s, frozen=%s",
                    pub_summary.get("published_count"),
                    pub_summary.get("frozen_count"),
                )
                return {**exec_summary, "publish": pub_summary, "status": "PUBLISHED"}
            finally:
                conn_central.close()
        else:
            log.info("[TS] Tidak ada record SAP-ready untuk dipublish ke central.")
            return {**exec_summary, "status": "NO_SAP_READY"}

    except Exception as exc:
        conn_plant.rollback()
        log.exception("[TS] Error saat staging timesheet: %s", exc)
        return None
    finally:
        conn_plant.close()


def run_cycle(
    plant: str,
    *,
    env: str = "prod",
    from_ts: datetime | None = None,
    to_ts: datetime | None = None,
    quarantine_duplicates: bool = True,
) -> bool:
    """Satu siklus lengkap staging: machine hours + timesheet.
    Mengembalikan True bila seluruh tahapan berhasil (atau skipped sesuai aturan).
    """
    log.info("========== Memulai siklus staging plant %s ==========", plant)
    # 1. Machine hours
    try:
        run_machinehours_cycle(plant)
    except Exception as exc:
        log.exception("[MCH] Siklus machine hours gagal: %s", exc)
        return False

    # 2. Timesheet ETL
    ts_res = run_timesheet_cycle(
        plant,
        env=env,
        from_ts=from_ts,
        to_ts=to_ts,
        quarantine_duplicates=quarantine_duplicates,
    )
    if ts_res is None:
        log.error("[TS] Siklus timesheet ETL gagal.")
        return False

    log.info("========== Siklus staging selesai (status TS: %s) ==========", ts_res.get("status"))
    return True


def main() -> int:
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    parser = argparse.ArgumentParser(
        description="Unified Staging Worker — menjalankan proses staging timesheet & machine hours."
    )
    parser.add_argument("--loop", action="store_true", help="Daemon: jalankan secara berkala.")
    parser.add_argument(
        "--interval",
        type=float,
        default=float(env_int("SAP_STAGE_INTERVAL", 900)),
        help="Detik jeda antar siklus (default dari SAP_STAGE_INTERVAL atau 900s).",
    )
    parser.add_argument("--once", action="store_true", help="Jalankan satu kali lalu berhenti.")
    parser.add_argument(
        "--plant",
        default=plant_code() or "5100",
        help="Kode plant (default dari PLANT_SSB atau 5100).",
    )
    parser.add_argument(
        "--env",
        choices=["prod", "lab"],
        default="prod",
        help="Lingkungan eksekusi (default: prod).",
    )
    parser.add_argument(
        "--no-quarantine",
        action="store_true",
        help="Gagalkan jika ada duplicate activity overlap alih-alih mengkarantina.",
    )
    parser.add_argument("--from-ts", type=etl.parse_tz_aware, help="Override awal window ISO8601.")
    parser.add_argument("--to-ts", type=etl.parse_tz_aware, help="Override akhir window ISO8601.")

    args = parser.parse_args()

    if not args.loop and not args.once:
        args.once = True

    quarantine = not args.no_quarantine
    log.info(
        "stage_worker siap: plant=%s, env=%s, interval=%.1fs, mode=%s, quarantine_duplicates=%s",
        args.plant,
        args.env,
        args.interval,
        "LOOP" if args.loop else "ONCE",
        quarantine,
    )

    if args.once:
        ok = run_cycle(
            args.plant,
            env=args.env,
            from_ts=args.from_ts,
            to_ts=args.to_ts,
            quarantine_duplicates=quarantine,
        )
        return 0 if ok else 1

    while _RUNNING:
        start_time = time.monotonic()
        ok = run_cycle(
            args.plant,
            env=args.env,
            from_ts=args.from_ts,
            to_ts=args.to_ts,
            quarantine_duplicates=quarantine,
        )
        elapsed = time.monotonic() - start_time
        sleep_dur = max(0.0, args.interval - elapsed)

        log.info("Siklus selesai dalam %.1fs. Tidur selama %.1fs...", elapsed, sleep_dur)

        deadline = time.monotonic() + sleep_dur
        while _RUNNING and time.monotonic() < deadline:
            time.sleep(min(1.0, deadline - time.monotonic()))

    log.info("stage_worker berhenti secara normal.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
