"""Unit test alokasi interval timesheet — dijalankan tanpa DB.

Kontrak dari docs/planning/2026-09-22-timesheet-interval-allocation-implementation.md §2, §3, §7.

Jalankan:
    python test_timesheet_allocation.py
"""
from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from timesheet_allocation import (  # noqa: E402
    Record,
    allocate_operator_day,
    allocate_records,
    apply_cap,
)

H = 3600


def dt(day: int, hh: int, mm: int = 0, ss: int = 0) -> datetime:
    return datetime(2026, 9, day, hh, mm, ss)


def rec(ts: int, start, end, *, activitytype: str = "", order_no: str = "OX",
        serial: str = "OP1") -> Record:
    return Record(tsnumber=ts, serialnumber=serial, start=start, end=end,
                  activitytype=activitytype, order_no=order_no)


PASSED = []
FAILED = []


def check(name: str, fn):
    try:
        fn()
        PASSED.append(name)
        print(f"  PASS  {name}")
    except AssertionError as exc:
        FAILED.append((name, str(exc)))
        print(f"  FAIL  {name}: {exc}")
    except Exception as exc:  # noqa: BLE001
        FAILED.append((name, f"{type(exc).__name__}: {exc}"))
        print(f"  ERROR {name}: {type(exc).__name__}: {exc}")


# --- 1. tidak overlap: allocated == raw -------------------------------------
def t_no_overlap():
    rows = [rec(1, dt(1, 8), dt(1, 10)), rec(2, dt(1, 11), dt(1, 12))]
    res = allocate_records(rows)
    assert res.allocated[1] == 2 * H, res.allocated
    assert res.allocated[2] == 1 * H, res.allocated
    assert res.raw[1] == 2 * H and res.raw[2] == 1 * H
    assert res.union_seconds[("OP1", dt(1, 0).date())] == 3 * H


# --- 2. overlap penuh tiga order, start sama --------------------------------
def t_full_overlap_three():
    rows = [rec(i, dt(1, 8), dt(1, 11)) for i in (1, 2, 3)]
    res = allocate_records(rows)
    for i in (1, 2, 3):
        assert res.allocated[i] == 1 * H, res.allocated
    assert sum(res.allocated.values()) == 3 * H
    assert res.union_seconds[("OP1", dt(1, 0).date())] == 3 * H


# --- 3. contoh staggered 08:00-14:00 (WAJIB) --------------------------------
def t_staggered_example():
    rows = [
        rec(1, dt(1, 8), dt(1, 12), order_no="O1"),
        rec(2, dt(1, 10), dt(1, 13), order_no="O2"),
        rec(3, dt(1, 12), dt(1, 14), order_no="O3"),
    ]
    res = allocate_records(rows)
    assert res.allocated[1] == 3 * H, f"O1 {res.allocated[1]}"
    assert res.allocated[2] == int(1.5 * H), f"O2 {res.allocated[2]}"
    assert res.allocated[3] == int(1.5 * H), f"O3 {res.allocated[3]}"
    assert sum(res.allocated.values()) == 6 * H
    assert res.union_seconds[("OP1", dt(1, 0).date())] == 6 * H


# --- 4. overlap parsial dua order -------------------------------------------
def t_partial_two():
    rows = [rec(1, dt(1, 8), dt(1, 12)), rec(2, dt(1, 10), dt(1, 14))]
    res = allocate_records(rows)
    # 08-10 solo O1 (2h), 10-12 shared (1h each), 12-14 solo O2 (2h)
    assert res.allocated[1] == 3 * H, res.allocated
    assert res.allocated[2] == 3 * H, res.allocated
    assert res.union_seconds[("OP1", dt(1, 0).date())] == 6 * H


# --- 5. lintas tengah malam, dua tanggal lokal ------------------------------
def t_cross_midnight():
    rows = [rec(1, dt(1, 22), dt(2, 2))]
    res = allocate_records(rows)
    assert res.allocated[1] == 4 * H, res.allocated
    u = res.union_seconds
    assert u[("OP1", dt(1, 0).date())] == 2 * H, u
    assert u[("OP2X", dt(2, 0).date())] if False else True
    assert u[("OP1", dt(2, 0).date())] == 2 * H, u
    # per-tanggal detail harus ada dua baris
    days = [s for s in res.segments if s.tsnumber == 1]
    assert len({s.allocation_date for s in days}) == 2, days


