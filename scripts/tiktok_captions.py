#!/usr/bin/env python3
"""Generate TikTok-style word-by-word captions with WhisperX.

This wrapper keeps WhisperX setup/use boring:
  python scripts/tiktok_captions.py "/path/to/video.mov"

Outputs are written next to the input by default:
  *_whisperx.json
  *_word_by_word.srt
  *_tiktok.ass
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


def run(cmd: list[str]) -> None:
    print("+ " + " ".join(quote_arg(part) for part in cmd), flush=True)
    subprocess.run(cmd, check=True)


def quote_arg(value: str) -> str:
    if re.search(r"[\s'\"$`\\]", value):
        return "'" + value.replace("'", "'\"'\"'") + "'"
    return value


def srt_time(seconds: float) -> str:
    millis = round(seconds * 1000)
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def ass_time(seconds: float) -> str:
    centis = round(seconds * 100)
    hours, centis = divmod(centis, 360_000)
    minutes, centis = divmod(centis, 6_000)
    secs, centis = divmod(centis, 100)
    return f"{hours}:{minutes:02}:{secs:02}.{centis:02}"


def clean_word(word: str) -> str:
    return re.sub(r"\s+", " ", word).strip()


def ass_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")


def load_words(json_path: Path) -> list[dict[str, float | str]]:
    data = json.loads(json_path.read_text(encoding="utf-8"))
    words: list[dict[str, float | str]] = []
    for segment in data.get("segments", []):
        for item in segment.get("words", []):
            word = clean_word(str(item.get("word", "")))
            if not word or "start" not in item or "end" not in item:
                continue
            start = float(item["start"])
            end = float(item["end"])
            if end <= start:
                continue
            words.append({"word": word, "start": start, "end": end})
    return words


def caption_windows(
    words: list[dict[str, float | str]],
    min_duration: float,
    max_duration: float,
    gap: float,
    no_gaps: bool = False,
) -> list[dict[str, float | str]]:
    windows: list[dict[str, float | str]] = []
    for index, item in enumerate(words):
        start = float(item["start"])
        if no_gaps:
            if index + 1 < len(words):
                end = float(words[index + 1]["start"])
            else:
                end = max(float(item["end"]), start + min_duration)
            if end <= start:
                end = start + min_duration
        else:
            end = min(max(float(item["end"]), start + min_duration), start + max_duration)
            if index + 1 < len(words):
                next_start = float(words[index + 1]["start"])
                end = min(end, next_start - gap)
            if end <= start:
                end = start + max(0.01, min(gap, min_duration))
        windows.append({"word": str(item["word"]), "start": start, "end": end})
    return windows


def write_word_srt(
    words: list[dict[str, float | str]],
    output: Path,
    min_duration: float,
    max_duration: float,
    gap: float,
    no_gaps: bool = False,
) -> None:
    lines: list[str] = []
    for index, item in enumerate(caption_windows(words, min_duration, max_duration, gap, no_gaps), start=1):
        start = float(item["start"])
        end = float(item["end"])
        lines.extend(
            [
                str(index),
                f"{srt_time(start)} --> {srt_time(end)}",
                str(item["word"]).upper(),
                "",
            ]
        )
    output.write_text("\n".join(lines), encoding="utf-8")


def write_tiktok_ass(
    words: list[dict[str, float | str]],
    output: Path,
    min_duration: float,
    max_duration: float,
    gap: float,
    play_res_x: int,
    play_res_y: int,
    no_gaps: bool = False,
) -> None:
    font_size = max(54, round(play_res_y * 0.052))
    margin_v = max(220, round(play_res_y * 0.16))
    header = f"""[Script Info]
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: {play_res_x}
PlayResY: {play_res_y}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TikTok,Arial,{font_size},&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,7,2,2,80,80,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events: list[str] = []
    for item in caption_windows(words, min_duration, max_duration, gap, no_gaps):
        start = float(item["start"])
        end = float(item["end"])
        text = ass_escape(str(item["word"]).upper())
        events.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},TikTok,,0,0,0,,{text}")
    output.write_text(header + "\n".join(events) + "\n", encoding="utf-8")


def burn_subtitles(source: Path, ass_path: Path, output: Path) -> None:
    escaped_ass = str(ass_path).replace("\\", "\\\\").replace("'", "\\'")
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(source),
            "-vf",
            f"subtitles='{escaped_ass}'",
            "-c:a",
            "copy",
            str(output),
        ]
    )


