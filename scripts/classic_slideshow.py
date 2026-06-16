#!/usr/bin/env python3
"""Build a "reading a classic" carousel and short-form video.

Default usage:
  python3 scripts/classic_slideshow.py --source-dir "/home/russ/reading a classic"

The script picks one random image from folders 1..4, renders TikTok-style text
onto vertical 1080x1920 slides, chooses one audio file from music/, and writes
MP4 outputs for Instagram Reels / YouTube Shorts. TikTok API calls are opt-in.
"""

from __future__ import annotations

import argparse
import html
import io
import json
import math
import mimetypes
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib import error, request

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
from PIL import ImageFilter


CANVAS_SIZE = (1080, 1920)
DEFAULT_TEXT_FONT = "TikTok Sans SemiBold"
DEFAULT_EMOJI_FONT = "Apple Color Emoji"
DEFAULT_SLIDE_SECONDS = 2.0
DEFAULT_FIRST_SLIDE_SECONDS = 3.0
DEFAULT_REFERENCE_DURATIONS = [2.767, 2.200, 2.133, 4.440]
DEFAULT_CAPTIONS = [
    "Me reading a classic\nbecause I want to be\nintellectual...👀",
    "Two minutes later\nBook shut 😭",
    "Where’s my phone...",
    "Not me suddenly\nunderstanding the plot✨",
]
DEFAULT_TEXT_Y = [1138, 920, 860, 1480]
DEFAULT_TEXT_X_OFFSET = [-42, 0, 0, 0]
DEFAULT_FONT_SIZE = [52, 56, 56, 52]
DEFAULT_OUTLINE_WIDTH = 3
EMOJI_PATTERN = re.compile(
    "["
    "\U0001f000-\U0001faff"
    "\U00002600-\U000027bf"
    "\U0000fe0f"
    "]+"
)
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tif", ".tiff"}
AUDIO_EXTENSIONS = {".aac", ".aiff", ".flac", ".m4a", ".mp3", ".mp4", ".mov", ".wav", ".webm"}
TIKTOK_API_BASE = "https://open.tiktokapis.com"
MAX_SINGLE_TIKTOK_CHUNK = 64 * 1024 * 1024


@dataclass(frozen=True)
class RenderedPost:
    output_dir: Path
    slides: list[Path]
    videos: dict[str, Path]
    selected_images: list[Path]
    selected_audio: Path | None
    durations: list[float]
    tiktok_photo_payload: Path
    metadata: Path


def run(cmd: list[str], *, capture: bool = False) -> subprocess.CompletedProcess[bytes]:
    printable = " ".join(quote_arg(part) for part in cmd)
    print(f"+ {printable}", flush=True)
    return subprocess.run(cmd, check=True, stdout=subprocess.PIPE if capture else None, stderr=None)


def quote_arg(value: str) -> str:
    if any(char.isspace() for char in value) or any(char in value for char in "'\"$`\\"):
        return "'" + value.replace("'", "'\"'\"'") + "'"
    return value


def require_ffmpeg() -> None:
    for binary in ("ffmpeg", "ffprobe"):
        if shutil.which(binary) is None:
            raise RuntimeError(f"{binary} is required but was not found on PATH.")


def list_files(folder: Path, extensions: set[str]) -> list[Path]:
    if not folder.exists():
        return []
    return sorted(
        path
        for path in folder.iterdir()
        if path.is_file() and path.suffix.lower() in extensions and not path.name.startswith(".")
    )


def pick_inputs(source_dir: Path, rng: random.Random) -> tuple[list[Path], Path | None]:
    selected_images: list[Path] = []
    for index in range(1, 5):
        folder = source_dir / str(index)
        candidates = list_files(folder, IMAGE_EXTENSIONS)
        if not candidates:
            raise FileNotFoundError(f"No supported images found in {folder}")
        selected_images.append(rng.choice(candidates))

    music_candidates = list_files(source_dir / "music", AUDIO_EXTENSIONS)
    selected_audio = rng.choice(music_candidates) if music_candidates else None
    return selected_images, selected_audio


