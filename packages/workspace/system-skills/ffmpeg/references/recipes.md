# FFmpeg recipes

Use these recipes after probing inputs. Add `-threads` limits when long or concurrent encodes could cause CPU contention.

## Generate synthetic clips

When there is no input file, build frames with a lavfi source such as `color`, `testsrc`, or `smptebars`. Bound the source with `d=` (or `-t` on the output): a lavfi source with no duration runs until the command is killed. Keep generators in `-i` and processing filters in `-vf`.

```bash
# Solid color
ffmpeg -n -f lavfi -i "color=c=red:s=640x480:r=30:d=5" \
  -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart "$OUTPUT"

# Test pattern
ffmpeg -n -f lavfi -i "testsrc=s=640x480:r=30:d=5" \
  -c:v libx264 -crf 23 -pix_fmt yuv420p "$OUTPUT"
```

Draw a shape with `drawbox`/`drawtext` on a canvas rather than letting it fill the frame, so transforms applied afterward do not clip it.

## Rotate

```bash
# 90 degrees clockwise
ffmpeg -n -i "$INPUT" -vf "transpose=1" \
  -c:v libx264 -crf 23 -preset medium -c:a copy "$OUTPUT"

# 90 degrees counterclockwise
ffmpeg -n -i "$INPUT" -vf "transpose=2" \
  -c:v libx264 -crf 23 -preset medium -c:a copy "$OUTPUT"

# 180 degrees
ffmpeg -n -i "$INPUT" -vf "hflip,vflip" \
  -c:v libx264 -crf 23 -preset medium -c:a copy "$OUTPUT"
```

`rotate` and other geometric filters spin content at a fixed output size, so anything reaching the frame edge is clipped and the uncovered area takes `fillcolor` (black under `yuv420p`, which has no alpha).

## Add silent audio

Useful when concatenating silent clips with clips that contain audio:

```bash
ffmpeg -n -i "$INPUT" \
  -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=48000" \
  -map 0:v:0 -map 1:a:0 \
  -c:v copy -c:a aac -shortest \
  "$OUTPUT"
```

## Concatenate mixed inputs

The concat filter requires compatible dimensions and formats. Normalize each video and audio stream before concatenation. This two-input example scales and pads both videos to 1920x1080 and normalizes audio to stereo 48 kHz:

```bash
ffmpeg -n \
  -i "$INPUT_1" \
  -i "$INPUT_2" \
  -filter_complex \
  "[0:v:0]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,setpts=PTS-STARTPTS[v0]; \
   [1:v:0]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,setpts=PTS-STARTPTS[v1]; \
   [0:a:0]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a0]; \
   [1:a:0]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a1]; \
   [v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" \
  -c:v libx264 -crf 23 -preset medium \
  -c:a aac -b:a 128k -pix_fmt yuv420p \
  "$OUTPUT"
```

If an input lacks audio, add silent audio first or use a video-only concat:

```bash
ffmpeg -n \
  -i "$INPUT_1" \
  -i "$INPUT_2" \
  -filter_complex \
  "[0:v:0]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,setpts=PTS-STARTPTS[v0]; \
   [1:v:0]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,setpts=PTS-STARTPTS[v1]; \
   [v0][v1]concat=n=2:v=1:a=0[v]" \
  -map "[v]" \
  -c:v libx264 -crf 23 -preset medium -pix_fmt yuv420p \
  "$OUTPUT"
```

## Replace audio

```bash
ffmpeg -n \
  -i "$VIDEO_INPUT" \
  -i "$AUDIO_INPUT" \
  -map 0:v:0 -map 1:a:0 \
  -c:v copy -c:a aac -shortest \
  "$OUTPUT"
```

If copying the video is incompatible with the output container, re-encode it.

## Mix background music

Mix music under the existing audio at 20 percent volume:

```bash
ffmpeg -n \
  -i "$VIDEO_INPUT" \
  -i "$MUSIC_INPUT" \
  -filter_complex \
  "[1:a:0]volume=0.20[music];[0:a:0][music]amix=inputs=2:duration=first:dropout_transition=2[a]" \
  -map 0:v:0 -map "[a]" \
  -c:v copy -c:a aac -shortest \
  "$OUTPUT"
```

Probe first because this requires audio in both inputs.

## Change or normalize volume

