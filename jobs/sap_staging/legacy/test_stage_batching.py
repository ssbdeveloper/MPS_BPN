"""Kontrak batching staging (review P1 #12-#17).

Ditulis SEBELUM implementasi. Menguji empat hal yang review tunjukkan rusak:

  #12 companion lintas tengah malam — pencocokan per tanggal check-in saja
      memutus pasangan multitask yang melewati 00:00.
  #13/#14 LIMIT dan cursor — rows[:limit] memotong operator-day di tengah,
      dan cursor dari source_max_end sintetis bisa melewati atau mengulang.
  #15 hanya operator-day yang SUDAH SELESAI boleh dialokasikan.
  #17 provenance harus merekonsiliasi raw/allocated/cap/final.
"""

import unittest
from datetime import date, datetime, timedelta, timezone

from stage_batching import (
    operator_day_key,
    group_operator_days,
    select_complete_days,
    limit_by_operator_day,
    next_cursor_value,
    build_provenance,
)

JKT = timezone(timedelta(hours=7))


def dt(day, hh, mm=0):
    return datetime(2026, 9, day, hh, mm, tzinfo=JKT)


def row(ts, serial, start, end, **kw):
    r = {
        "source_ref_id": ts,
        "serialnumber": serial,
        "alloc_start": start,
        "alloc_end": end,
        "longdate_checkout": end,
    }
    r.update(kw)
    return r


class TestOperatorDayKey(unittest.TestCase):
    """#12: kunci operator-day harus mengikat shift lintas tengah malam."""

    def test_shift_malam_melewati_tengah_malam_tetap_satu_hari_kerja(self):
        # Check-in 22:00 tanggal 20, checkout 02:00 tanggal 21.
        a = operator_day_key("OP1", dt(20, 22, 0), dt(21, 2, 0), JKT)
        # Job kedua operator yang sama, check-in 23:00 tanggal 20.
        b = operator_day_key("OP1", dt(20, 23, 0), dt(21, 1, 0), JKT)
        self.assertEqual(a, b, "dua job dalam shift malam yang sama harus satu operator-day")

    def test_job_yang_checkin_setelah_tengah_malam_ikut_hari_kerja_sebelumnya(self):
        malam = operator_day_key("OP1", dt(20, 22, 0), dt(21, 2, 0), JKT)
        dini = operator_day_key("OP1", dt(21, 0, 30), dt(21, 3, 0), JKT)
        self.assertEqual(dini, malam, "00:30 masih shift malam tanggal 20, bukan hari kerja baru")

    def test_shift_pagi_normal_adalah_hari_kalender_itu(self):
        k = operator_day_key("OP1", dt(21, 8, 0), dt(21, 16, 0), JKT)
        self.assertEqual(k, ("OP1", date(2026, 9, 21)))

    def test_operator_berbeda_tidak_pernah_satu_kunci(self):
        a = operator_day_key("OP1", dt(21, 8, 0), dt(21, 16, 0), JKT)
        b = operator_day_key("OP2", dt(21, 8, 0), dt(21, 16, 0), JKT)
        self.assertNotEqual(a, b)