def open_image(path: Path) -> Image.Image:
    try:
        with Image.open(path) as image:
            return ImageOps.exif_transpose(image).convert("RGB")
    except Exception as pil_error:
        magick = shutil.which("magick")
        if magick is None:
            raise pil_error
        try:
            converted = run([magick, str(path), "-auto-orient", "png:-"], capture=True)
            with Image.open(io.BytesIO(converted.stdout)) as image:
                return ImageOps.exif_transpose(image).convert("RGB")
        except Exception:
            raise pil_error


def cover_resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    width, height = image.size
    target_width, target_height = size
    scale = max(target_width / width, target_height / height)
    resized = image.resize((math.ceil(width * scale), math.ceil(height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - target_width) // 2
    top = (resized.height - target_height) // 2
    return resized.crop((left, top, left + target_width, top + target_height))


def fit_resize(image: Image.Image, box: tuple[int, int]) -> Image.Image:
    image = image.copy()
    image.thumbnail(box, Image.Resampling.LANCZOS)
    return image


def find_font(bold: bool, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
        "/usr/share/fonts/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf" if bold else "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    fc_match = shutil.which("fc-match")
    if fc_match:
        query = "Arial:style=Bold" if bold else "Arial"
        result = subprocess.run(
            [fc_match, "-f", "%{file}", query],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        font_path = result.stdout.decode("utf-8", errors="replace").strip()
        if font_path and Path(font_path).exists():
            return ImageFont.truetype(font_path, size=size)
    return ImageFont.load_default()


def wrapped_lines(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        attempt = f"{current} {word}".strip()
        if text_width(draw, attempt, font) <= max_width or not current:
            current = attempt
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> int:
    left, _, right, _ = draw.textbbox((0, 0), text, font=font, stroke_width=0)
    return right - left


def pango_caption_markup(text: str, color: str, font_size: int, text_font: str, emoji_font: str) -> str:
    parts: list[str] = []
    cursor = 0
    for match in EMOJI_PATTERN.finditer(text):
        if match.start() > cursor:
            parts.append(html.escape(text[cursor : match.start()]))
        emoji = html.escape(match.group(0))
        parts.append(f'<span font_family="{html.escape(emoji_font)}">{emoji}</span>')
        cursor = match.end()
    if cursor < len(text):
        parts.append(html.escape(text[cursor:]))
    body = "".join(parts)
    return f'<span font_desc="{html.escape(text_font)} {font_size}" foreground="{color}">{body}</span>'


def strip_emoji(text: str) -> str:
    return EMOJI_PATTERN.sub("", text)


def emoji_runs(text: str) -> list[tuple[bool, str]]:
    runs: list[tuple[bool, str]] = []
    cursor = 0
    for match in EMOJI_PATTERN.finditer(text):
        if match.start() > cursor:
            runs.append((False, text[cursor : match.start()]))
        runs.append((True, match.group(0)))
        cursor = match.end()
    if cursor < len(text):
        runs.append((False, text[cursor:]))
    return runs


def render_pango_text(
    text: str,
    color: str,
    font_size: int,
    max_width: int,
    text_font: str,
    emoji_font: str,
) -> Image.Image:
    markup = pango_caption_markup(text, color, font_size, text_font, emoji_font)
    result = run(
        [
            "magick",
            "-background",
            "none",
            "-define",
            "pango:align=center",
            "-size",
            f"{max_width}x",
            f"pango:{markup}",
            "png:-",
        ],
        capture=True,
    )
    with Image.open(io.BytesIO(result.stdout)) as image:
        return image.convert("RGBA")


def render_pango_fragment(text: str, color: str, font_size: int, font: str, *, is_emoji: bool) -> Image.Image:
    escaped = html.escape(text)
    if is_emoji:
        markup = f'<span font_desc="{html.escape(font)} {font_size}">{escaped}</span>'
    else:
        markup = f'<span font_desc="{html.escape(font)} {font_size}" foreground="{color}">{escaped}</span>'
    result = run(
        [
            "magick",
            "-background",
            "none",
            f"pango:{markup}",
            "png:-",
        ],
        capture=True,
    )
    with Image.open(io.BytesIO(result.stdout)) as image:
        return image.convert("RGBA")


def compose_caption_layer(
    caption: str,
    color: str,
    font_size: int,
    text_font: str,
    emoji_font: str,
    *,
    include_emoji: bool,
) -> Image.Image:
    line_layers: list[Image.Image] = []
    for line in caption.splitlines():
        rendered_runs: list[tuple[bool, Image.Image]] = []
        for is_emoji, run_text in emoji_runs(line):
            if is_emoji and not include_emoji:
                image = render_pango_fragment(run_text, color, font_size, emoji_font, is_emoji=True)
                rendered_runs.append((True, Image.new("RGBA", image.size, (0, 0, 0, 0))))
            elif is_emoji:
                rendered_runs.append((True, render_pango_fragment(run_text, color, font_size, emoji_font, is_emoji=True)))
            else:
                rendered_runs.append((False, render_pango_fragment(run_text, color, font_size, text_font, is_emoji=False)))

        width = max(1, sum(image.width for _, image in rendered_runs))
        height = max((image.height for _, image in rendered_runs), default=1)
        line_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        x = 0
        for _, image in rendered_runs:
            y = (height - image.height) // 2
            line_layer.alpha_composite(image, (x, y))
            x += image.width
        line_layers.append(line_layer)

    width = max((line.width for line in line_layers), default=1)
    height = sum(line.height for line in line_layers)
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    y = 0
    for line in line_layers:
        x = (width - line.width) // 2
        layer.alpha_composite(line, (x, y))
        y += line.height
    return layer


def draw_caption(
    canvas: Image.Image,
    caption: str,
    *,
    slide_number: int,
    text_font: str,
    emoji_font: str,
) -> None:
    max_width = 980
    font_size = DEFAULT_FONT_SIZE[slide_number - 1]
    magick = shutil.which("magick")
    if magick:
        while True:
            text_layer = compose_caption_layer(
                caption,
                "white",
                font_size,
                text_font,
                emoji_font,
                include_emoji=True,
            )
            if (text_layer.height <= 430 and text_layer.width <= max_width) or font_size <= 54:
                break
            font_size -= 4

        outline_source = compose_caption_layer(
            caption,
            "white",
            font_size,
            text_font,
            emoji_font,
            include_emoji=False,
        )
        outline_layer = Image.new("RGBA", outline_source.size, (0, 0, 0, 255))
        outline_layer.putalpha(outline_source.getchannel("A").filter(ImageFilter.MaxFilter(DEFAULT_OUTLINE_WIDTH * 2 + 1)))
        x = (CANVAS_SIZE[0] - text_layer.width) // 2
        y = max(70, min(CANVAS_SIZE[1] - text_layer.height - 90, DEFAULT_TEXT_Y[slide_number - 1] - text_layer.height // 2))
        x += DEFAULT_TEXT_X_OFFSET[slide_number - 1]
        canvas.alpha_composite(outline_layer, (x, y))
        canvas.alpha_composite(text_layer, (x, y))
        return

    draw = ImageDraw.Draw(canvas)
    font = find_font(True, font_size)
    lines = caption.splitlines()
    line_height = int(font_size * 1.12)
    total_height = len(lines) * line_height
    start_y = max(70, min(CANVAS_SIZE[1] - total_height - 90, DEFAULT_TEXT_Y[slide_number - 1] - total_height // 2))
    for line_index, line in enumerate(lines):
        line_width = text_width(draw, line, font)
        line_x = (CANVAS_SIZE[0] - line_width) // 2
        line_y = start_y + line_index * line_height
        draw.text(
            (line_x, line_y),
            line,
            font=font,
            fill=(255, 255, 255, 255),
            stroke_width=7,
            stroke_fill=(0, 0, 0, 245),
        )


def render_slide(
    source: Path,
    caption: str,
    output: Path,
    *,
    slide_number: int,
    text_font: str,
    emoji_font: str,
) -> None:
    base_image = open_image(source)
    canvas = cover_resize(base_image, CANVAS_SIZE).convert("RGBA")
    draw_caption(canvas, caption, slide_number=slide_number, text_font=text_font, emoji_font=emoji_font)

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output, quality=94)


def media_duration(path: Path) -> float:
    result = run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        capture=True,
    )
    text = result.stdout.decode("utf-8", errors="replace").strip()
    return float(text) if text else 0.0


def detect_audio_peaks(audio_path: Path, *, sample_rate: int = 22_050) -> list[float]:
    result = run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(audio_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-f",
            "s16le",
            "-",
        ],
        capture=True,
    )
    samples = np.frombuffer(result.stdout, dtype=np.int16).astype(np.float32)
    if len(samples) < sample_rate:
        return []

    hop = int(sample_rate * 0.05)
    window = int(sample_rate * 0.12)
    if hop <= 0 or window <= 0:
        return []

    rms_values: list[float] = []
    times: list[float] = []
    for start in range(0, max(1, len(samples) - window), hop):
        segment = samples[start : start + window]
        rms_values.append(float(np.sqrt(np.mean(segment * segment))))
        times.append(start / sample_rate)

    rms = np.array(rms_values)
    if len(rms) < 5 or float(np.max(rms)) <= 0:
        return []

    threshold = float(np.percentile(rms, 72))
    peaks: list[float] = []
    last_peak = -999.0
    for index in range(1, len(rms) - 1):
        if rms[index] < threshold:
            continue
        if rms[index] < rms[index - 1] or rms[index] < rms[index + 1]:
            continue
        peak_time = times[index]
        if peak_time - last_peak < 0.55:
            if peaks and rms[index] > rms[int(round(peaks[-1] / 0.05))]:
                peaks[-1] = peak_time
                last_peak = peak_time
            continue
        peaks.append(peak_time)
        last_peak = peak_time
    return peaks


def slide_durations(audio_path: Path | None, slide_count: int, target_seconds: float, beat_match: bool) -> list[float]:
    if not audio_path or not beat_match:
        return [target_seconds] * slide_count

    try:
        audio_len = media_duration(audio_path)
        peaks = detect_audio_peaks(audio_path)
    except Exception as exc:
        print(f"Beat matching skipped: {exc}", file=sys.stderr)
        return [target_seconds] * slide_count

    if audio_len <= target_seconds * slide_count or not peaks:
        return [target_seconds] * slide_count

    cuts = [0.0]
    for cut_index in range(1, slide_count):
        ideal = cut_index * target_seconds
        candidates = [peak for peak in peaks if ideal - 0.45 <= peak <= ideal + 0.75]
        if candidates:
            cuts.append(min(candidates, key=lambda peak: abs(peak - ideal)))
        else:
            cuts.append(ideal)
    cuts.append(cuts[-1] + target_seconds)

    durations = [max(1.25, min(3.25, cuts[index + 1] - cuts[index])) for index in range(slide_count)]
    return durations


def load_timing_preset(path: Path | None) -> dict[str, Any] | None:
    if not path:
        return None
    data = json.loads(path.expanduser().read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Timing preset must be a JSON object.")
    return data


def number_from_preset(preset: dict[str, Any], key: str, fallback: float) -> float:
    value = preset.get(key)
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return fallback


def preset_slide_durations(
    audio_path: Path | None,
    slide_count: int,
    preset: dict[str, Any],
    *,
    snap_to_beats: bool,
    fallback_seconds: float,
) -> list[float]:
    targets = preset.get("transitionTargets")
    if not isinstance(targets, list):
        return [fallback_seconds] * slide_count

    transition_targets: list[float] = []
    for value in targets[: max(0, slide_count - 1)]:
        if isinstance(value, (int, float)) and math.isfinite(float(value)) and float(value) > 0:
            transition_targets.append(float(value))

    if len(transition_targets) != max(0, slide_count - 1):
        return [fallback_seconds] * slide_count

    snap_window = number_from_preset(preset, "snapWindow", 0.45)
    min_seconds = number_from_preset(preset, "minSlideSeconds", 1.25)
    max_seconds = number_from_preset(preset, "maxSlideSeconds", 4.5)
    min_seconds = max(0.25, min_seconds)
    max_seconds = max(min_seconds, max_seconds)

    peaks: list[float] = []
    if snap_to_beats and audio_path:
        try:
            peaks = detect_audio_peaks(audio_path)
        except Exception as exc:
            print(f"Preset beat snapping skipped: {exc}", file=sys.stderr)

    cuts = [0.0]
    for target in transition_targets:
        cut = target
        if peaks and snap_window > 0:
            candidates = [peak for peak in peaks if target - snap_window <= peak <= target + snap_window]
            if candidates:
                cut = min(candidates, key=lambda peak: abs(peak - target))
        if cut <= cuts[-1]:
            cut = target
        cuts.append(cut)

    end_at = preset.get("endAt")
    if isinstance(end_at, (int, float)) and math.isfinite(float(end_at)) and float(end_at) > cuts[-1]:
        cuts.append(float(end_at))
    else:
        cuts.append(cuts[-1] + fallback_seconds)

    return [max(min_seconds, min(max_seconds, cuts[index + 1] - cuts[index])) for index in range(slide_count)]


def fixed_slide_durations(slide_count: int, slide_seconds: float, first_slide_seconds: float) -> list[float]:
    durations = [slide_seconds] * slide_count
    if durations:
        durations[0] = first_slide_seconds
    return durations


def reference_slide_durations(slide_count: int) -> list[float]:
    if slide_count != len(DEFAULT_REFERENCE_DURATIONS):
        return fixed_slide_durations(slide_count, DEFAULT_SLIDE_SECONDS, DEFAULT_FIRST_SLIDE_SECONDS)
    return DEFAULT_REFERENCE_DURATIONS.copy()


def write_concat_file(slides: list[Path], durations: list[float], output: Path) -> None:
    lines: list[str] = []
    for slide, duration in zip(slides, durations):
        lines.append(f"file '{str(slide).replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))}'")
        lines.append(f"duration {duration:.3f}")
    lines.append(f"file '{str(slides[-1]).replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))}'")
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")


def build_video(slides: list[Path], audio: Path | None, durations: list[float], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    total_duration = sum(durations)
    with tempfile.TemporaryDirectory() as temp_dir:
        concat_path = Path(temp_dir) / "slides.txt"
        write_concat_file(slides, durations, concat_path)

        cmd = [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_path),
        ]
        if audio:
            cmd.extend(["-stream_loop", "-1", "-i", str(audio)])
        cmd.extend(
            [
                "-t",
                f"{total_duration:.3f}",
                "-vf",
                "fps=30,format=yuv420p",
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
            ]
        )
        if audio:
            cmd.extend(["-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", "192k", "-shortest"])
        else:
            cmd.extend(["-an"])
        cmd.extend(["-movflags", "+faststart", str(output)])
        run(cmd)


def post_json(url: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=UTF-8",
        },
    )
    try:
        with request.urlopen(req, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"TikTok API returned HTTP {exc.code}: {body}") from exc


def put_video_chunk(upload_url: str, chunk: bytes, start: int, end: int, total: int, content_type: str) -> None:
    req = request.Request(
        upload_url,
        data=chunk,
        method="PUT",
        headers={
            "Content-Type": content_type,
            "Content-Length": str(len(chunk)),
            "Content-Range": f"bytes {start}-{end}/{total}",
        },
    )
    try:
        with request.urlopen(req, timeout=180) as response:
            response.read()
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"TikTok upload returned HTTP {exc.code}: {body}") from exc


def upload_tiktok_video_draft(video: Path, token: str) -> dict[str, Any]:
    size = video.stat().st_size
    chunk_size = size if size <= MAX_SINGLE_TIKTOK_CHUNK else MAX_SINGLE_TIKTOK_CHUNK
    total_chunk_count = max(1, math.ceil(size / chunk_size))
    init_payload = {
        "source_info": {
            "source": "FILE_UPLOAD",
            "video_size": size,
            "chunk_size": chunk_size,
            "total_chunk_count": total_chunk_count,
        }
    }
    init_response = post_json(f"{TIKTOK_API_BASE}/v2/post/publish/inbox/video/init/", token, init_payload)
    data = init_response.get("data") or {}
    upload_url = data.get("upload_url")
    if not upload_url:
        raise RuntimeError(f"TikTok did not return an upload_url: {init_response}")

    content_type = mimetypes.guess_type(video.name)[0] or "video/mp4"
    with video.open("rb") as handle:
        start = 0
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            end = start + len(chunk) - 1
            put_video_chunk(upload_url, chunk, start, end, size, content_type)
            start = end + 1

    return init_response


def tiktok_photo_payload(photo_urls: list[str], title: str, description: str, post_mode: str) -> dict[str, Any]:
    return {
        "post_info": {
            "title": title,
            "description": description,
        },
        "source_info": {
            "source": "PULL_FROM_URL",
            "photo_cover_index": 0,
            "photo_images": photo_urls,
        },
        "post_mode": post_mode,
        "media_type": "PHOTO",
    }


def upload_tiktok_photo_carousel(photo_urls: list[str], token: str, title: str, description: str) -> dict[str, Any]:
    payload = tiktok_photo_payload(photo_urls, title, description, "MEDIA_UPLOAD")
    return post_json(f"{TIKTOK_API_BASE}/v2/post/publish/content/init/", token, payload)


def public_urls_for_slides(slides: list[Path], public_url_base: str | None) -> list[str]:
    if not public_url_base:
        return []
    return [public_url_base.rstrip("/") + "/" + slide.name for slide in slides]


def build_post(args: argparse.Namespace) -> RenderedPost:
    require_ffmpeg()
    source_dir = args.source_dir.expanduser().resolve()
    rng = random.Random(args.seed if args.seed is not None else time.time_ns())
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output_dir = (args.output_dir or Path("artifacts") / f"classic-slideshow-{timestamp}").expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    captions = args.caption or DEFAULT_CAPTIONS
    if len(captions) != 4:
        raise ValueError("Exactly four captions are required.")

    selected_images, selected_audio = pick_inputs(source_dir, rng)
    if args.audio_file:
        selected_audio = args.audio_file.expanduser().resolve()
        if not selected_audio.exists():
            raise FileNotFoundError(f"Audio file not found: {selected_audio}")
        if selected_audio.suffix.lower() not in AUDIO_EXTENSIONS:
            raise ValueError(f"Unsupported audio file type: {selected_audio.suffix}")
    slides_dir = output_dir / "slides"
    slides: list[Path] = []
    for index, (image, caption) in enumerate(zip(selected_images, captions), start=1):
        slide = slides_dir / f"slide-{index:02}.jpg"
        render_slide(
            image,
            caption,
            slide,
            slide_number=index,
            text_font=args.text_font,
            emoji_font=args.emoji_font,
        )
        slides.append(slide)

    timing_preset = load_timing_preset(args.timing_preset_file)
    timing_mode = "reference"
    if timing_preset:
        durations = preset_slide_durations(
            selected_audio,
            len(slides),
            timing_preset,
            snap_to_beats=args.snap_to_beats,
            fallback_seconds=args.slide_seconds,
        )
        timing_mode = "preset-snapped" if args.snap_to_beats else "preset"
    elif args.beat_match:
        durations = slide_durations(selected_audio, len(slides), args.slide_seconds, args.beat_match)
        if durations:
            durations[0] = max(durations[0], args.first_slide_seconds)
        timing_mode = "beat-match"
    elif args.timing_profile == "reference":
        durations = reference_slide_durations(len(slides))
    else:
        durations = fixed_slide_durations(len(slides), args.slide_seconds, args.first_slide_seconds)
        timing_mode = "even"
    videos = {
        "instagram": output_dir / "reading-classic-instagram-reel.mp4",
        "youtube": output_dir / "reading-classic-youtube-short.mp4",
    }
    for video in videos.values():
        build_video(slides, selected_audio, durations, video)

    photo_urls = args.photo_url or public_urls_for_slides(slides, args.public_url_base)
    photo_payload_path = output_dir / "tiktok-photo-carousel-payload.json"
    payload = tiktok_photo_payload(photo_urls, args.tiktok_title, args.tiktok_description, "MEDIA_UPLOAD")
    photo_payload_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    metadata_path = output_dir / "run-metadata.json"
    metadata = {
        "source_dir": str(source_dir),
        "selected_images": [str(path) for path in selected_images],
        "selected_audio": str(selected_audio) if selected_audio else None,
        "captions": captions,
        "durations": durations,
        "timing_mode": timing_mode,
        "timing_preset": timing_preset,
        "text_font": args.text_font,
        "emoji_font": args.emoji_font,
        "slides": [str(path) for path in slides],
        "videos": {name: str(path) for name, path in videos.items()},
        "tiktok_photo_payload": str(photo_payload_path),
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    return RenderedPost(
        output_dir=output_dir,
        slides=slides,
        videos=videos,
        selected_images=selected_images,
        selected_audio=selected_audio,
        durations=durations,
        tiktok_photo_payload=photo_payload_path,
        metadata=metadata_path,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a reading-a-classic carousel and short-form videos.")
    parser.add_argument("--source-dir", type=Path, default=Path("~/reading a classic"), help="Folder containing 1, 2, 3, 4, and music subfolders.")
    parser.add_argument("--output-dir", type=Path, help="Output folder. Defaults to artifacts/classic-slideshow-<timestamp>.")
    parser.add_argument("--seed", type=int, help="Set for repeatable random picks.")
    parser.add_argument("--slide-seconds", type=float, default=DEFAULT_SLIDE_SECONDS, help="Seconds for slides 2-4 by default.")
    parser.add_argument("--first-slide-seconds", type=float, default=DEFAULT_FIRST_SLIDE_SECONDS, help="Seconds for the first slide.")
    parser.add_argument(
        "--timing-profile",
        choices=("reference", "even"),
        default="reference",
        help="Use the reference video cut timing or fixed even slide timing.",
    )
    parser.add_argument("--beat-match", action="store_true", help="Nudge cuts to nearby audio peaks instead of using fixed slide durations.")
    parser.add_argument("--audio-file", type=Path, help="Use a specific audio file instead of randomly choosing from music/.")
    parser.add_argument("--timing-preset-file", type=Path, help="JSON preset containing transitionTargets, endAt, and snap settings.")
    parser.add_argument("--snap-to-beats", action="store_true", help="Snap preset transition targets to nearby detected audio peaks.")
    parser.add_argument("--text-font", default=DEFAULT_TEXT_FONT, help="Pango font family for caption text.")
    parser.add_argument("--emoji-font", default=DEFAULT_EMOJI_FONT, help="Pango font family for emoji glyphs.")
    parser.add_argument("--caption", action="append", help="Override captions. Pass exactly four times.")
    parser.add_argument("--public-url-base", help="Public verified URL base where the rendered slide images will be hosted.")
    parser.add_argument("--photo-url", action="append", help="Public verified photo URL for TikTok carousel upload. Pass exactly four times.")
    parser.add_argument("--tiktok-title", default="reading a classic", help="TikTok photo post title.")
    parser.add_argument(
        "--tiktok-description",
        default="me vs classic literature #booktok #classicbooks #reading",
        help="TikTok photo post description.",
    )
    parser.add_argument("--tiktok-access-token", default=os.environ.get("TIKTOK_ACCESS_TOKEN"), help="TikTok user access token, or set TIKTOK_ACCESS_TOKEN.")
    parser.add_argument("--upload-tiktok-video-draft", action="store_true", help="Upload the generated MP4 to TikTok inbox as a video draft using FILE_UPLOAD.")
    parser.add_argument("--upload-tiktok-photo-carousel", action="store_true", help="Call TikTok photo MEDIA_UPLOAD using --photo-url or --public-url-base URLs.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.photo_url and len(args.photo_url) != 4:
        raise ValueError("Pass --photo-url exactly four times, once per slide.")

    post = build_post(args)
    print(f"Wrote slides: {post.output_dir / 'slides'}")
    for name, video in post.videos.items():
        print(f"Wrote {name} video: {video}")
    print(f"Wrote TikTok photo payload: {post.tiktok_photo_payload}")
    print(f"Wrote metadata: {post.metadata}")

    if args.upload_tiktok_video_draft:
        if not args.tiktok_access_token:
            raise RuntimeError("Set --tiktok-access-token or TIKTOK_ACCESS_TOKEN before uploading.")
        response = upload_tiktok_video_draft(post.videos["instagram"], args.tiktok_access_token)
        response_path = post.output_dir / "tiktok-video-upload-response.json"
        response_path.write_text(json.dumps(response, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote TikTok video upload response: {response_path}")

    if args.upload_tiktok_photo_carousel:
        if not args.tiktok_access_token:
            raise RuntimeError("Set --tiktok-access-token or TIKTOK_ACCESS_TOKEN before uploading.")
        photo_payload = json.loads(post.tiktok_photo_payload.read_text(encoding="utf-8"))
        photo_urls = photo_payload["source_info"]["photo_images"]
        if len(photo_urls) != 4:
            raise RuntimeError("TikTok photo carousel upload needs four public image URLs.")
        response = upload_tiktok_photo_carousel(
            photo_urls,
            args.tiktok_access_token,
            args.tiktok_title,
            args.tiktok_description,
        )
        response_path = post.output_dir / "tiktok-photo-upload-response.json"
        response_path.write_text(json.dumps(response, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote TikTok photo upload response: {response_path}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        raise SystemExit(exc.returncode)