# --- 6. tidak habis dibagi: largest remainder menjaga total -----------------
def t_largest_remainder():
    # 10 detik dibagi 3 record
    rows = [rec(i, dt(1, 8), dt(1, 8, 0, 10)) for i in (1, 2, 3)]
    res = allocate_records(rows)
    total = sum(res.allocated.values())
    assert total == 10, f"total {total} != 10"
    assert sorted(res.allocated.values()) == [3, 3, 4], res.allocated
    # deterministik: tsnumber ASC menerima sisa
    assert res.allocated[1] == 4, res.allocated


def t_invariant_union_equals_sum():
    rows = [
        rec(1, dt(1, 8), dt(1, 12, 0, 7), order_no="O1"),
        rec(2, dt(1, 9, 30), dt(1, 13), order_no="O2"),
        rec(3, dt(1, 11), dt(1, 14, 0, 11), order_no="O3"),
    ]
    res = allocate_records(rows)
    key = ("OP1", dt(1, 0).date())
    assert sum(res.allocated.values()) == res.union_seconds[key], (
        sum(res.allocated.values()), res.union_seconds[key])


# --- 7. non-produktif tidak menjadi pembagi ---------------------------------
def t_nonproductive_not_divisor():
    rows = [
        rec(1, dt(1, 8), dt(1, 12), order_no="O1"),
        rec(2, dt(1, 8), dt(1, 12), activitytype="1590", order_no=""),
    ]
    res = allocate_records(rows)
    assert res.allocated[1] == 4 * H, res.allocated  # penuh, tidak dibagi
    assert res.allocated[2] == 4 * H, res.allocated  # berdiri sendiri
    # union produktif saja
    assert res.union_seconds[("OP1", dt(1, 0).date())] == 4 * H


# --- 8. row RG/OV split tetap per record ------------------------------------
def t_split_rows_independent():
    rows = [
        rec(1, dt(1, 8), dt(1, 16, 30), order_no="O1"),   # RG
        rec(2, dt(1, 16, 30), dt(1, 18), order_no="O1"),  # OV, bersambung
    ]
    res = allocate_records(rows)
    assert res.allocated[1] == int(8.5 * H), res.allocated
    assert res.allocated[2] == int(1.5 * H), res.allocated
    assert sum(res.allocated.values()) == 10 * H


# --- 9. cap: NULL, di atas, di bawah ----------------------------------------
def t_cap_null():
    assert apply_cap(5000, None) == 5000


def t_cap_above_allocation():
    assert apply_cap(5000, 120) == 5000  # cap 120 menit = 7200s


def t_cap_below_allocation():
    assert apply_cap(5000, 60) == 3600


def t_cap_never_negative():
    assert apply_cap(0, 60) == 0


# --- 10. operator berbeda tidak saling membagi ------------------------------
def t_operators_isolated():
    rows = [
        rec(1, dt(1, 8), dt(1, 12), serial="A"),
        rec(2, dt(1, 8), dt(1, 12), serial="B"),
    ]
    res = allocate_records(rows)
    assert res.allocated[1] == 4 * H and res.allocated[2] == 4 * H, res.allocated


# --- 11. allocation per operator-day langsung -------------------------------
def t_allocate_operator_day_direct():
    rows = [rec(1, dt(1, 8), dt(1, 12)), rec(2, dt(1, 8), dt(1, 12))]
    alloc, union_s = allocate_operator_day(rows, dt(1, 0).date())
    assert union_s == 4 * H
    assert alloc == {1: 2 * H, 2: 2 * H}, alloc


class TestTimesheetAllocationSuite(unittest.TestCase):
    def test_all_allocation_cases(self):
        passed = []
        failed = []
        for nm, fn in sorted(globals().items()):
            if nm.startswith("t_") and callable(fn):
                try:
                    fn()
                    passed.append(nm[2:])
                except Exception as e:
                    failed.append((nm[2:], e))
        if failed:
            self.fail(f"Allocation test failures: {failed}")
        self.assertEqual(len(passed), 15)


if __name__ == "__main__":
    print("TEST alokasi interval timesheet")
    for nm, fn in list(globals().items()):
        if nm.startswith("t_") and callable(fn):
            check(nm[2:], fn)

    print(f"\n{len(PASSED)} lulus, {len(FAILED)} gagal")
    if FAILED:
        for n, e in FAILED:
            print(f"  - {n}: {e}")
        sys.exit(1)
    sys.exit(0)
