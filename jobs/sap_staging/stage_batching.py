"""Pengelompokan operator-day dan batching staging (review P1 #12-#17).

Kenapa modul terpisah dari stage_timesheet_transaction.py: aturan di sini murni
(tanpa DB), sehingga bisa diuji langsung. Versi sebelumnya menyandarkan aturan
yang sama pada SQL, dan kesalahannya baru muncul di production.

KEPUTUSAN DESAIN — kenapa BUKAN boundary jam tetap
--------------------------------------------------
Godaan pertama untuk "operator-day lintas tengah malam" adalah memilih jam
batas (mis. 05:00) dan menyebut segalanya sebelum itu milik hari sebelumnya.
Itu ditolak karena diukur, bukan dikira: distribusi jam check-in 1-21 September
tidak punya jam sepi di kedua plant.

    Cikupa   00:00 ada 1.001 check-in, 01:00 ada 751, 05:00 ada 1.416
    BPN      01:00 ada 872,   02:00 ada 1.352, 22:00 ada 1.513

Boundary apa pun akan membelah shift nyata. Maka operator-day di sini dibentuk
dari KONEKTIVITAS OVERLAP: dua record milik operator yang sama berada dalam satu
operator-day bila jendela waktunya bersinggungan, langsung atau lewat rantai
record lain. Itu tepat sesuai kebutuhan alokasi — pembagi sebuah irisan hanyalah
record yang benar-benar menyinggungnya — dan tidak butuh tebakan jam sama sekali.

Label tanggal tetap diturunkan (untuk pelaporan) dari check-in paling awal dalam
komponen, sehingga shift malam dilaporkan pada tanggal ia dimulai.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, tzinfo
from typing import Iterable

def _as_local(value: datetime, tz: tzinfo) -> datetime:
    return value.astimezone(tz)


def operator_day_key(serial: str, start: datetime, end: datetime | None, tz: tzinfo):
    """Kunci operator-day untuk SATU record, berdasar awal rangkaian kerjanya.

    Dipakai untuk kasus sederhana dan untuk test; pengelompokan sebenarnya
    memakai group_operator_days() yang melihat seluruh himpunan record.

    Shift yang dimulai malam dan berakhir setelah tengah malam dilaporkan pada
    tanggal MULAI. Record yang check-in dini hari tetapi masih menyambung shift
    malam sebelumnya ikut tanggal mulai shift itu — di group_operator_days hal
    ini ditentukan oleh konektivitas, bukan oleh jam.
    """
    s = _as_local(start, tz)
    # Untuk record tunggal tanpa konteks: dini hari (< 05:00) diperlakukan
    # sebagai lanjutan hari sebelumnya. Ini HANYA fallback; jalur produksi
    # memakai group_operator_days yang tidak bergantung pada angka ini.
    if s.hour < 5:
        return (serial, (s - timedelta(days=1)).date())
    return (serial, s.date())


def group_operator_days(rows: Iterable[dict], tz: tzinfo) -> dict:
    """Kelompokkan record menjadi operator-day lewat konektivitas overlap aktual.

    Dua record milik operator yang sama masuk satu grup HANYA bila intervalnya
    benar-benar overlap (bersinggungan dalam rentang waktu nyata).
    GAP_TOLERANCE dihapus: gap berapa pun (30, 60, 90 menit) tanpa overlap
    menghasilkan grup terpisah. Cross-midnight tetap satu grup hanya bila
    intervalnya benar-benar beririsan/tersambung.
    """
    by_operator: dict[str, list[dict]] = {}
    for r in rows:
        by_operator.setdefault(r["serialnumber"], []).append(r)

    groups: dict = {}
    for serial, items in by_operator.items():
        # Urutkan berdasar awal; komponen dibentuk sekali jalan.
        def _start(r):
            return _as_local(r["alloc_start"], tz)

        def _end(r):
            e = r.get("alloc_end") or r.get("longdate_checkout") or r["alloc_start"]
            return _as_local(e, tz)

        items = sorted(items, key=_start)
        current: list[dict] = []
        current_end: datetime | None = None
        group_idx = 0

        for r in items:
            s, e = _start(r), _end(r)
            # Tanpa GAP_TOLERANCE: jika s > current_end, ada gap > 0 (tidak overlap).
            if current and current_end is not None and s > current_end:
                key = (serial, _group_date(current, tz), group_idx)
                groups[key] = current
                group_idx += 1
                current, current_end = [], None
            current.append(r)
            current_end = e if current_end is None else max(current_end, e)

        if current:
            key = (serial, _group_date(current, tz), group_idx)
            groups[key] = current

    return groups


def _group_date(items: list[dict], tz: tzinfo) -> date:
    """Tanggal laporan sebuah komponen = tanggal check-in paling awal."""
    earliest = min(_as_local(r["alloc_start"], tz) for r in items)
    return earliest.date()


def select_complete_days(
    rows: list[dict],
    now: datetime,
    tz: tzinfo,
    blocked: list[dict] | None = None,
) -> list[dict]:
    """#15: hanya operator-day yang SUDAH SELESAI yang boleh dialokasikan.

    Tiga syarat, semuanya wajib:
      1. Tanggal lokal operator-day itu sudah lewat (bukan hari berjalan).
      2. Tidak ada record terbuka (tanpa checkout) di dalamnya.
      3. Tidak ada row BLOCKED (master/confirmation tidak lengkap) di dalamnya.

    `blocked` berisi row yang dinyatakan BLOCKED oleh apply_emission_gate().
    Tanpa syarat ketiga, satu row BLOCKED akan ditahan dari emit tanpa pernah
    muncul di audit, sehingga operator-day-nya tampak selesai padahal tidak.

    Alasannya matematis: alokasi membagi setiap irisan waktu di antara job yang
    bersamaan. Kalau job kedua baru akan di-check-in nanti sore, pembagi hari ini
    salah, dan record sumber sudah terlanjur terkunci permanen oleh freeze.
    """
    today_local = _as_local(now, tz).date()

    all_rows = list(rows)
    seen = {id(r) for r in all_rows}
    for row in (blocked or []):
        if id(row) not in seen:
            all_rows.append(row)

    groups = group_operator_days(all_rows, tz)
    blocked_ids = {r.get("tsnumber") for r in (blocked or [])}

    keep: list[dict] = []
    for (_serial, day, *_), items in groups.items():
        if day >= today_local:
            continue  # hari berjalan (atau masa depan): belum final
        if any((r.get("alloc_end") or r.get("longdate_checkout")) is None for r in items):
            continue  # ada record terbuka: operator-day belum selesai
        if any(r.get("open_row_block") for r in items):
            continue  # operator punya record terbuka di sekitar window ini
        if any(r.get("tsnumber") in blocked_ids for r in items):
            continue  # ada row BLOCKED: jangan bekukan sebagian
        keep.extend(r for r in items if r.get("tsnumber") not in blocked_ids)

    keep.sort(key=lambda r: (r["alloc_start"], r["source_ref_id"]))
    return keep


def filter_by_cutoff(
    rows: list[dict],
    tz: tzinfo,
    cutoff: date | None,
) -> tuple[list[dict], list[dict]]:
    """#18: buang seluruh operator-day yang berada sebelum cutoff plant.

    Dipisah dari select_complete_days supaya cutoff dan kelengkapan hari tidak
    tercampur: cutoff adalah kebijakan plant (jangan hitung ulang histori yang
    sudah terposting dengan rumus lama), sedangkan kelengkapan hari adalah fakta
    data. Keduanya tetap dijalankan pada grup yang sama.

    cutoff None -> fail-closed (lihat stage_cutoff.allow_operator_day): tanpa
    konfigurasi, staging akan menarik seluruh sejarah dan membekukannya.
    """
    from stage_cutoff import allow_operator_day

    groups = group_operator_days(rows, tz)
    keep: list[dict] = []
    dropped: list[dict] = []
    for (_serial, day, *_), items in groups.items():
        if allow_operator_day(day, cutoff):
            keep.extend(items)
        else:
            dropped.extend(items)

    keep.sort(key=lambda r: (r["alloc_start"], r["source_ref_id"]))
    return keep, dropped


def limit_by_operator_day(
    rows: list[dict],
    limit: int,
    tz: tzinfo,
    allow_first_oversize: bool = False,
) -> list[dict]:
    """#13: terapkan LIMIT pada batas operator-day, bukan di tengahnya.

    `rows[:limit]` yang lama bisa mengirim satu job dari sepasang multitask dan
    menahan pasangannya. Job yang terkirim dihitung seolah bekerja sendirian —
    yaitu jam penuh, bukan setengah — lalu record-nya dibekukan. Batch
    berikutnya tidak bisa memperbaikinya.

    allow_first_oversize mencegah kemandekan: satu operator-day yang lebih besar
    dari limit tetap dikirim utuh, jika tidak batch tidak akan pernah maju.
    """
    groups = group_operator_days(rows, tz)

    ordered_keys = sorted(
        groups.keys(),
        key=lambda k: min(r["alloc_start"] for r in groups[k]),
    )

    out: list[dict] = []
    for i, key in enumerate(ordered_keys):
        items = groups[key]
        if len(out) + len(items) > limit:
            if i == 0 and allow_first_oversize and not out:
                out.extend(items)
            break
        out.extend(items)

    out.sort(key=lambda r: (r["alloc_start"], r["source_ref_id"]))
    return out


def next_cursor_value(rows: list[dict], fallback: datetime) -> datetime:
    """#14: majukan cursor dengan longdate_checkout NYATA.

    Versi lama memakai source_max_end = check-in + effective_seconds. Itu nilai
    SINTETIS: setelah break dipotong atau cap diterapkan, ia lebih kecil dari
    checkout sebenarnya, sehingga cursor tertinggal dan record yang sama
    di-stage ulang. Bila alokasi justru melebarkannya, cursor melompat dan
    record terlewat sama sekali.

    Record terbuka (tanpa checkout) tidak pernah memajukan cursor: pekerjaannya
    belum selesai, jadi belum ada yang bisa dianggap final.
    """
    # Tidak ada slicing rows[:limit] dan tidak ada cursor dari source_max_end
    # (sintetis). Untuk record terbuka, 'ends' kosong sehingga cursor KEMBALI ke
    # fallback (bukan melompat ke to_ts), jadi tidak ada row yang terlewat.
    ends = [
        r["longdate_checkout"]
        for r in rows
        if r.get("longdate_checkout") is not None
    ]
    if not ends:
        return fallback
    return max(ends)


def apply_emission_gate(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Tentukan emit tanpa membuang companion faktual.

    Exclusion hanya berarti jangan kirim row itu ke SAP; intervalnya tetap hadir
    sebagai pembagi multitasking. Master incomplete juga tidak emit, tetapi wajib
    dilaporkan BLOCKED agar bisa diperbaiki tanpa payload kosong masuk staging.
    """
    gated: list[dict] = []
    blocked: list[dict] = []
    for source in rows:
        row = dict(source)
        in_window = row.get("in_window", row.get("emit", True)) is not False
        excluded = bool(row.get("excluded"))
        master_complete = row.get("master_complete", True) is True
        row["emit"] = bool(in_window and not excluded and master_complete)
        if in_window and not excluded and not master_complete:
            missing = [str(v) for v in (row.get("master_missing") or ["master_sap"])]
            blocked.append({
                **row,
                "block_reason": "missing_master:" + ",".join(missing),
            })
        gated.append(row)
    return gated, blocked


