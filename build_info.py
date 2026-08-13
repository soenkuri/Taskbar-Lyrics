"""Generate build metadata shipped with the BetterNCM plugin."""

import argparse
import datetime as dt
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "src" / "betterncm-plugin" / "manifest.json"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    build_time = os.environ.get("BUILD_TIME")
    if not build_time:
        build_time = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()

    metadata = {
        "name": manifest.get("name", "任务栏歌词"),
        "version": manifest.get("version", "未知"),
        "build_time": build_time,
        "channel": os.environ.get("GITHUB_REF_NAME", "本地工作区"),
        "commit": os.environ.get("GITHUB_SHA", "未提供"),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=4) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