class TestCompanionGrouping(unittest.TestCase):
    """#12 + Work B: pengelompokan hanya berdasarkan overlap interval nyata."""

    def test_pasangan_multitask_lintas_tengah_malam_satu_grup(self):
        rows = [
            row(1, "OP1", dt(20, 22, 0), dt(21, 2, 0)),
            row(2, "OP1", dt(20, 23, 0), dt(21, 2, 0)),
        ]
        groups = group_operator_days(rows, JKT)
        self.assertEqual(len(groups), 1, f"harus 1 grup, dapat {len(groups)}: {list(groups)}")
        self.assertEqual(len(next(iter(groups.values()))), 2)

    def test_pencocokan_tanggal_checkin_saja_akan_memecah_grup_ini(self):
        # Regression guard eksplisit: tanggal check-in beda (20 vs 21) tapi
        # keduanya milik shift malam yang sama dan overlap nyata.
        rows = [
            row(1, "OP1", dt(20, 23, 30), dt(21, 3, 0)),
            row(2, "OP1", dt(21, 0, 15), dt(21, 3, 0)),
        ]
        groups = group_operator_days(rows, JKT)
        self.assertEqual(len(groups), 1, "tanggal check-in beda tetapi shift sama dan overlap -> satu grup")

    def test_gap_tolerance_dihapus_gap_30_menit_pisah_grup(self):
        rows = [
            row(1, "OP1", dt(20, 8, 0), dt(20, 12, 0)),
            row(2, "OP1", dt(20, 12, 30), dt(20, 16, 0)),
        ]
        groups = group_operator_days(rows, JKT)
        self.assertEqual(len(groups), 2, "gap 30 menit tanpa overlap harus menjadi 2 grup terpisah")

    def test_gap_tolerance_dihapus_gap_60_menit_pisah_grup(self):
        rows = [
            row(1, "OP1", dt(20, 8, 0), dt(20, 12, 0)),
            row(2, "OP1", dt(20, 13, 0), dt(20, 17, 0)),
        ]
        groups = group_operator_days(rows, JKT)
        self.assertEqual(len(groups), 2, "gap 60 menit tanpa overlap harus menjadi 2 grup terpisah")

    def test_gap_tolerance_dihapus_gap_90_menit_pisah_grup(self):
        rows = [
            row(1, "OP1", dt(20, 8, 0), dt(20, 12, 0)),
            row(2, "OP1", dt(20, 13, 30), dt(20, 17, 0)),
        ]
        groups = group_operator_days(rows, JKT)
        self.assertEqual(len(groups), 2, "gap 90 menit tanpa overlap harus menjadi 2 grup terpisah")

    def test_cross_midnight_dengan_gap_terpisah(self):
        rows = [
            row(1, "OP1", dt(20, 20, 0), dt(20, 23, 0)),
            row(2, "OP1", dt(21, 1, 0), dt(21, 4, 0)),
        ]
        groups = group_operator_days(rows, JKT)
        self.assertEqual(len(groups), 2, "cross-midnight dengan gap 2 jam harus menjadi 2 grup terpisah")


class TestCompleteDays(unittest.TestCase):
    """#15: hari berjalan tidak boleh dibekukan dari data parsial."""

    def test_hari_berjalan_dikecualikan(self):
        now = dt(21, 10, 0)
        rows = [
            row(1, "OP1", dt(20, 8, 0), dt(20, 16, 0)),   # kemarin: selesai
            row(2, "OP2", dt(21, 8, 0), dt(21, 9, 30)),   # hari ini: masih jalan
        ]
        keep = select_complete_days(rows, now=now, tz=JKT)
        ids = sorted(r["source_ref_id"] for r in keep)
        self.assertEqual(ids, [1], "hari berjalan harus ditahan sampai tanggal lokal selesai")

    def test_record_open_menahan_seluruh_operator_day(self):
        now = dt(22, 10, 0)
        rows = [
            row(1, "OP1", dt(21, 8, 0), dt(21, 12, 0)),
            row(2, "OP1", dt(21, 11, 0), None),  # overlap dengan row 1, belum checkout
        ]
        keep = select_complete_days(rows, now=now, tz=JKT)
        self.assertEqual(keep, [], "satu record open membuat operator-day belum final")

    def test_hari_lampau_yang_lengkap_diterima(self):
        now = dt(22, 10, 0)
        rows = [
            row(1, "OP1", dt(21, 8, 0), dt(21, 12, 0)),
            row(2, "OP1", dt(21, 10, 0), dt(21, 14, 0)),
        ]
        keep = select_complete_days(rows, now=now, tz=JKT)
        self.assertEqual(len(keep), 2)


