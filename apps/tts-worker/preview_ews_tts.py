"""
preview_ews_tts.py — DENGAR LOKAL isu EWS hari ini sebagai suara.

Ini alat TEST, bukan bagian pipeline produksi. Ia menarik isu hari ini dari DB,
menyusun kalimat yang SAMA dengan yang diucapkan worker (ewsTtsNotifier.buildIssueSpeech),
lalu meng-generate MP3 secara lokal dengan Edge TTS supaya bisa diputar di device ini.

Butuh: paket `edge_tts` (sudah ada) + internet. TIDAK butuh ffmpeg/pydub (jalur Edge
menyimpan MP3 langsung).

Contoh:
    # semua isu open hari ini (critical + warning), per-isu + 1 briefing gabungan:
    python preview_ews_tts.py --host 127.0.0.1 --port 5434 --user tag

    # hanya yang critical (persis perilaku produksi saat ini):
    python preview_ews_tts.py --host 127.0.0.1 --port 5434 --user tag --critical-only

    # pakai teks PERSIS yang sudah diantrikan server (ews.tts_notification), bukan template:
    python preview_ews_tts.py --host 127.0.0.1 --port 5434 --user tag --source notification

Output: folder ./ews_tts_preview (per-isu NN_kategori_entitas.mp3 + _briefing_all.mp3).
"""
import argparse
import asyncio
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

from speech_normalize import normalize_for_speech

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = next(
    (p for p in [BASE_DIR, *BASE_DIR.parents] if (p / ".env").exists()),
    BASE_DIR.parent.parent,
)
load_dotenv(ROOT_DIR / ".env")

# Nama KPI enak-dengar — SALINAN dari ewsTtsNotifier.js (KPI_LABEL_ID). Jaga tetap sinkron.
KPI_LABEL_ID = {
    "uptime_tablet": "Uptime Tablet",
    "uptime_hmi": "Uptime HMI",
    "accuracy_labour": "Akurasi Labour",
    "accuracy_machine": "Akurasi Mesin",
    "adoption_labour": "Adopsi Labour",
    "adoption_machine": "Adopsi Mesin",
    "oee": "O E E",
    "ole": "O L E",
}


def build_message(kpi_type: str, severity: str, description: str, pic: str | None = None) -> str:
    """Reproduksi ewsTtsNotifier.makeTemplateSpeech() (USE_FULL_ISSUE_TEXT=false)."""
    kpi_name = KPI_LABEL_ID.get(kpi_type, kpi_type or "Indikator")
    severity_word = "kritis" if str(severity or "").lower() == "critical" else "perlu diperhatikan"
    parts = ["Perhatian.", f"Indikator {kpi_name} berstatus {severity_word}."]
    if description:
        parts.append(f"{description}.")
    if pic:
        parts.append(f"Mohon ditindaklanjuti oleh {pic}.")
    msg = " ".join(parts)
    msg = re.sub(r"\.\.+", ".", msg)
    msg = re.sub(r"\s+", " ", msg).strip()
    return msg


def slug(text: str, maxlen: int = 28) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "_", str(text or "")).strip("_")
    return (s[:maxlen] or "item").lower()


def fetch_issues(cur, critical_only: bool):
    sev = "AND severity = 'critical'" if critical_only else ""
    cur.execute(
        f"""
        SELECT category, severity, entity_name, description
        FROM ews.issue_log
        WHERE business_date = current_date AND status = 'open' {sev}
        ORDER BY (severity = 'critical') DESC, category, entity_name
        """
    )
    out = []
    for cat, sever, name, desc in cur.fetchall():
        out.append({
            "kpi_type": cat,
            "severity": sever,
            "entity": name,
            "message": build_message(cat, sever, desc),
        })
    return out


def fetch_notifications(cur, critical_only: bool):
    sev = "AND severity = 'Critical'" if critical_only else ""
    cur.execute(
        f"""
        SELECT kpi_type, severity, title, message
        FROM ews.tts_notification
        WHERE created_at::date = current_date AND COALESCE(message,'') <> '' {sev}
        ORDER BY id
        """
    )
    out = []
    for cat, sever, title, message in cur.fetchall():
        out.append({
            "kpi_type": cat,
            "severity": sever,
            "entity": title,
            "message": message,
        })
    return out


async def synth(text: str, out_path: Path, voice: str, rate: str) -> None:
    import edge_tts
    await edge_tts.Communicate(text, voice, rate=rate).save(str(out_path))


