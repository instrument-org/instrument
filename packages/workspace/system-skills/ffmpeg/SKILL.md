---
name: ffmpeg
description: "Convert, trim, compress, and edit local video and audio with FFmpeg, including GIFs, subtitles, and extracting audio."
---

# FFmpeg

Use the pre-installed `ffmpeg` and `ffprobe` commands directly. Prefer simple, explicit commands over elaborate filter graphs.

Treat every recipe as a starting point. Probe the actual inputs, then adapt stream selectors, filters, codecs, dimensions, and mappings to the requested result. Do not force a file through an example whose assumed streams do not match.

Read [references/recipes.md](references/recipes.md) for advanced audio, subtitle, overlay, GIF, slideshow, social-media, and multi-input recipes.

## The bundled build

`ffmpeg` and `ffprobe` are FFmpeg 9.0.2, built for the app with every GPL codec library, so prefer them over another copy on the computer.

- Encoders: x264 (H.264), x265 (HEVC), SVT-AV1 (`libsvtav1`, AV1 and AVIF), libvpx (VP8, VP9), vvenc (H.266), libwebp, libjxl, libopus, libmp3lame, libvorbis, plus FFmpeg's own (AAC, ProRes, PNG, JPEG, GIF, FLAC). `libaom-av1`, `librav1e` and `libopenh264` are not built: use `libsvtav1` and `libx264`.
- Hardware encoders: on macOS, `h264_videotoolbox`, `hevc_videotoolbox` and `prores_videotoolbox` run on the media engine, several times faster than x264 or x265 at lower quality for the size. Take them for long videos where speed matters more than size, with `-b:v` rather than `-crf`.
- A codec or filter this build lacks (`Unknown encoder`, `No such filter`): check `ffmpeg -hide_banner -encoders` or `-filters`, then use another copy by its path if the computer has one, such as `/opt/homebrew/bin/ffmpeg`.

### HEIC and AVIF photos

A phone photo is often a grid of tiles that FFmpeg assembles as a stream group. A plain conversion gets the whole picture:

```bash
ffmpeg -n -i "$INPUT" -frames:v 1 -update 1 "$OUTPUT"
```

`-vf` fails on a tiled photo ("Simple and complex filtering cannot be used together") and `-map 0:v` or `-map 0:g:0` writes single tiles. Filter the grid through `-filter_complex` instead, after checking for one with `ffprobe -v error -show_entries stream_group=index,type -of csv=p=0 "$INPUT"` (`0,Tile Grid`):

```bash
ffmpeg -n -i "$INPUT" -filter_complex "[0:g:0]scale=1600:-2" -frames:v 1 -update 1 "$OUTPUT"
```

## Workflow

1. Identify the input files and desired output.
2. Probe unfamiliar inputs.
3. Decide whether streams can be copied or must be re-encoded.
4. Use a new output path unless overwrite was explicitly requested.
5. Run the simplest command that satisfies the request.
6. Probe the output and confirm the expected streams, duration, and dimensions.

## Safety

- Quote every path.
- Inputs are local file paths, never URLs. FFmpeg has no site extractors and re-fetches on every pass, so use the `media-download` skill to get remote media on disk first.
- Default to `-n`, which fails instead of overwriting an existing output.
- Use `-y` only when the user explicitly requested overwrite.
- Do not delete or replace inputs unless explicitly requested.
- Keep user-provided text out of filter expressions. For `drawtext`, write text to a file and use `textfile=`.
- Save partial or experimental output under a distinct name.
- For long or concurrent encodes, avoid consuming all available CPU. Add an appropriate `-threads` limit when contention is likely.

## Inspect first

Probe streams and container metadata as JSON:

```bash
ffprobe -v error -show_format -show_streams -of json "$INPUT"
```

Common focused queries:

```bash
# Duration in seconds
ffprobe -v error -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 "$INPUT"

# First video stream dimensions
ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height \
  -of csv=s=x:p=0 "$INPUT"

# Stream indexes, types, and codecs
ffprobe -v error \
  -show_entries stream=index,codec_type,codec_name \
  -of table "$INPUT"
```

Probe before concatenation, stream mapping, codec copying, or any operation whose correctness depends on the input layout.

## Copy or re-encode

Use stream copy when media content is unchanged:

```bash
ffmpeg -n -i "$INPUT" -map 0 -c copy "$OUTPUT"
```

Typical stream-copy operations:

- Change a compatible container.
- Remove or extract a stream.
- Make a keyframe-aligned trim.
- Move MP4 metadata for faster playback startup.

Re-encode when:

- Applying any video or audio filter.
- Resizing, cropping, padding, rotating, or changing frame rate.
- Requiring frame-accurate cuts.
- Changing codec or pixel format.
- Normalizing incompatible inputs for concatenation.
- Producing a browser-compatible result from unknown codecs.