class TestLimitByOperatorDay(unittest.TestCase):
    """#13: LIMIT tidak boleh memotong operator-day di tengah."""

    def test_limit_tidak_memotong_operator_day(self):
        rows = [
            row(1, "OP1", dt(20, 8, 0), dt(20, 12, 0)),
            row(2, "OP1", dt(20, 10, 0), dt(20, 14, 0)),  # overlap dengan row 1 -> 1 grup 2 row
            row(3, "OP2", dt(20, 8, 0), dt(20, 16, 0)),
        ]
        # limit=2 harus mengambil seluruh OP1 (2 row) dan berhenti.
        out = limit_by_operator_day(rows, limit=2, tz=JKT)
        ids = sorted(r["source_ref_id"] for r in out)
        self.assertEqual(ids, [1, 2])

    def test_limit_di_tengah_grup_membuang_seluruh_grup(self):
        rows = [
            row(1, "OP1", dt(20, 8, 0), dt(20, 12, 0)),
            row(2, "OP1", dt(20, 10, 0), dt(20, 14, 0)),
            row(3, "OP1", dt(20, 12, 0), dt(20, 16, 0)),  # overlap/tersambung -> 1 grup 3 row
        ]
        # limit=2 tidak cukup untuk grup 3-row -> tidak boleh mengirim sebagian.
        out = limit_by_operator_day(rows, limit=2, tz=JKT)
        self.assertEqual(out, [], "grup yang tidak muat harus ditunda utuh, bukan dipotong")

    def test_grup_pertama_selalu_lewat_walau_lebih_besar_dari_limit(self):
        # Kalau tidak, batch mandek selamanya pada operator-day besar.
        rows = [
            row(1, "OP1", dt(20, 8, 0), dt(20, 12, 0)),
            row(2, "OP1", dt(20, 10, 0), dt(20, 14, 0)),
            row(3, "OP1", dt(20, 12, 0), dt(20, 16, 0)),
        ]
        out = limit_by_operator_day(rows, limit=2, tz=JKT, allow_first_oversize=True)
        self.assertEqual(len(out), 3, "operator-day tunggal > limit harus tetap jalan utuh")


class TestCursor(unittest.TestCase):
    """#14: cursor memakai longdate_checkout NYATA, bukan source_max_end sintetis."""

    def test_cursor_memakai_checkout_nyata_maksimum(self):
        rows = [
            row(1, "OP1", dt(20, 8, 0), dt(20, 12, 0)),
            row(2, "OP1", dt(20, 13, 0), dt(20, 17, 0)),
        ]
        # source_max_end sintetis (checkin + effective) sengaja dibuat LEBIH KECIL
        rows[0]["source_max_end"] = dt(20, 9, 0)
        rows[1]["source_max_end"] = dt(20, 14, 0)
        cur = next_cursor_value(rows, fallback=dt(20, 0, 0))
        self.assertEqual(cur, dt(20, 17, 0), "cursor harus dari longdate_checkout, bukan nilai sintetis")

    def test_tanpa_baris_cursor_tidak_mundur(self):
        self.assertEqual(next_cursor_value([], fallback=dt(20, 6, 0)), dt(20, 6, 0))

    def test_record_open_tidak_memajukan_cursor(self):
        rows = [row(1, "OP1", dt(20, 8, 0), None)]
        cur = next_cursor_value(rows, fallback=dt(20, 6, 0))
        self.assertEqual(cur, dt(20, 6, 0), "record tanpa checkout tidak boleh memajukan cursor")