def build_provenance(
    source_ref_id,
    bucket_start: datetime,
    raw_seconds: int,
    allocated_seconds: int,
    cap_seconds: int | None,
    sap_effective_seconds: int,
    allocation_version: str = "effective-segments-v1",
) -> dict:
    """#17: snapshot yang bisa direkonsiliasi.

    Menyimpan snapshot lengkap (raw_seconds, allocated_seconds, cap_seconds,
    sap_effective_seconds, allocation_version) serta alias singkat kompatibel
    sehingga selisihnya bisa dijelaskan tanpa menghitung ulang:
        raw_seconds - allocated_seconds = jam multitasking terbagi
        allocated_seconds - sap_effective_seconds = jam terpangkas cap
    """
    raw_s = int(raw_seconds)
    alloc_s = int(allocated_seconds)
    cap_s = None if cap_seconds is None else int(cap_seconds)
    eff_s = int(sap_effective_seconds)
    cap_applied = cap_s is not None and eff_s < alloc_s

    return {
        "id": str(source_ref_id),
        "bucket": bucket_start.isoformat(),
        # Format eksplisit Work D:
        "raw_seconds": raw_s,
        "allocated_seconds": alloc_s,
        "cap_seconds": cap_s,
        "sap_effective_seconds": eff_s,
        "allocation_version": str(allocation_version),
        # Alias legacy untuk kompatibilitas mundur:
        "raw_sec": raw_s,
        "alloc_sec": alloc_s,
        "cap_sec": cap_s,
        "sec": eff_s,
        "cap_applied": cap_applied,
    }