If stream copy fails, the streams are usually incompatible with the target container. Re-encode the incompatible streams instead of retrying unchanged.

## Browser-compatible MP4

Use H.264 video, AAC audio, square pixels, a broadly supported pixel format, and fast-start metadata:

```bash
ffmpeg -n -i "$INPUT" \
  -map 0:v:0 -map "0:a:0?" \
  -c:v libx264 -crf 23 -preset medium \
  -c:a aac -b:a 128k \
  -pix_fmt yuv420p -movflags +faststart \
  "$OUTPUT"
```

CRF guidance for H.264:

| Goal           | CRF   | Notes                     |
| -------------- | ----- | ------------------------- |
| High quality   | 18-20 | Larger output             |
| General use    | 23    | Default                   |
| Smaller output | 27-30 | More visible quality loss |

Lower CRF means higher quality and a larger file. Use H.265, VP9, or AV1 only when the user requests them or compatibility requirements permit them.

## Target a file size

When a size ceiling is the requirement, bitrate is the control and CRF is not: CRF asks for a quality level and reports the size afterward. Derive the bitrate from the budget and the real duration, then hold the encoder to it across two passes.

```
total bitrate (bits/s) = target bytes * 8 / duration in seconds
video bitrate          = total bitrate - audio bitrate
```

Probe the duration rather than trusting the one in the request, and leave 5-10% of the budget for container overhead.

Pass 1 measures the material, pass 2 encodes to that measurement. Every encoding setting must match between them, or the statistics describe a different encode than the one they steer:

```bash
ffmpeg -n -i "$INPUT" -map 0:v:0 -vf "scale=1280:-2,setsar=1" \
  -c:v libx264 -preset slow -b:v "$VIDEO_BITRATE" \
  -pass 1 -an -f null -

ffmpeg -n -i "$INPUT" -map 0:v:0 -map "0:a:0?" -vf "scale=1280:-2,setsar=1" \
  -c:v libx264 -preset slow -b:v "$VIDEO_BITRATE" \
  -pass 2 -c:a aac -b:a 128k -movflags +faststart "$OUTPUT"
```

`-f null -` throws pass 1's frames away without naming a sink file, and is spelled the same on every platform. The passes hand statistics to each other through `ffmpeg2pass-0.log` in the working directory, so run both from the same directory and delete the log and its `.mbtree` companion afterward.

Spend the budget on dimensions and frame rate before spending it on bitrate. A screen recording encoded at capture resolution puts most of its bits into detail that a 720p player never shows, and 60 fps costs roughly a third more than 30 for footage that does not need it.

Two passes land near the target, not exactly on it, so confirm the result against the ceiling before reporting success:

```bash
ffprobe -v error -show_entries format=size \
  -of default=noprint_wrappers=1:nokey=1 "$OUTPUT"
```

## Core recipes

### Remux without re-encoding

```bash
ffmpeg -n -i "$INPUT" -map 0 -c copy "$OUTPUT"
```

For an existing MP4 or MOV that should begin playback sooner:

```bash
ffmpeg -n -i "$INPUT" -map 0 -c copy -movflags +faststart "$OUTPUT"
```

### Trim

Fast, keyframe-aligned trim:

```bash
ffmpeg -n -ss 00:01:00 -i "$INPUT" -t 00:00:10 -map 0 -c copy "$OUTPUT"
```

Frame-accurate trim:

```bash
ffmpeg -n -i "$INPUT" -ss 00:01:00 -t 00:00:10 \
  -map 0:v:0 -map "0:a:0?" \
  -c:v libx264 -crf 23 -preset medium -c:a aac \
  "$OUTPUT"
```

`-t` is duration. Prefer it when the user gives a start time and clip length.

### Resize

Set width and preserve aspect ratio. `-2` selects an even height:

```bash
ffmpeg -n -i "$INPUT" \
  -vf "scale=1280:-2,setsar=1" \
  -c:v libx264 -crf 23 -preset medium -c:a aac \
  "$OUTPUT"
```

Fit inside a 1920x1080 canvas without cropping:

```bash
ffmpeg -n -i "$INPUT" \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1" \
  -c:v libx264 -crf 23 -preset medium \
  -c:a aac -b:a 128k -pix_fmt yuv420p \
  "$OUTPUT"
```

### Crop

Center crop to a square:

```bash
ffmpeg -n -i "$INPUT" \
  -vf "crop='min(iw,ih)':'min(iw,ih)',setsar=1" \
  -c:v libx264 -crf 23 -preset medium -c:a aac \
  "$OUTPUT"
```

### Extract a frame

```bash
ffmpeg -n -ss 00:00:07 -i "$INPUT" -frames:v 1 -q:v 2 "$OUTPUT"
```

Use PNG output for lossless frames. Use JPEG with `-q:v 2` for compact, high-quality thumbnails.

### Extract audio

