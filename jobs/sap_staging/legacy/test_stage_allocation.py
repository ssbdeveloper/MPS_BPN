"""Test Fase E: stager memakai jam EFEKTIF hasil alokasi, bukan raw duration.

Kontrak (docs/planning/2026-09-22-timesheet-interval-allocation-implementation.md §3):
    raw_seconds           = checkout - checkin (dikurangi break utk non-produktif)
    allocated_seconds     = hasil bagi rata per irisan waktu, SEBELUM cap
    sap_effective_seconds = allocated_seconds SETELAH cap per record

    Non-produktif TIDAK ikut membagi: allocated = raw.
    IEDD/IEDZ harus diturunkan dari sap_effective_seconds, bukan raw.

Jalankan:
    python test_stage_allocation.py
"""
from __future__ import annotations

import unittest
from datetime import datetime

from stage_timesheet_transaction import allocate_staging_rows


def row(tsnumber, serial, start, end, *, activitytype="", cap_minutes=None,
        break_seconds=0, order_no="400001"):
    s = datetime.fromisoformat(start)
    e = datetime.fromisoformat(end)
    return {
        "tsnumber": tsnumber,
        "serialnumber": serial,
        "alloc_start": s,
        "alloc_end": e,
        "activitytype": activitytype,
        "order_no": order_no,
        "raw_seconds": int((e - s).total_seconds()),
        "break_seconds": break_seconds,
        "cap_minutes": cap_minutes,
        "isdd": s.strftime("%Y%m%d"),
        "isdz": s.strftime("%H%M%S"),
    }