def find_whisperx_json(output_dir: Path, stem: str) -> Path:
    preferred = output_dir / f"{stem}.json"
    if preferred.exists():
        return preferred
    matches = sorted(output_dir.glob("*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not matches:
        raise FileNotFoundError(f"WhisperX did not write a JSON file in {output_dir}")
    return matches[0]


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate TikTok-style word-by-word subtitles.")
    parser.add_argument("source", type=Path, help="Video or audio file to caption")
    parser.add_argument("--output-dir", type=Path, help="Defaults to the source file's folder")
    parser.add_argument("--model", default="base", help="WhisperX model, e.g. base, small, medium, large-v3")
    parser.add_argument("--language", default="en", help="Language code. Use 'auto' to let WhisperX detect.")
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda"], help="Use cuda if your GPU setup supports it")
    parser.add_argument("--compute-type", default="int8", help="Use int8 on CPU, float16 on CUDA")
    parser.add_argument("--batch-size", default="4", help="Lower this if memory is tight")
    parser.add_argument("--min-word-duration", type=float, default=0.12)
    parser.add_argument("--max-word-duration", type=float, default=0.85)
    parser.add_argument("--gap", type=float, default=0.03, help="Seconds between word captions to prevent overlap")
    parser.add_argument("--no-gaps", action="store_true", default=True, help="Ensure subtitles last until the next word is spoken (no gaps) (default: True)")
    parser.add_argument("--allow-gaps", action="store_false", dest="no_gaps", help="Allow gaps between subtitles based on max duration and silence")
    parser.add_argument("--play-res-x", type=int, default=1080)
    parser.add_argument("--play-res-y", type=int, default=1920)
    parser.add_argument("--burn", action="store_true", help="Also write a video with the ASS captions burned in")
    parser.add_argument("--reuse-json", action="store_true", help="Reuse an existing *_whisperx.json file")
    args = parser.parse_args()

    source = args.source.expanduser().resolve()
    if not source.exists():
        raise FileNotFoundError(source)

    output_dir = (args.output_dir or source.parent).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    whisperx_cmd = shutil.which("whisperx")
    if whisperx_cmd is None:
        uvx_cmd = shutil.which("uvx")
        if uvx_cmd is None:
            raise RuntimeError("Install uv/uvx or put whisperx on PATH.")
        whisperx_prefix = [uvx_cmd, "--python", "3.12", "whisperx"]
    else:
        whisperx_prefix = [whisperx_cmd]

    stable_json = output_dir / f"{source.stem}_whisperx.json"
    if args.reuse_json and stable_json.exists():
        print(f"Reusing {stable_json}")
    else:
        cmd = [
            *whisperx_prefix,
            str(source),
            "--model",
            args.model,
            "--device",
            args.device,
            "--compute_type",
            args.compute_type,
            "--batch_size",
            args.batch_size,
            "--output_dir",
            str(output_dir),
            "--output_format",
            "json",
        ]
        if args.language.lower() != "auto":
            cmd.extend(["--language", args.language])
        run(cmd)

        whisperx_json = find_whisperx_json(output_dir, source.stem)
        if whisperx_json != stable_json:
            stable_json.write_text(whisperx_json.read_text(encoding="utf-8"), encoding="utf-8")

    words = load_words(stable_json)
    if not words:
        raise RuntimeError(f"No word timestamps found in {stable_json}")

    srt_path = output_dir / f"{source.stem}_word_by_word.srt"
    ass_path = output_dir / f"{source.stem}_tiktok.ass"
    write_word_srt(
        words,
        srt_path,
        args.min_word_duration,
        args.max_word_duration,
        args.gap,
        args.no_gaps,
    )
    write_tiktok_ass(
        words,
        ass_path,
        args.min_word_duration,
        args.max_word_duration,
        args.gap,
        args.play_res_x,
        args.play_res_y,
        args.no_gaps,
    )

    print(f"Wrote {stable_json}")
    print(f"Wrote {srt_path}")
    print(f"Wrote {ass_path}")

    if args.burn:
        video_path = output_dir / f"{source.stem}_captioned.mp4"
        burn_subtitles(source, ass_path, video_path)
        print(f"Wrote {video_path}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        raise SystemExit(exc.returncode)
