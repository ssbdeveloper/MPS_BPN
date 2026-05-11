import asyncio
import re
import shutil
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

import edge_tts


DEFAULT_VOICE = "id-ID-GadisNeural"
DEFAULT_RATE = "-10%"
DEFAULT_PITCH = "-2Hz"
GAP_AFTER_HEADER_MS = 100
GAP_BEFORE_FOOTER_MS = 500

ROOT_DIR = Path(__file__).resolve().parents[2]
TTS_SERVICE_DIR = ROOT_DIR / "TTS Service"
DEFAULT_HEADER_FILE = TTS_SERVICE_DIR / "header.mp3"
DEFAULT_FOOTER_FILE = TTS_SERVICE_DIR / "footer.mp3"


def spaced_ssbr_id(ssbr_id: str) -> str:
    cleaned = "".join(str(ssbr_id or "").split())
    return " ".join(cleaned)


def make_announcement_text(ssbr_id: str) -> str:
    spaced = spaced_ssbr_id(ssbr_id)
    return f"Perhatian. Order dengan nomor Aiden {spaced}. Mohon segera dipindahkan ke mesin selanjutnya."


def safe_filename_part(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", str(value or "").strip())
    return safe.strip("_") or "order"


def make_announcement_filename(ssbr_id: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    suffix = uuid.uuid4().hex[:10]
    return f"announcement_{safe_filename_part(ssbr_id)}_{stamp}_{suffix}.mp3"


def ensure_audio_tooling_available() -> None:
    missing = [tool for tool in ("ffmpeg", "ffprobe") if not shutil.which(tool)]
    if missing:
        raise RuntimeError(
            "Audio merge membutuhkan ffmpeg/ffprobe. "
            f"Tidak ditemukan di PATH: {', '.join(missing)}"
        )


def merge_announcement_audio(
    body_path: str | Path,
    output_path: str | Path,
    header_path: str | Path = DEFAULT_HEADER_FILE,
    footer_path: str | Path = DEFAULT_FOOTER_FILE,
    gap_after_header_ms: int = GAP_AFTER_HEADER_MS,
    gap_before_footer_ms: int = GAP_BEFORE_FOOTER_MS,
) -> dict:
    body = Path(body_path)
    output = Path(output_path)
    header = Path(header_path)
    footer = Path(footer_path)

    missing = [str(path) for path in (header, body, footer) if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Audio source tidak ditemukan: {', '.join(missing)}")

    ensure_audio_tooling_available()
    from pydub import AudioSegment

    output.parent.mkdir(parents=True, exist_ok=True)

    final_audio = (
        AudioSegment.from_mp3(header)
        + AudioSegment.silent(duration=gap_after_header_ms)
        + AudioSegment.from_mp3(body)
        + AudioSegment.silent(duration=gap_before_footer_ms)
        + AudioSegment.from_mp3(footer)
    )
    final_audio.export(output, format="mp3")

    return {
        "header_file": str(header),
        "footer_file": str(footer),
        "body_file": str(body),
        "gap_after_header_ms": gap_after_header_ms,
        "gap_before_footer_ms": gap_before_footer_ms,
        "duration_ms": len(final_audio),
        "merged": True,
    }


async def generate_announcement_mp3_async(
    ssbr_id: str,
    output_path: str | Path,
    voice: str = DEFAULT_VOICE,
    rate: str = DEFAULT_RATE,
    pitch: str = DEFAULT_PITCH,
) -> dict:
    text = make_announcement_text(ssbr_id)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    temp_body_path = None

    try:
        with tempfile.NamedTemporaryFile(
            prefix=f"announcement_body_{safe_filename_part(ssbr_id)}_",
            suffix=".mp3",
            delete=False,
            dir=output.parent,
        ) as temp_body:
            temp_body_path = Path(temp_body.name)

        communicate = edge_tts.Communicate(
            text=text,
            voice=voice,
            rate=rate,
            pitch=pitch,
        )
        await communicate.save(str(temp_body_path))
        merge_log = merge_announcement_audio(temp_body_path, output)
    finally:
        if temp_body_path and temp_body_path.exists():
            try:
                temp_body_path.unlink()
            except OSError:
                pass

    return {
        "ssbr_id": ssbr_id,
        "ssbr_id_spaced": spaced_ssbr_id(ssbr_id),
        "text": text,
        "voice": voice,
        "rate": rate,
        "pitch": pitch,
        "file": str(output),
        **merge_log,
    }


def generate_announcement_mp3(
    ssbr_id: str,
    output_path: str | Path,
    voice: str = DEFAULT_VOICE,
    rate: str = DEFAULT_RATE,
    pitch: str = DEFAULT_PITCH,
) -> dict:
    return asyncio.run(
        generate_announcement_mp3_async(
            ssbr_id=ssbr_id,
            output_path=output_path,
            voice=voice,
            rate=rate,
            pitch=pitch,
        )
    )