class TestAllocateStagingRows(unittest.TestCase):
    def test_contoh_wajib_tiga_order(self):
        """08:00-14:00, 08:00-11:00, 11:00-14:00 -> 3 / 1,5 / 1,5 jam."""
        rows = [
            row(1, "OP1", "2026-09-20T08:00:00", "2026-09-20T14:00:00"),
            row(2, "OP1", "2026-09-20T08:00:00", "2026-09-20T11:00:00"),
            row(3, "OP1", "2026-09-20T11:00:00", "2026-09-20T14:00:00"),
        ]
        out = {r["tsnumber"]: r for r in allocate_staging_rows(rows)}
        self.assertEqual(out[1]["allocated_seconds"], 3 * 3600)
        self.assertEqual(out[2]["allocated_seconds"], int(1.5 * 3600))
        self.assertEqual(out[3]["allocated_seconds"], int(1.5 * 3600))
        total = sum(r["allocated_seconds"] for r in out.values())
        self.assertEqual(total, 6 * 3600, "union harus 6 jam")

    def test_raw_allocated_dan_sap_effective_dipisah(self):
        rows = [
            row(1, "OP1", "2026-09-20T08:00:00", "2026-09-20T14:00:00", cap_minutes=120),
            row(2, "OP1", "2026-09-20T08:00:00", "2026-09-20T14:00:00", cap_minutes=120),
        ]
        out = {r["tsnumber"]: r for r in allocate_staging_rows(rows)}
        for ts in (1, 2):
            self.assertEqual(out[ts]["raw_seconds"], 6 * 3600)
            self.assertEqual(out[ts]["allocated_seconds"], 3 * 3600)
            self.assertEqual(out[ts]["sap_effective_seconds"], 2 * 3600, "cap 120 menit")

    def test_non_produktif_tidak_ikut_membagi(self):
        """Record non-produktif tetap penuh dan tidak mengurangi jam produktif."""
        rows = [
            row(1, "OP1", "2026-09-20T08:00:00", "2026-09-20T12:00:00"),
            row(2, "OP1", "2026-09-20T08:00:00", "2026-09-20T12:00:00",
                activitytype="1590", order_no=""),
        ]
        out = {r["tsnumber"]: r for r in allocate_staging_rows(rows)}
        self.assertEqual(out[1]["allocated_seconds"], 4 * 3600,
                         "produktif sendirian -> penuh")
        self.assertEqual(out[2]["allocated_seconds"], 4 * 3600,
                         "non-produktif -> raw, tidak dibagi")

    def test_break_dipotong_hanya_untuk_non_produktif(self):
        rows = [
            row(1, "OP1", "2026-09-20T08:00:00", "2026-09-20T12:00:00",
                activitytype="1590", order_no="", break_seconds=1800),
        ]
        out = allocate_staging_rows(rows)[0]
        self.assertEqual(out["raw_seconds"], 4 * 3600 - 1800)
        self.assertEqual(out["allocated_seconds"], 4 * 3600 - 1800)

    def test_total_seconds_mengikuti_sap_effective(self):
        rows = [
            row(1, "OP1", "2026-09-20T08:00:00", "2026-09-20T14:00:00"),
            row(2, "OP1", "2026-09-20T08:00:00", "2026-09-20T14:00:00"),
        ]
        for r in allocate_staging_rows(rows):
            self.assertEqual(r["total_seconds"], r["sap_effective_seconds"])

    def test_iedz_diturunkan_dari_sap_effective(self):
        """Dua job paralel 6 jam -> masing-masing 3 jam -> IEDZ 11:00:00."""
        rows = [
            row(1, "OP1", "2026-09-20T08:00:00", "2026-09-20T14:00:00"),
            row(2, "OP1", "2026-09-20T08:00:00", "2026-09-20T14:00:00"),
        ]
        out = {r["tsnumber"]: r for r in allocate_staging_rows(rows)}
        self.assertEqual(out[1]["isdz"], "080000")
        self.assertEqual(out[1]["iedz"], "110000")
        self.assertEqual(out[1]["iedd"], "20260920")

    def test_baris_nol_detik_dibuang(self):
        """Cap 0 menit -> tidak ada yang dikirim ke SAP."""
        rows = [row(1, "OP1", "2026-09-20T08:00:00", "2026-09-20T14:00:00", cap_minutes=0)]
        self.assertEqual(allocate_staging_rows(rows), [])

    def test_operator_berbeda_tidak_saling_membagi(self):
        rows = [
            row(1, "OP1", "2026-09-20T08:00:00", "2026-09-20T14:00:00"),
            row(2, "OP2", "2026-09-20T08:00:00", "2026-09-20T14:00:00"),
        ]
        out = {r["tsnumber"]: r for r in allocate_staging_rows(rows)}
        self.assertEqual(out[1]["allocated_seconds"], 6 * 3600)
        self.assertEqual(out[2]["allocated_seconds"], 6 * 3600)

    def test_invariant_alokasi_sama_dengan_union(self):
        """Lima job acak tumpang tindih: total alokasi = union wall-clock."""
        rows = [
            row(1, "OP1", "2026-09-20T08:00:00", "2026-09-20T16:00:00"),
            row(2, "OP1", "2026-09-20T09:30:00", "2026-09-20T11:15:00"),
            row(3, "OP1", "2026-09-20T10:00:00", "2026-09-20T10:45:00"),
            row(4, "OP1", "2026-09-20T13:00:00", "2026-09-20T17:00:00"),
            row(5, "OP1", "2026-09-20T16:30:00", "2026-09-20T18:00:00"),
        ]
        out = allocate_staging_rows(rows)
        total = sum(r["allocated_seconds"] for r in out)
        self.assertEqual(total, 10 * 3600, "union 08:00-18:00 = 10 jam")


    def test_companion_ikut_membagi_tapi_tidak_dikirim(self):
        """Record di luar window cursor tetap harus jadi pembagi.

        Window cursor bisa memotong satu operator-hari di tengah. Kalau record
        pasangannya tidak ikut dihitung, pembagi jadi 1 dan jam yang dikirim ke
        SAP membengkak dua kali lipat. Companion ikut alokasi, tidak di-emit.
        """
        rows = [
            row(1, "OP1", "2026-09-20T08:00:00", "2026-09-20T14:00:00"),
            dict(row(2, "OP1", "2026-09-20T08:00:00", "2026-09-20T14:00:00"),
                 emit=False),
        ]
        out = allocate_staging_rows(rows)
        self.assertEqual([r["tsnumber"] for r in out], [1],
                         "companion tidak boleh dikirim ke SAP")
        self.assertEqual(out[0]["allocated_seconds"], 3 * 3600,
                         "companion tetap menjadi pembagi")


if __name__ == "__main__":
    unittest.main(verbosity=2)
