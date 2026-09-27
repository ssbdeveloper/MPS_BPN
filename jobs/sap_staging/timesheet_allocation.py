"""Alokasi jam timesheet berbasis interval (sweep-line eksak).

Kontrak: docs/planning/2026-09-22-timesheet-interval-allocation-implementation.md

Istilah (jangan dicampur):
    raw_seconds           durasi timestamp asli satu tsnumber
    union_seconds         total waktu unik operator; union interval PRODUKTIF
    allocated_seconds     bagian waktu satu tsnumber, sebelum cap
    sap_effective_seconds allocated_seconds setelah cap per record

Invariant:
    SUM(allocated_seconds) per operator + tanggal lokal == union_seconds
    0 <= sap_effective_seconds <= allocated_seconds

Algoritma (bukan bucket menit, bukan AVG/MAX duration):
    1. record produktif di-clip pada batas tanggal lokal;
    2. per operator-tanggal kumpulkan semua titik batas;
    3. pasangan titik berurutan = satu irisan;
    4. bagi eksak segment_seconds / active_count memakai Fraction;
    5. largest remainder hanya di batas akhir operator-tanggal;
    6. tie-break deterministik: sisa terbesar dulu, lalu tsnumber ASC.

Non-produktif tidak pernah menjadi pembagi dan tidak masuk union; jamnya
berdiri sendiri (raw, di-clip per tanggal).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from fractions import Fraction
from typing import Iterable


@dataclass(frozen=True)
class Record:
    """Satu baris timesheet_transaction dalam waktu LOKAL plant (naive)."""

    tsnumber: int
    serialnumber: str
    start: datetime
    end: datetime
    activitytype: str = ""
    order_no: str = ""

    @property
    def is_productive(self) -> bool:
        """Produktif = punya order dan activitytype kosong.

        Sama dengan aturan stager: `COALESCE(activitytype,'') <> ''` menandai
        record non-produktif.
        """
        return bool((self.order_no or "").strip()) and not (self.activitytype or "").strip()

    @property
    def raw_seconds(self) -> int:
        return int((self.end - self.start).total_seconds())


@dataclass(frozen=True)
class Segment:
    """Detail alokasi per tsnumber per tanggal lokal."""

    tsnumber: int
    serialnumber: str
    allocation_date: date
    segment_start: datetime
    segment_end: datetime
    active_count: int
    allocated_seconds: int


@dataclass
class AllocationResult:
    raw: dict[int, int] = field(default_factory=dict)
    allocated: dict[int, int] = field(default_factory=dict)
    union_seconds: dict[tuple[str, date], int] = field(default_factory=dict)
    segments: list[Segment] = field(default_factory=list)


def _clip_days(rec: Record) -> Iterable[tuple[date, datetime, datetime]]:
    """Pecah satu record pada batas tanggal lokal."""
    cur = rec.start
    while cur < rec.end:
        day = cur.date()
        day_end = datetime.combine(day + timedelta(days=1), datetime.min.time())
        seg_end = min(rec.end, day_end)
        if seg_end > cur:
            yield day, cur, seg_end
        cur = seg_end


def _largest_remainder(exact: dict[int, Fraction], total: int) -> dict[int, int]:
    """Bulatkan bagian eksak ke detik bulat tanpa mengubah totalnya.

    Tie-break deterministik: sisa pecahan terbesar dulu, lalu tsnumber ASC.
    """
    if not exact:
        return {}
    floors = {ts: int(v) for ts, v in exact.items()}
    assigned = sum(floors.values())
    remainder = total - assigned
    if remainder > 0:
        order = sorted(exact, key=lambda ts: (-(exact[ts] - int(exact[ts])), ts))
        for ts in order[:remainder]:
            floors[ts] += 1
    elif remainder < 0:
        # Hanya mungkin bila total < jumlah floor; ambil dari bagian terkecil.
        order = sorted(exact, key=lambda ts: ((exact[ts] - int(exact[ts])), ts))
        for ts in order[: -remainder]:
            floors[ts] -= 1
    return floors


def allocate_operator_day(
    records: Iterable[Record], day: date
) -> tuple[dict[int, int], int]:
    """Alokasi satu operator pada satu tanggal lokal.

    `records` sudah difilter untuk operator itu; hanya record produktif yang
    dibagi. Mengembalikan (allocated_per_tsnumber, union_seconds).
    """
    day_start = datetime.combine(day, datetime.min.time())
    day_end = day_start + timedelta(days=1)

    spans: dict[int, tuple[datetime, datetime]] = {}
    for rec in records:
        if not rec.is_productive:
            continue
        s, e = max(rec.start, day_start), min(rec.end, day_end)
        if e > s:
            spans[rec.tsnumber] = (s, e)
    if not spans:
        return {}, 0

    points = sorted({p for se in spans.values() for p in se})
    exact: dict[int, Fraction] = defaultdict(Fraction)
    union_seconds = 0
    for i in range(len(points) - 1):
        s, e = points[i], points[i + 1]
        span = int((e - s).total_seconds())
        if span <= 0:
            continue
        active = [ts for ts, (rs, re_) in spans.items() if rs <= s and re_ >= e]
        if not active:
            continue
        union_seconds += span
        share = Fraction(span, len(active))
        for ts in active:
            exact[ts] += share

    return _largest_remainder(dict(exact), union_seconds), union_seconds


def allocate_records(records: Iterable[Record]) -> AllocationResult:
    """Alokasi penuh untuk sekumpulan record lintas operator dan tanggal."""
    records = list(records)
    result = AllocationResult()
    for rec in records:
        result.raw[rec.tsnumber] = rec.raw_seconds
        result.allocated[rec.tsnumber] = 0

    # Kelompokkan per operator-tanggal, memakai potongan harian.
    by_op_day: dict[tuple[str, date], list[Record]] = defaultdict(list)
    for rec in records:
        for day, s, e in _clip_days(rec):
            by_op_day[(rec.serialnumber, day)].append(
                Record(rec.tsnumber, rec.serialnumber, s, e, rec.activitytype, rec.order_no)
            )

    for (serial, day), day_records in sorted(by_op_day.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        alloc, union_s = allocate_operator_day(day_records, day)
        if union_s:
            result.union_seconds[(serial, day)] = union_s
        for ts, secs in alloc.items():
            result.allocated[ts] += secs
            src = next(r for r in day_records if r.tsnumber == ts)
            result.segments.append(
                Segment(
                    tsnumber=ts,
                    serialnumber=serial,
                    allocation_date=day,
                    segment_start=src.start,
                    segment_end=src.end,
                    active_count=0,
                    allocated_seconds=secs,
                )
            )
        # Non-produktif: jamnya sendiri, di-clip per tanggal, tidak dibagi.
        for rec in day_records:
            if not rec.is_productive:
                secs = int((rec.end - rec.start).total_seconds())
                result.allocated[rec.tsnumber] += secs
                result.segments.append(
                    Segment(
                        tsnumber=rec.tsnumber,
                        serialnumber=serial,
                        allocation_date=day,
                        segment_start=rec.start,
                        segment_end=rec.end,
                        active_count=1,
                        allocated_seconds=secs,
                    )
                )
    return result


def apply_cap(allocated_seconds: int, cap_minutes: int | None) -> int:
    """sap_effective_seconds = min(allocated_seconds, cap). NULL = No Limit.

    Sama dengan perilaku stager existing: cap NULL lolos utuh, hasil tidak
    pernah negatif.
    """
    value = max(int(allocated_seconds), 0)
    if cap_minutes is None:
        return value
    return min(value, max(int(cap_minutes), 0) * 60)