class TestProvenance(unittest.TestCase):
    """#17: snapshot harus dapat direkonsiliasi."""

    def test_provenance_menyimpan_keempat_angka(self):
        p = build_provenance(
            source_ref_id=1,
            bucket_start=dt(20, 8, 0),
            raw_seconds=14400,
            allocated_seconds=7200,
            cap_seconds=5400,
            sap_effective_seconds=5400,
        )
        # Work D explicit full names:
        self.assertEqual(p["raw_seconds"], 14400)
        self.assertEqual(p["allocated_seconds"], 7200)
        self.assertEqual(p["cap_seconds"], 5400)
        self.assertEqual(p["sap_effective_seconds"], 5400)
        self.assertEqual(p["allocation_version"], "effective-segments-v1")
        # Legacy short keys:
        self.assertEqual(p["raw_sec"], 14400)
        self.assertEqual(p["alloc_sec"], 7200)
        self.assertEqual(p["cap_sec"], 5400)
        self.assertEqual(p["sec"], 5400)

    def test_rekonsiliasi_menjelaskan_selisih(self):
        p = build_provenance(
            source_ref_id=1,
            bucket_start=dt(20, 8, 0),
            raw_seconds=14400,
            allocated_seconds=7200,
            cap_seconds=5400,
            sap_effective_seconds=5400,
        )
        # raw -> allocated dijelaskan oleh multitasking; allocated -> final oleh cap.
        self.assertEqual(p["raw_sec"] - p["alloc_sec"], 7200)
        self.assertEqual(p["alloc_sec"] - p["sec"], 1800)
        self.assertEqual(p["cap_applied"], True)

    def test_tanpa_cap_ditandai_false(self):
        p = build_provenance(
            source_ref_id=1,
            bucket_start=dt(20, 8, 0),
            raw_seconds=7200,
            allocated_seconds=7200,
            cap_seconds=None,
            sap_effective_seconds=7200,
        )
        self.assertEqual(p["cap_applied"], False)


class TestEmissionGate(unittest.TestCase):
    def test_excluded_tetap_companion_tapi_tidak_emit(self):
        from stage_batching import apply_emission_gate
        rows = [
            {"tsnumber": 1, "excluded": False, "master_complete": True},
            {"tsnumber": 2, "excluded": True, "master_complete": True},
        ]
        gated, blocked = apply_emission_gate(rows)
        self.assertTrue(gated[0]["emit"])
        self.assertFalse(gated[1]["emit"])
        self.assertEqual(blocked, [])

    def test_master_incomplete_blocked_bukan_emit(self):
        from stage_batching import apply_emission_gate
        rows = [{
            "tsnumber": 9, "excluded": False, "master_complete": False,
            "master_missing": ["confirmation_number"],
        }]
        gated, blocked = apply_emission_gate(rows)
        self.assertFalse(gated[0]["emit"])
        self.assertEqual(blocked[0]["tsnumber"], 9)
        self.assertIn("confirmation_number", blocked[0]["block_reason"])


class TestCutoffInStager(unittest.TestCase):
    """#18: cutoff harus benar-benar dipakai, bukan hanya tersedia."""

    def _rows(self, day):
        return [
            {"tsnumber": 1, "serialnumber": "OP", "source_ref_id": "1",
             "alloc_start": dt(day, 8), "alloc_end": dt(day, 12)},
            {"tsnumber": 2, "serialnumber": "OP", "source_ref_id": "2",
             "alloc_start": dt(day, 12), "alloc_end": dt(day, 16)},
        ]

    def test_grup_sebelum_cutoff_dibuang_utuh(self):
        from stage_batching import filter_by_cutoff
        kept, dropped = filter_by_cutoff(
            self._rows(20), JKT, date(2026, 9, 21)
        )
        self.assertEqual(kept, [])
        self.assertEqual(len(dropped), 2)

    def test_grup_pada_cutoff_dipertahankan(self):
        from stage_batching import filter_by_cutoff
        kept, dropped = filter_by_cutoff(
            self._rows(21), JKT, date(2026, 9, 21)
        )
        self.assertEqual(len(kept), 2)
        self.assertEqual(dropped, [])

    def test_cutoff_none_fail_closed(self):
        from stage_batching import filter_by_cutoff
        from stage_cutoff import CutoffError
        with self.assertRaises(CutoffError):
            filter_by_cutoff(self._rows(21), JKT, None)


if __name__ == "__main__":
    unittest.main(verbosity=2)