def main() -> None:
    ap = argparse.ArgumentParser(description="Preview EWS issue-log TTS locally")
    ap.add_argument("--host", default=os.getenv("DB_HOST", "127.0.0.1"))
    ap.add_argument("--port", default=os.getenv("DB_PORT", "5434"))
    ap.add_argument("--user", default=os.getenv("DB_USER", "tag"))
    ap.add_argument("--password", default=os.getenv("DB_PASSWORD", ""))
    ap.add_argument("--dbname", default=os.getenv("DB_NAME", "ptssb"))
    ap.add_argument("--source", choices=["issue", "notification"], default="issue",
                    help="issue = susun ulang dari ews.issue_log (default); notification = teks persis yang diantrikan server")
    ap.add_argument("--critical-only", action="store_true", help="Hanya isu critical (perilaku produksi saat ini)")
    ap.add_argument("--voice", default=os.getenv("EWS_TTS_VOICE", "id-ID-GadisNeural"))
    ap.add_argument("--rate", default=os.getenv("EWS_TTS_EDGE_RATE", "+0%"))
    ap.add_argument("--out", default=str(BASE_DIR / "ews_tts_preview"))
    ap.add_argument("--no-briefing", action="store_true", help="Jangan buat file gabungan _briefing_all.mp3")
    ap.add_argument("--no-individual", action="store_true", help="Jangan buat MP3 per-isu (briefing saja)")
    ap.add_argument("--no-normalize", action="store_true", help="Suarakan teks apa adanya (campur Inggris) untuk perbandingan")
    ap.add_argument("--limit", type=int, default=0, help="Batasi jumlah isu (0 = semua)")
    args = ap.parse_args()

    import psycopg2
    conn = psycopg2.connect(host=args.host, port=int(args.port), user=args.user,
                            password=args.password, dbname=args.dbname,
                            application_name="mps2-ews-tts-preview")
    with conn, conn.cursor() as cur:
        items = fetch_notifications(cur, args.critical_only) if args.source == "notification" \
            else fetch_issues(cur, args.critical_only)
    conn.close()

    if args.limit and len(items) > args.limit:
        items = items[: args.limit]

    if not items:
        print("Tidak ada isu untuk hari ini (mungkin belum ada snapshot / semua sudah resolved).")
        return

    # Indonesia penuh sebelum disuarakan — sama seperti worker produksi (speech_normalize).
    if not args.no_normalize:
        for it in items:
            it["message"] = normalize_for_speech(it["message"])

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    # Bersihkan MP3 lama: nama file memuat entitas & indeks, yang bergeser tiap run saat
    # jumlah isu berubah — tanpa ini folder menumpuk file basi yang menyesatkan.
    for old in out_dir.glob("*.mp3"):
        try:
            old.unlink()
        except OSError:
            pass

    print(f"{len(items)} isu | source={args.source} | voice={args.voice} rate={args.rate}")
    print(f"Output: {out_dir}\n")

    if not args.no_individual:
        for i, it in enumerate(items, 1):
            fname = f"{i:02d}_{slug(it['kpi_type'],18)}_{slug(it['entity'])}.mp3"
            fpath = out_dir / fname
            try:
                asyncio.run(synth(it["message"], fpath, args.voice, args.rate))
                print(f"  [{i:02d}] {it['severity']:8} {it['kpi_type']:16} {it['entity']}")
            except Exception as exc:  # noqa: BLE001
                print(f"  [{i:02d}] GAGAL ({exc}) — cek koneksi internet untuk edge-tts", file=sys.stderr)

    if not args.no_briefing:
        _bulan = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli",
                  "Agustus", "September", "Oktober", "November", "Desember"]
        _now = datetime.now()
        today = f"{_now.day} {_bulan[_now.month]} {_now.year}"
        n_crit = sum(1 for it in items if str(it["severity"]).lower() == "critical")
        header = (f"Ringkasan isu E W S hari ini, tanggal {today}. "
                  f"Total {len(items)} isu, {n_crit} di antaranya kritis.")
        body = "\n\n".join(it["message"] for it in items)
        brief_path = out_dir / "_briefing_all.mp3"
        try:
            asyncio.run(synth(header + "\n\n" + body, brief_path, args.voice, args.rate))
            print(f"\n  Briefing gabungan: {brief_path}")
        except Exception as exc:  # noqa: BLE001
            print(f"\n  Briefing GAGAL ({exc})", file=sys.stderr)

    print("\nSelesai. Putar file .mp3 di folder di atas (double-click).")


if __name__ == "__main__":
    main()
