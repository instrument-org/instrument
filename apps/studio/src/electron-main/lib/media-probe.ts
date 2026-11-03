import { FFPROBE_PATH } from "@instrument-org/workspace/electron";
import fs from "node:fs/promises";
import { z } from "zod";

import { runBinary } from "./video-storyboard";

/**
 * What a media file holds, read by the bundled ffprobe before a player is
 * chosen for it: whether it has a picture. The file viewer mounts the one
 * player that answer calls for, so no player is made to find out and then
 * thrown away. A video's shape and a recording's length are for the file's
 * info.
 *
 * Album art in a song is a video stream marked as an attached picture, and
 * does not count. Kept in memory by path and mtime, so a file is read once
 * per version.
 */
export type MediaProbe = {
  durationSeconds?: number;
  /** As the picture is shown, a rotated video's turned to match. */
  height?: number;
  picture: boolean;
  width?: number;
};

/** Longer than this, the probe is given up and the file opens by its extension. */
const TIMEOUT_MS = 10_000;
/** Probes kept, newest last. */
const KEPT = 200;

const kept = new Map<string, MediaProbe>();

/** The file's probe, or null where ffprobe could not read it. */
export async function probeMedia(
  hostPath: string,
  signal?: AbortSignal,
  ffprobe: string = FFPROBE_PATH,
): Promise<MediaProbe | null> {
  const stats = await fs.stat(hostPath);
  if (!stats.isFile()) {
    return null;
  }
  const key = `${hostPath}\0${stats.mtimeMs}`;
  const known = kept.get(key);
  if (known) {
    return known;
  }
  const stop = AbortSignal.any([
    ...(signal ? [signal] : []),
    AbortSignal.timeout(TIMEOUT_MS),
  ]);
  const result = await runBinary(
    ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,width,height:stream_disposition=attached_pic:stream_side_data=rotation:format=duration",
      "-of",
      "json",
      hostPath,
    ],
    stop,
  );
  if (!result.ok) {
    return null;
  }
  const probe = probeOf(result.stdout);
  if (!probe) {
    return null;
  }
  kept.set(key, probe);
  if (kept.size > KEPT) {
    const oldest = kept.keys().next().value;
    if (oldest !== undefined) {
      kept.delete(oldest);
    }
  }
  return probe;
}

const ProbeSchema = z.object({
  format: z.object({ duration: z.string().optional() }).optional(),
  streams: z.array(
    z.object({
      codec_type: z.string().optional(),
      disposition: z.object({ attached_pic: z.number().optional() }).optional(),
      height: z.number().optional(),
      side_data_list: z
        .array(z.object({ rotation: z.number().optional() }))
        .optional(),
      width: z.number().optional(),
    }),
  ),
});

/** ffprobe's JSON as a probe, or null where it is not what ffprobe writes. */
export function probeOf(stdout: string): MediaProbe | null {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return null;
  }
  const parsed = ProbeSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }
  const picture = parsed.data.streams.find(
    (stream) =>
      stream.codec_type === "video" && stream.disposition?.attached_pic !== 1,
  );
  const quarterTurns = Math.round(
    (picture?.side_data_list?.find(({ rotation }) => rotation !== undefined)
      ?.rotation ?? 0) / 90,
  );
  const isTurned = quarterTurns % 2 !== 0;
  const width = isTurned ? picture?.height : picture?.width;
  const height = isTurned ? picture?.width : picture?.height;
  const durationSeconds = Number(parsed.data.format?.duration);
  return {
    ...(Number.isFinite(durationSeconds) && durationSeconds > 0
      ? { durationSeconds }
      : {}),
    ...(height ? { height } : {}),
    picture: picture !== undefined,
    ...(width ? { width } : {}),
  };
}