Set relative volume:

```bash
ffmpeg -n -i "$INPUT" \
  -map "0:v:0?" -map 0:a:0 \
  -c:v copy -af "volume=0.5" -c:a aac \
  "$OUTPUT"
```

Use the EBU R128 loudness normalizer for a simple one-pass normalization:

```bash
ffmpeg -n -i "$INPUT" \
  -map "0:v:0?" -map 0:a:0 \
  -c:v copy -af "loudnorm" -c:a aac \
  "$OUTPUT"
```

For delivery to a specific loudness target, measure first and feed the measurement back, which is what lets `loudnorm` apply linear gain instead of guessing dynamically. Pass 1 prints a JSON block on stderr; read `input_i`, `input_tp`, `input_lra`, `input_thresh`, and `target_offset` out of it and substitute them into pass 2. The two passes must carry identical `I`, `TP`, and `LRA` values.

```bash
ffmpeg -i "$INPUT" -map 0:a:0 \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json" \
  -f null -

ffmpeg -n -i "$INPUT" \
  -map "0:v:0?" -map 0:a:0 -c:v copy \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=$INPUT_I:measured_TP=$INPUT_TP:measured_LRA=$INPUT_LRA:measured_thresh=$INPUT_THRESH:offset=$TARGET_OFFSET:linear=true" \
  -c:a aac -b:a 192k \
  "$OUTPUT"
```

`-f null -` discards pass 1's output without naming a sink file, and is spelled the same on every platform.

## Fade audio and video

For a 30-second video with two-second fades:

```bash
ffmpeg -n -i "$INPUT" \
  -vf "fade=t=in:st=0:d=2,fade=t=out:st=28:d=2" \
  -af "afade=t=in:st=0:d=2,afade=t=out:st=28:d=2" \
  -c:v libx264 -crf 23 -preset medium -c:a aac \
  "$OUTPUT"
```

Probe duration and calculate `fade_out_start = duration - fade_duration`.

## Change speed

Double speed with audio:

```bash
ffmpeg -n -i "$INPUT" \
  -filter_complex \
  "[0:v:0]setpts=0.5*PTS[v];[0:a:0]atempo=2.0[a]" \
  -map "[v]" -map "[a]" \
  -c:v libx264 -crf 23 -preset medium -c:a aac \
  "$OUTPUT"
```

Half speed with audio:

```bash
ffmpeg -n -i "$INPUT" \
  -filter_complex \
  "[0:v:0]setpts=2.0*PTS[v];[0:a:0]atempo=0.5[a]" \
  -map "[v]" -map "[a]" \
  -c:v libx264 -crf 23 -preset medium -c:a aac \
  "$OUTPUT"
```

Probe for audio first. For silent video, omit the audio filter and mapping.

## Change frame rate

```bash
ffmpeg -n -i "$INPUT" \
  -vf "fps=30" \
  -c:v libx264 -crf 23 -preset medium -c:a aac \
  "$OUTPUT"
```

## Create a GIF

Generate and use a palette for better quality. Store the palette in temporary workspace storage and remove it after successful output:

```bash
ffmpeg -n -ss 00:00:00 -t 00:00:03 -i "$INPUT" \
  -vf "fps=12,scale=480:-2:flags=lanczos,palettegen" \
  "$PALETTE"

ffmpeg -n -ss 00:00:00 -t 00:00:03 -i "$INPUT" \
  -i "$PALETTE" \
  -filter_complex \
  "[0:v]fps=12,scale=480:-2:flags=lanczos[v];[v][1:v]paletteuse" \
  "$OUTPUT"
```

## Extract multiple frames

One frame per second:

```bash
ffmpeg -n -i "$INPUT" -vf "fps=1" "$FRAME_DIR/frame_%06d.jpg"
```

One frame every ten seconds:

```bash
ffmpeg -n -i "$INPUT" -vf "fps=1/10" "$FRAME_DIR/frame_%06d.jpg"
```

Create the output directory before running FFmpeg.

## Contact sheet

Sample one frame every ten seconds and arrange a 3 by 3 grid:

```bash
ffmpeg -n -i "$INPUT" \
  -vf "fps=1/10,scale=320:-2,tile=3x3" \
  -frames:v 1 \
  "$OUTPUT"
```

Adjust the sampling interval and tile dimensions to cover the requested duration.

