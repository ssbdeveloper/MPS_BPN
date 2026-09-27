import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import unittest
from unittest.mock import MagicMock, patch
import psycopg2
from sap_staging_common import insert_staging_rows, upsert_eligibility_audit, STAGING_COLUMNS



class TestMultiPageCounter(unittest.TestCase):
    def test_insert_staging_rows_accumulates_across_pages(self):
        # Create 1369 mock rows (> 1000 page size)
        rows = [
            {
                "source_system": "TIMESHEET",
                "source_key": f"5100:{i}",
                "werks": "5100",
                "pernr": "1001",
                "source_ref_id": str(i),
                "is_correction": False,
            }
            for i in range(1, 1370)
        ]
        self.assertEqual(len(rows), 1369)

        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur

        # Simulate execute_values setting cur.rowcount = page size on page 1, then remainder on page 2
        def fake_execute_values(cur, sql, page, **kw):
            cur.rowcount = len(page)

        with patch("psycopg2.extras.execute_values", side_effect=fake_execute_values):
            with patch("sap_staging_common.insert_provenance"):
                inserted = insert_staging_rows(mock_conn, rows)

        # Must be exact cumulative count across all pages (1369), NOT just the last page (369)
        self.assertEqual(inserted, 1369)

    def test_upsert_eligibility_audit_accumulates_across_pages(self):
        rows = [
            {
                "source_system": "TIMESHEET",
                "source_key": f"5100:{i}",
                "source_ref_id": str(i),
                "plant": "5100",
                "eligibility_status": "ELIGIBLE",
            }
            for i in range(1, 1370)
        ]
        self.assertEqual(len(rows), 1369)

        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur

        def fake_execute_values(cur, sql, page, **kw):
            cur.rowcount = len(page)

        with patch("psycopg2.extras.execute_values", side_effect=fake_execute_values):
            audited = upsert_eligibility_audit(mock_conn, rows)

        self.assertEqual(audited, 1369)


if __name__ == "__main__":
    unittest.main()
