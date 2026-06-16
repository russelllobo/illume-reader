# Classic Slideshow Workflow

Generate a random four-slide "reading a classic" post from:

```text
~/reading a classic/
  1/
  2/
  3/
  4/
  music/
```

Run a local demo:

```bash
python3 scripts/classic_slideshow.py \
  --source-dir "$HOME/reading a classic" \
  --output-dir artifacts/classic-slideshow-demo
```

Outputs:

- `slides/slide-01.jpg` through `slide-04.jpg`
- `reading-classic-instagram-reel.mp4`
- `reading-classic-youtube-short.mp4`
- `tiktok-photo-carousel-payload.json`
- `run-metadata.json`

By default it chooses one random image from each numbered folder, chooses one random audio/video file from `music/`, renders each image full-screen with the reference captions, uses Apple Color Emoji when installed, keeps the first slide on screen for three seconds, and keeps the other slides on screen for two seconds.

Timing can be adjusted:

```bash
python3 scripts/classic_slideshow.py \
  --source-dir "$HOME/reading a classic" \
  --first-slide-seconds 3.5 \
  --slide-seconds 2
```

To experiment with simple beat matching:

```bash
python3 scripts/classic_slideshow.py \
  --source-dir "$HOME/reading a classic" \
  --beat-match
```

For saved per-track timing, create or edit `music/timing-presets.json` from the dashboard. Each track entry stores absolute cut targets:

```json
{
  "version": 1,
  "tracks": {
    "track-name.mov": {
      "name": "Track name",
      "transitionTargets": [2.767, 4.967, 7.1],
      "endAt": 11.54,
      "snapWindow": 0.45,
      "minSlideSeconds": 1.25,
      "maxSlideSeconds": 4.5
    }
  }
}
```

The dashboard passes the selected track and preset into generation. From the command line, the same behavior is available with:

```bash
python3 scripts/classic_slideshow.py \
  --source-dir "$HOME/reading a classic" \
  --audio-file "$HOME/reading a classic/music/track-name.mov" \
  --timing-preset-file "$HOME/reading a classic/music/track-preset.json" \
  --snap-to-beats
```

For repeatable picks:

```bash
python3 scripts/classic_slideshow.py \
  --source-dir "$HOME/reading a classic" \
  --seed 7
```

For a TikTok video draft upload using local FILE_UPLOAD:

```bash
export TIKTOK_ACCESS_TOKEN="..."
python3 scripts/classic_slideshow.py \
  --source-dir "$HOME/reading a classic" \
  --upload-tiktok-video-draft
```

For a TikTok photo carousel media upload, first host the generated `slides/*.jpg` files at public URLs under a TikTok-verified URL prefix. Then either pass a base URL:

```bash
python3 scripts/classic_slideshow.py \
  --source-dir "$HOME/reading a classic" \
  --public-url-base "https://example.com/classic-slideshow" \
  --upload-tiktok-photo-carousel
```

Or pass exact image URLs:

```bash
python3 scripts/classic_slideshow.py \
  --source-dir "$HOME/reading a classic" \
  --photo-url "https://example.com/slide-01.jpg" \
  --photo-url "https://example.com/slide-02.jpg" \
  --photo-url "https://example.com/slide-03.jpg" \
  --photo-url "https://example.com/slide-04.jpg" \
  --upload-tiktok-photo-carousel
```

TikTok's photo carousel endpoint currently uses `MEDIA_UPLOAD` but still requires `source_info.source = PULL_FROM_URL`, so local binary upload is only implemented for the generated MP4 video draft path.