## Slideshow from images

If filenames form a numbered sequence:

```bash
ffmpeg -n -framerate 1/3 \
  -i "$FRAME_DIR/frame_%06d.jpg" \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1" \
  -c:v libx264 -crf 23 -pix_fmt yuv420p \
  "$OUTPUT"
```

`-framerate 1/3` displays each image for three seconds. Prefer numbered sequences over shell globbing because glob behavior differs across platforms.

## Add subtitles

Burn subtitles into video:

```bash
ffmpeg -n -i "$INPUT" \
  -vf "subtitles=$SUBTITLE_FILE" \
  -c:v libx264 -crf 23 -preset medium -c:a aac \
  "$OUTPUT"
```

Subtitle filter path escaping is platform-sensitive. If the path contains special characters, use a simple workspace-relative filename or escape it for the current FFmpeg build.

Add a selectable subtitle stream to MKV:

```bash
ffmpeg -n -i "$INPUT" -i "$SUBTITLE_FILE" \
  -map 0 -map 1:0 -c copy -c:s srt \
  "$OUTPUT"
```

Add a selectable subtitle stream to MP4:

```bash
ffmpeg -n -i "$INPUT" -i "$SUBTITLE_FILE" \
  -map 0 -map 1:0 -c copy -c:s mov_text \
  "$OUTPUT"
```

## Add text

Write user-provided text to `$TEXT_FILE`, then reference the file:

```bash
ffmpeg -n -i "$INPUT" \
  -vf "drawtext=textfile='$TEXT_FILE':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=h-100" \
  -c:v libx264 -crf 23 -preset medium -c:a aac \
  "$OUTPUT"
```

Filter path escaping is platform-sensitive. Avoid interpolating user text directly into `drawtext=text=`.

## Add an image overlay

Place an image ten pixels from the top-left corner:

```bash
ffmpeg -n \
  -i "$INPUT" -i "$IMAGE" \
  -filter_complex "[0:v:0][1:v:0]overlay=10:10[v]" \
  -map "[v]" -map "0:a:0?" \
  -c:v libx264 -crf 23 -preset medium -c:a aac \
  "$OUTPUT"
```

Center the overlay by replacing `overlay=10:10` with:

```text
overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2
```

## Picture in picture

Scale the second video to 25 percent of the first video's width and place it in the bottom-right corner:

```bash
ffmpeg -n \
  -i "$BACKGROUND" -i "$FOREGROUND" \
  -filter_complex \
  "[1:v:0][0:v:0]scale2ref=w=main_w*0.25:h=-2[pip][base];[base][pip]overlay=main_w-overlay_w-24:main_h-overlay_h-24[v]" \
  -map "[v]" -map "0:a:0?" \
  -c:v libx264 -crf 23 -preset medium -c:a aac \
  "$OUTPUT"
```

## Social-media formats

Vertical 9:16 center crop:

```bash
ffmpeg -n -i "$INPUT" \
  -vf "crop='if(gt(iw/ih,9/16),ih*9/16,iw)':'if(gt(iw/ih,9/16),ih,iw*16/9)',scale=1080:1920,setsar=1" \
  -c:v libx264 -crf 23 -preset medium \
  -c:a aac -b:a 128k -pix_fmt yuv420p \
  "$OUTPUT"
```

Square center crop:

```bash
ffmpeg -n -i "$INPUT" \
  -vf "crop='min(iw,ih)':'min(iw,ih)',scale=1080:1080,setsar=1" \
  -c:v libx264 -crf 23 -preset medium \
  -c:a aac -b:a 128k -pix_fmt yuv420p \
  "$OUTPUT"
```

Fit into a vertical canvas without cropping:

```bash
ffmpeg -n -i "$INPUT" \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1" \
  -c:v libx264 -crf 23 -preset medium \
  -c:a aac -b:a 128k -pix_fmt yuv420p \
  "$OUTPUT"
```

## Remove metadata

```bash
ffmpeg -n -i "$INPUT" -map 0 -map_metadata -1 -c copy "$OUTPUT"
```

## Repair odd dimensions

Useful when H.264 rejects odd width or height:

```bash
ffmpeg -n -i "$INPUT" \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
  -c:v libx264 -crf 23 -preset medium -c:a copy \
  "$OUTPUT"
```
