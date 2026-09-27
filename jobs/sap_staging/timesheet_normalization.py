"""Normalisasi input timesheet bersama untuk stager dan preview.

Kontrak final:
- timestamp dipotong ke presisi detik sebelum perhitungan;
- window tanggal berbentuk [clip_start, clip_end);
- produktif tidak dipotong break;
- non-produktif dipotong break yang dikonfigurasi per plant;
- cap dipilih dari map per activitytype, lalu fallback kategori.

Modul ini murni/tanpa DB agar preview dan stager tidak dapat menyimpang diam-diam.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta
from typing import Iterable


def truncate_second(value: datetime) -> datetime:
    return value.replace(microsecond=0)


def cap_minutes_for(activitytype: str, rules: dict, category: str | None = None) -> int | None:
    key = (activitytype or "").strip()
    caps = ((rules.get("max_record_minutes") or {}).get("timesheet") or {})
    if key in caps:
        value = caps[key]
        return None if value is None else int(value)
    fallback = rules.get("max_record_fallback") or {}
    if category and category in fallback:
        value = fallback[category]
        return None if value is None else int(value)
    cat_map = rules.get("activity_categories") or {}
    if key in cat_map:
        cat = cat_map[key]
        if cat in fallback:
            value = fallback[cat]
            return None if value is None else int(value)
    value = fallback.get("va" if key == "" else "nva")
    return None if value is None else int(value)


def _parse_time(value: str) -> time:
    return time.fromisoformat(value)


def break_overlap_seconds(start: datetime, end: datetime, activitytype: str, rules: dict) -> int:
    """Hitung overlap break untuk record non-produktif dalam waktu lokal plant."""
    if not (activitytype or "").strip() or end <= start:
        return 0

    total = 0
    day = start.date()
    while day <= end.date():
        # Python weekday: Monday=0. PostgreSQL DOW config: Sunday=0, Monday=1.
        pg_dow = (day.weekday() + 1) % 7
        day_start = datetime.combine(day, time.min)
        for window in rules.get("break_windows") or []:
            if pg_dow not in {int(v) for v in (window.get("days") or [])}:
                continue
            win_start = datetime.combine(day, _parse_time(window["start"]))
            win_end = datetime.combine(day, _parse_time(window["end"]))
            # Konfigurasi overnight tetap didukung, walau konfigurasi saat ini
            # memakai window yang seluruhnya berada dalam satu tanggal.
            if win_end <= win_start:
                win_end += timedelta(days=1)
            overlap_start = max(start, win_start)
            overlap_end = min(end, win_end)
            if overlap_end > overlap_start:
                total += int((overlap_end - overlap_start).total_seconds())
        day = (day_start + timedelta(days=1)).date()
    return total


def normalize_timesheet_rows(
    rows: Iterable[dict],
    rules: dict,
    *,
    clip_start: datetime | None = None,
    clip_end: datetime | None = None,
) -> list[dict]:
    """Normalisasi row mentah menjadi input `allocate_staging_rows`.

    `start`/`end` wajib berupa datetime lokal plant (naive atau aware konsisten).
    Clipping dilakukan setelah trunc detik dan memakai interval setengah terbuka.
    """
    start_bound = truncate_second(clip_start) if clip_start else None
    end_bound = truncate_second(clip_end) if clip_end else None
    out: list[dict] = []

    for source in rows:
        start = truncate_second(source["start"])
        end = truncate_second(source["end"])
        if start_bound is not None:
            start = max(start, start_bound)
        if end_bound is not None:
            end = min(end, end_bound)
        if end <= start:
            continue

        row = dict(source)
        activitytype = row.get("activitytype") or ""
        row["alloc_start"] = start
        row["alloc_end"] = end
        row["raw_seconds"] = int((end - start).total_seconds())
        # Simpan raw timestamp terpisah. allocate_staging_rows secara historis
        # memakai raw_seconds sebagai nilai setelah break untuk non-produktif;
        # provenance tetap wajib merekam checkout-checkin yang asli.
        row["timestamp_raw_seconds"] = row["raw_seconds"]
        row["break_seconds"] = break_overlap_seconds(start, end, activitytype, rules)
        row["cap_minutes"] = cap_minutes_for(activitytype, rules)
        out.append(row)

    return out
