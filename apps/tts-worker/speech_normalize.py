"""
speech_normalize.py — ubah teks issue log EWS jadi Indonesia penuh SEBELUM disuarakan.

Issue log sengaja mengandung istilah Inggris (OEE, running, loss, downtime, record,
workcenter, Labour, dst.) dan angka desimal titik ("3.83"). Kalau teks itu langsung
diumpankan ke TTS suara Indonesia, hasilnya campur & terdengar salah. Fungsi
`normalize_for_speech()` menerjemahkan/mengeja istilah tsb dan mengindonesiakan angka,
TANPA mengubah issue log itu sendiri (hanya audio yang berubah).

Dipakai oleh generate_ews_audio.py (worker produksi) dan preview_ews_tts.py (test lokal),
supaya suara keduanya identik.

Aturan diterapkan berurutan: FRASA dulu (agar konteks menang atas kata tunggal), lalu
KATA tunggal, lalu AKRONIM (dieja per huruf), lalu simbol & angka.
"""
import re

# Frasa — harus lebih dulu dari kata tunggal supaya "input timesheet" jadi "mengisi
# timesheet", bukan "data timesheet".
_PHRASE_RULES = [
    (r"\bexpected so far\b", "target sejauh ini"),
    (r"\bshift standard\b", "standar shift"),
    (r"\bmaster SAP\b", "data induk es a pe"),
    (r"\blogin timesheet\b", "mencatat jam kerja"),
    (r"\binput timesheet\b", "mencatat jam kerja"),
    (r"\boperator unidentified\b", "operator tidak teridentifikasi"),
]

# Kata tunggal (case-insensitive). Istilah yang sudah lazim dalam Bahasa Indonesia lisan
# pabrik (shift, order, operator, timesheet, produktif, valid) sengaja DIBIARKAN.
_WORD_RULES = [
    (r"\brunning\b", "berjalan"),
    (r"\bloss\b", "waktu hilang"),
    (r"\bdowntime\b", "waktu henti"),
    (r"\bidle\b", "menganggur"),
    (r"\bsetup\b", "persiapan"),
    (r"\bworkcenter\b", "pusat kerja"),
    (r"\badoption\b", "adopsi"),
    (r"\bunidentified\b", "tidak teridentifikasi"),
    (r"\brecord\b", "data"),
    (r"\bconfirmation\b", "konfirmasi"),
    (r"\binput\b", "data"),
    (r"\blogin\b", "masuk"),
    (r"\bpower\b", "daya"),
    (r"\buptime\b", "waktu aktif"),
    (r"\bjobid\b", "nomor pekerjaan"),
    (r"\blabou?r\b", "tenaga kerja"),
    (r"\btimesheet\b", "catatan jam kerja"),
    (r"\bmaster\b", "induk"),
]

# Akronim — dieja per huruf agar suara ID tak membacanya sebagai kata Inggris.
# Case-sensitive (hanya bentuk kapital).
_ACRONYM_RULES = [
    (r"\bOEE\b", "O E E"),
    (r"\bOLE\b", "O L E"),
    (r"\bHMI\b", "H M I"),
    (r"\bSAP\b", "es a pe"),
    (r"\bPIC\b", "penanggung jawab"),
]


def normalize_for_speech(text) -> str:
    s = str(text or "")
    for pat, rep in _PHRASE_RULES:
        s = re.sub(pat, rep, s, flags=re.IGNORECASE)
    for pat, rep in _WORD_RULES:
        s = re.sub(pat, rep, s, flags=re.IGNORECASE)
    for pat, rep in _ACRONYM_RULES:
        s = re.sub(pat, rep, s)

    s = s.replace("&", " dan ")
    s = s.replace("—", ", ").replace("–", ", ")   # em/en dash → jeda koma
    s = re.sub(r"\s+-\s+", ", ", s)                # hyphen berspasi ( - ) → jeda koma
    s = re.sub(r"\s*/\s*", ", ", s)                # "a/b/c" → "a, b, c"
    s = re.sub(r"(\d+)\.(\d+)", r"\1 koma \2", s)  # desimal titik → "koma" (3.83 → 3 koma 83)
    s = s.replace("%", " persen")

    s = re.sub(r"\s+([,.])", r"\1", s)             # buang spasi sebelum , atau .
    s = re.sub(r",\s*,", ",", s)                   # koma dobel
    s = re.sub(r"\s+", " ", s).strip()
    return s


if __name__ == "__main__":
    # Uji cepat: `python speech_normalize.py`
    samples = [
        "OEE 0% — running 0 jam dari 3.83 jam terhitung, loss 3.83 jam. Terutama Downtime 3.83 jam. Cek downtime/idle/setup mesin.",
        "0 jam tercatat dari 1.1 jam (expected so far, shift 1) — kurang 1.1 jam (0%). Pastikan operator input timesheet selama shift.",
        "3 dari 3 record produktif tidak valid (order/operasi tidak cocok master SAP, atau workcenter/operator kosong) — 100%. Perbaiki input & pastikan order/operasi benar.",
        "Perhatian. Indikator Adopsi Labour berstatus kritis.",
    ]
    for x in samples:
        print("IN :", x)
        print("OUT:", normalize_for_speech(x))
        print()
