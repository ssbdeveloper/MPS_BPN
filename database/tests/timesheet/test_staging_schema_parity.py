#!/usr/bin/env python3
"""Kontrak: schema central staging LOKAL harus cocok dengan PRODUCTION.

Latar: `mps_sap_staging_test` dibangun dari DDL yang DIKARANG di
`manage_local_lab.py`, bukan diturunkan dari kontrak production. Akibatnya lab
bisa hijau sementara production punya bentuk berbeda — persis kelas "sukses
palsu" yang sedang kita berantas.

Kontrak production diambil dari audit READ-ONLY terhadap foreign table
`public.sap_timesheet_staging` / `sap_staging_source` / `sap_staging_exclusion`
di plant `ptssb` (postgres_fdw -> AWS RDS `ssb_dw`). Foreign table adalah
permukaan yang BENAR-BENAR dipakai pipeline, jadi itulah kontraknya.

Test ini TIDAK menyentuh production: kontrak dibekukan sebagai konstanta di
bawah (hasil audit 2026-09-23), dan test hanya membaca database lab lokal.
"""
from __future__ import annotations

import os
import unittest

import psycopg2
from dotenv import dotenv_values

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
ENV = dotenv_values(os.path.join(REPO_ROOT, ".env"))

LOCAL_STAGING_DB = "mps_sap_staging_test"

# ---------------------------------------------------------------------------
# Kontrak production, hasil audit read-only 2026-09-23 (pg_attribute di ptssb).
# ---------------------------------------------------------------------------
PROD_SAP_TIMESHEET_STAGING = {
    "id": "bigint",
    "ztimesheetid": "text",
    "source_system": "text",
    "source_key": "text",
    "is_correction": "boolean",
    "source_ref_id": "text",
    "werks": "text",
    "pernr": "text",
    "pernr_origin": "text",
    "rueck": "text",
    "aufnr": "text",
    "vornr": "text",
    "flgat": "text",
    "plnfl": "text",
    "vornr_b": "text",
    "vornr_r": "text",
    "zconf_type": "text",
    "arbpl": "text",
    "lstar": "text",
    "isdd": "text",
    "isdz": "text",
    "iedd": "text",
    "iedz": "text",
    "aueru": "text",
    "zbarcodeid": "text",
    "payload": "jsonb",
    "bucket_start": "timestamp without time zone",
    "synthetic_start": "timestamp without time zone",
    "synthetic_end": "timestamp without time zone",
    "total_seconds": "bigint",
    "source_row_count": "integer",
    "source_min_start": "timestamp without time zone",
    "source_max_end": "timestamp without time zone",
    "status": "text",
    "sap_response": "jsonb",
    "sap_response_text": "text",
    "sap_error": "text",
    "posted_at": "timestamp with time zone",
    "created_at": "timestamp with time zone",
    "updated_at": "timestamp with time zone",
    "is_productive": "boolean",
}

PROD_SAP_STAGING_SOURCE = {
    "id": "bigint",
    "staging_id": "bigint",
    "source_system": "text",
    "source_row_id": "text",
    "bucket_start": "timestamp with time zone",
    "seconds": "bigint",
    "posted_at": "timestamp with time zone",
    "created_at": "timestamp with time zone",
    "plant": "text",
}

PROD_SAP_STAGING_EXCLUSION = {
    "source_system": "text",
    "plant": "text",
    "source_row_id": "text",
    "excluded_by": "text",
    "excluded_at": "timestamp with time zone",
    "note": "text",
}

# Kolom yang SENGAJA hanya ada di lab: migration AWS
# database/migrations/aws/20260922_sap_staging_provenance_snapshot.sql belum
# dipasang DBA di RDS central. Ini drift yang DIHARAPKAN dan dilacak sebagai
# blocker deploy — bukan izin untuk menambah kolom karangan lain.
EXPECTED_LAB_ONLY_COLUMNS = {"provenance_snapshot"}


def local_columns(table: str) -> dict[str, str]:
    conn = psycopg2.connect(
        host="localhost", port=5432, dbname=LOCAL_STAGING_DB,
        user="postgres", password=ENV.get("DB_PASSWORD"), connect_timeout=10,
    )
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.attname, format_type(a.atttypid, a.atttypmod)
                FROM pg_attribute a
                JOIN pg_class c ON c.oid = a.attrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname = %s
                  AND a.attnum > 0 AND NOT a.attisdropped
                """,
                (table,),
            )
            return {r[0]: r[1] for r in cur.fetchall()}
    finally:
        conn.close()


class TestStagingSchemaParity(unittest.TestCase):
    """Lab harus mencerminkan kontrak production, bukan versi karangan."""

    def _assert_parity(self, table: str, prod: dict[str, str]) -> None:
        local = local_columns(table)
        self.assertTrue(local, f"{table} tidak ada di {LOCAL_STAGING_DB}")

        missing = sorted(set(prod) - set(local))
        self.assertEqual(
            missing, [],
            f"{table}: kolom production TIDAK ADA di lab -> {missing}. "
            "Lab tidak bisa membuktikan perilaku production.",
        )

        extra = sorted(set(local) - set(prod) - EXPECTED_LAB_ONLY_COLUMNS)
        self.assertEqual(
            extra, [],
            f"{table}: kolom KARANGAN hanya ada di lab -> {extra}. "
            "Kolom ini tidak ada di production; test yang memakainya memberi rasa aman palsu.",
        )

        mismatch = [
            f"{col}: prod={prod[col]} lab={local[col]}"
            for col in sorted(set(prod) & set(local))
            if prod[col] != local[col]
        ]
        self.assertEqual(
            mismatch, [],
            f"{table}: TIPE berbeda dari production -> {mismatch}",
        )

    def test_sap_timesheet_staging_sesuai_production(self):
        self._assert_parity("sap_timesheet_staging", PROD_SAP_TIMESHEET_STAGING)

    def test_sap_staging_source_sesuai_production(self):
        self._assert_parity("sap_staging_source", PROD_SAP_STAGING_SOURCE)

    def test_sap_staging_exclusion_sesuai_production(self):
        self._assert_parity("sap_staging_exclusion", PROD_SAP_STAGING_EXCLUSION)

    def test_posted_at_ada_karena_dipakai_poster(self):
        """post_sap_staging.py menulis posted_at; tanpa kolom ini lab tak bisa menguji posting."""
        self.assertIn("posted_at", local_columns("sap_timesheet_staging"))

    def test_bucket_start_source_timezone_aware(self):
        """sap_staging_source.bucket_start di production timestamptz.

        Lab yang memakai `timestamp without time zone` menggeser batas segmen
        untuk plant non-UTC (Cikupa WIB / BPN WITA) dan menyembunyikan bug
        timezone yang akan muncul di production.
        """
        self.assertEqual(
            local_columns("sap_staging_source").get("bucket_start"),
            "timestamp with time zone",
        )

    def test_tidak_ada_kolom_status_ganda(self):
        """`sap_status` adalah duplikat karangan dari `status` milik production."""
        cols = local_columns("sap_timesheet_staging")
        self.assertNotIn("sap_status", cols)
        self.assertIn("status", cols)


if __name__ == "__main__":
    unittest.main(verbosity=2)