Copy the first audio stream without quality loss:

```bash
ffmpeg -n -i "$INPUT" -map 0:a:0 -c:a copy "$OUTPUT"
```

Create mono 16 kHz WAV for speech processing:

```bash
ffmpeg -n -i "$INPUT" -vn -c:a pcm_s16le -ar 16000 -ac 1 "$OUTPUT"
```

This is the form transcribers want, and `-vn` means a video input needs no separate extraction pass. To transcribe the result, hand off to the `local-ml` skill, which covers choosing a model against the recording's duration. Converting does not itself make transcription faster, since the decoder reads only the audio stream either way.

### Remove audio

```bash
ffmpeg -n -i "$INPUT" -map 0:v:0 -c:v copy -an "$OUTPUT"
```

### Concatenate sequential clips

Treat requests to combine, join, merge, stitch, append, or put clips end to end as sequential concatenation unless the user asks for a grid, overlay, or picture-in-picture layout.

When all inputs have compatible stream layouts and codecs, use the concat demuxer with a list file:

```text
file '/absolute/path/to/clip-1.mp4'
file '/absolute/path/to/clip-2.mp4'
file '/absolute/path/to/clip-3.mp4'
```

```bash
ffmpeg -n -f concat -safe 0 -i "$LIST_FILE" -map 0 -c copy "$OUTPUT"
```

Create the list with file-writing tools rather than interpolating untrusted paths into a shell command. Single quotes inside paths must be escaped according to the concat file format.

If codecs, dimensions, time bases, or stream layouts differ, normalize or re-encode them. See [references/recipes.md](references/recipes.md).

## Stream mapping

Do not rely on implicit stream selection for files with multiple streams.

```bash
# First video and optional first audio
-map 0:v:0 -map "0:a:0?"

# All streams
-map 0

# Video from first input and audio from second
-map 0:v:0 -map 1:a:0
```

The trailing `?` makes a mapping optional. Use it when audio may be absent.

## Compose a filter graph

For multi-step visual work, build the graph from left to right:

1. Select each input stream explicitly.
2. Normalize or transform each stream and give it a label.
3. Combine labeled streams.
4. Map only the final labels and any retained streams.

This example scales a foreground image, labels both stages, overlays it on the video, and preserves optional audio from the first input:

```bash
ffmpeg -n \
  -i "$VIDEO" -i "$IMAGE" \
  -filter_complex \
  "[1:v:0]scale=240:-2[mark];[0:v:0][mark]overlay=main_w-overlay_w-24:24[video]" \
  -map "[video]" -map "0:a:0?" \
  -c:v libx264 -crf 23 -preset medium \
  -c:a aac -b:a 128k -pix_fmt yuv420p \
  "$OUTPUT"
```

Add a labeled stage instead of rewriting the entire graph when the request gains another transform. If a graph becomes hard to quote or inspect, write the filter expression to a workspace file and pass it with `-filter_complex_script`.

## Verify output

At minimum, ensure FFprobe can read the output:

```bash
ffprobe -v error -show_format -show_streams -of json "$OUTPUT"
```

Check the properties relevant to the request:

- Expected duration after trim, speed change, or concatenation.
- Expected dimensions and aspect ratio after resize or crop.
- Expected video, audio, and subtitle streams.
- Expected codecs and container compatibility.
- Nonzero output size and no FFmpeg errors.

FFprobe confirms structure, not appearance. When correctness is visual, such as generated graphics, shapes, overlays, or text position, extract a representative frame and inspect it before reporting success:

```bash
ffmpeg -n -ss 00:00:01 -i "$OUTPUT" -frames:v 1 -q:v 2 frame-check.png
```

If FFmpeg fails, read the diagnostic and change the command based on the actual error. Do not rerun the same command unchanged.

## Common failures

| Symptom                                   | Likely fix                                              |
| ----------------------------------------- | ------------------------------------------------------- |
| Width or height is not divisible by 2     | Scale to even dimensions with `-2` or `trunc(.../2)*2`  |
| Codec is unsupported by container         | Re-encode that stream or choose a compatible container  |
| Output has no audio                       | Probe inputs and add explicit optional audio mapping    |
| Browser cannot play output                | Use H.264, AAC, `yuv420p`, and `+faststart`             |
| Output is unexpectedly large              | Increase CRF, reduce dimensions, or use a slower preset |
| Audio and video drift after speed change  | Apply matching video and audio timing filters           |
| Concat fails                              | Normalize codecs, dimensions, time bases, and streams   |
| `moov atom not found`                     | Input is incomplete or corrupt                          |
| Text overlay parsing fails                | Use `drawtext=textfile=...`                             |
| Rotated or transformed content is clipped | Keep content away from the frame edge; set `fillcolor`  |
| lavfi command hangs until killed          | Bound the source with `d=` or the output with `-t`      |
