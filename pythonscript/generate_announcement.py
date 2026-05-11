import argparse
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
FASTAPI_DIR = ROOT_DIR / "API" / "FastAPI"
if str(FASTAPI_DIR) not in sys.path:
    sys.path.insert(0, str(FASTAPI_DIR))

from tts_announcement import generate_announcement_mp3, make_announcement_filename


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate voice announcement MP3 by SSBR ID")
    parser.add_argument("ssbr_id", help="SSBR ID, contoh: A102")
    parser.add_argument(
        "--output-dir",
        default=str(ROOT_DIR / "API" / "uploads" / "announcement"),
        help="Folder output MP3",
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_path = output_dir / make_announcement_filename(args.ssbr_id)
    result = generate_announcement_mp3(args.ssbr_id, output_path)
    print(f"Generated: {result['file']}")
    print(f"Text: {result['text']}")


if __name__ == "__main__":
    main()
