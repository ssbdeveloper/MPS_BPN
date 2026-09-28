"""Remediasi data sap_timesheet_staging: inject ZTIMESHEETID dan reset status PENDING.

Masalah:
  5.680 baris TIMESHEET di sap_timesheet_staging (dihasilkan run_timesheet_etl.py)
  belum memiliki key ZTIMESHEETID di dalam JSON payload.
  538 baris FAILED dengan "Mandatory data Timesheet ID (ZTIMESHEETID) is empty."
  5.142 baris menggantung di status POSTING.

Tindakan remediasi:
  1. Set payload = jsonb_set(payload, '{ZTIMESHEETID}', to_jsonb(ztimesheetid))
  2. Reset status = 'PENDING'
  3. Reset sap_error = NULL
  4. updated_at = now()

Guard:
  - Default DRY-RUN (tidak ada commit).
  - Satu transaksi penuh (atomic).
  - Assertion pra- dan pasca-update.
"""

from __future__ import annotations

import argparse
import sys

from sap_staging_common import connect_staging, setup_logging

log = setup_logging("remedy_missing_ztimesheetid")


def run_remediation(apply: bool = False) -> None:
    log.info("Memulai audit dan remediasi missing ZTIMESHEETID...")
    log.info("Mode: %s", "APPLY (TRANSAKSI TULIS)" if apply else "DRY-RUN (READ ONLY)")

    with connect_staging() as conn:
        with conn.cursor() as cur:
            # 1. Pengecekan populasi target
            cur.execute(
                """
                SELECT status, count(*)
                FROM sap_timesheet_staging
                WHERE source_system = 'TIMESHEET'
                  AND status IN ('POSTING', 'FAILED')
                  AND NOT (payload ? 'ZTIMESHEETID')
                GROUP BY status
                ORDER BY status
                """
            )
            breakdown = dict(cur.fetchall())
            total_target = sum(breakdown.values())

            log.info("Target baris ditemukan: total=%d, rincian=%s", total_target, breakdown)

            if total_target == 0:
                log.info("Tidak ada baris yang memerlukan remediasi. Selesai.")
                return

            # Periksa contoh data sebelum update
            cur.execute(
                """
                SELECT id, ztimesheetid, status, payload ? 'ZTIMESHEETID' AS has_zid, sap_error
                FROM sap_timesheet_staging
                WHERE source_system = 'TIMESHEET'
                  AND status IN ('POSTING', 'FAILED')
                  AND NOT (payload ? 'ZTIMESHEETID')
                ORDER BY id
                LIMIT 3
                """
            )
            samples_before = cur.fetchall()
            log.info("Contoh baris sebelum remediasi:")
            for s in samples_before:
                log.info("  id=%s, ztimesheetid=%s, status=%s, has_zid=%s, sap_error=%s", s[0], s[1], s[2], s[3], s[4])

            if not apply:
                log.info("DRY-RUN: simulasi selesai. Gunakan flag --apply --yes untuk mengeksekusi.")
                return

            # 2. Eksekusi Update dalam transaksi
            log.info("Mengeksekusi UPDATE pada %d baris...", total_target)
            cur.execute(
                """
                UPDATE sap_timesheet_staging
                SET payload = jsonb_set(payload, '{ZTIMESHEETID}', to_jsonb(ztimesheetid)),
                    status = 'PENDING',
                    sap_error = NULL,
                    updated_at = now()
                WHERE source_system = 'TIMESHEET'
                  AND status IN ('POSTING', 'FAILED')
                  AND NOT (payload ? 'ZTIMESHEETID')
                RETURNING id, ztimesheetid, payload->>'ZTIMESHEETID' as payload_zid, status
                """
            )
            updated_rows = cur.fetchall()
            updated_count = len(updated_rows)
            log.info("Baris ter-UPDATE: %d", updated_count)

            if updated_count != total_target:
                raise RuntimeError(
                    f"Jumlah update ({updated_count}) tidak sesuai ekspektasi target ({total_target}). Rollback!"
                )

            # 3. Verifikasi pasca update
            for row in updated_rows[:5]:
                if row[1] != row[2]:
                    raise RuntimeError(f"Mismatch ztimesheetid {row[1]} vs payload_zid {row[2]}!")
                if row[3] != "PENDING":
                    raise RuntimeError(f"Status bukan PENDING: {row[3]}!")

            # Pastikan tidak ada sisa
            cur.execute(
                """
                SELECT count(*)
                FROM sap_timesheet_staging
                WHERE source_system = 'TIMESHEET'
                  AND status IN ('POSTING', 'FAILED')
                  AND NOT (payload ? 'ZTIMESHEETID')
                """
            )
            remaining = cur.fetchone()[0]
            if remaining != 0:
                raise RuntimeError(f"Masih tersisa {remaining} baris target setelah update. Rollback!")

        # Commit transaksi
        conn.commit()
        log.info("REMEDIASI BERHASIL: %d baris berhasil diperbarui dan di-commit ke PENDING.", updated_count)


def main() -> None:
    parser = argparse.ArgumentParser(description="Remediasi missing ZTIMESHEETID di sap_timesheet_staging")
    parser.add_argument("--apply", action="store_true", help="Terapkan perubahan ke database (default: dry-run)")
    parser.add_argument("--yes", action="store_true", help="Konfirmasi eksekusi tulis")
    args = parser.parse_args()

    if args.apply and not args.yes:
        parser.error("--apply membutuhkan konfirmasi --yes")

    run_remediation(apply=args.apply)


if __name__ == "__main__":
    main()
