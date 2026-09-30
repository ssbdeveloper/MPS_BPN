"""Cutoff dan auto-post per plant (review P1 #18).

Dipisah dari stager supaya aturannya bisa diuji tanpa DB, dan supaya poster
serta preview membaca definisi yang sama persis.
"""

from __future__ import annotations

from datetime import date


class CutoffError(RuntimeError):
    """Cutoff belum dikonfigurasi untuk plant ini."""


def allow_operator_day(day: date, cutoff: date | None) -> bool:
    """True bila operator-day berada pada atau setelah cutoff plant.

    FAIL-CLOSED saat cutoff tidak diset. Alternatifnya — menganggap "tidak ada
    cutoff" berarti "proses semuanya" — akan menarik seluruh sejarah timesheet
    ke staging pada eksekusi pertama dan membekukannya permanen. Kesalahan itu
    tidak bisa dibatalkan, jadi ketiadaan konfigurasi harus berhenti, bukan
    menebak.
    """
    if cutoff is None:
        raise CutoffError(
            "timesheet_allocation_cutoff_date belum diset di plant_config. "
            "Set tanggal mulai alokasi sebelum menjalankan staging."
        )
    return day >= cutoff


def auto_post_allowed(config: dict) -> bool:
    """True HANYA bila auto_post_enabled bernilai boolean True.

    Perbandingan identitas disengaja: string "false" bernilai truthy di Python,
    dan nilai konfigurasi sering datang sebagai teks dari JSON/env. `if
    config.get("auto_post_enabled")` akan menghidupkan auto-post justru ketika
    seseorang menulis "false".
    """
    return config.get("auto_post_enabled") is True


def load_plant_cutoff(conn, plant: str) -> date | None:
    """Baca cutoff plant dari plant_config."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT timesheet_allocation_cutoff_date
                 FROM plant_config
                WHERE plant_code = %s
                ORDER BY id LIMIT 1""",
            (plant,),
        )
        row = cur.fetchone()
    return row[0] if row else None
