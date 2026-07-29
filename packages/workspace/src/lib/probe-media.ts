import { execa } from "execa";
import { z } from "zod";

import { FFPROBE_PATH } from "./ffmpeg";

// A PDF's header is allowed to sit behind a little leading junk, so readers
// scan the start of the file rather than insisting on offset zero.
const PDF_HEADER_SEARCH_BYTES = 1024;
// The cross-reference table is found by reading backwards from the end, which
// makes the end marker the first thing an interrupted download loses.
const PDF_TRAILER_SEARCH_BYTES = 4096;
// Enough to clear the padding a JPEG may carry after its end-of-image marker,
// while staying far too short for a marker in the middle of a truncated file to
// be mistaken for the one at the end.
const IMAGE_TRAILER_SEARCH_BYTES = 64;

const probeOutputSchema = z.object({
  format: z.object({ format_name: z.string() }).optional(),
});

/**
 * Whether ffprobe can make sense of an audio or video file.
 *
 * Same trade as `measureImage` makes for images. A provider asked to decode a
 * truncated video rejects the whole request, the tool result holding those
 * bytes is already on disk, and every later turn replays it -- so the read is
 * refused here, where it costs one tool call instead of the conversation.
 *
 * Probes the path rather than the bytes on stdin: a container that keeps its
 * index at the end of the file needs to seek, and a pipe cannot.
 */
export async function canDecodeMedia({
  absolutePath,
  signal,
}: {
  absolutePath: string;
  signal?: AbortSignal;
}) {
  const result = await execa(
    FFPROBE_PATH,
    [
      "-v",
      "error",
      "-show_entries",
      "format=format_name",
      "-of",
      "json",
      absolutePath,
    ],
    { cancelSignal: signal, reject: false },
  );

  // No exit code means the probe never reached one, so it holds no opinion:
  // ffprobe failed to spawn, or the caller's signal cut it short. Refusing
  // every audio and video read on that basis would trade a rare bad file for a
  // tool that never works, so the file gets the benefit of the doubt and the
  // provider decides.
  if (result.exitCode === undefined) {
    return true;
  }
  if (result.exitCode !== 0) {
    return false;
  }

  const parsed = probeOutputSchema.safeParse(parseJson(result.stdout));
  return parsed.success && (parsed.data.format?.format_name ?? "") !== "";
}

/**
 * Whether an image carries the marker that says its data is all there.
 *
 * Dimensions come out of the header, so a file cut in half still measures fine
 * and still reads as an ordinary image right up until something decodes it. An
 * image inside the preview budget is passed through byte for byte and nothing
 * ever does, so without this the damaged bytes reach the provider -- which is
 * the rejection this whole path exists to avoid, arriving through the one case
 * that skips every other check.
 *
 * A trailer check rather than a decode, for the same reason the PDF check is
 * one: truncation is the failure that actually happens, the marker settles it
 * for free, and paying an ffmpeg decode on every image read to catch corruption
 * in the middle of a file would cost far more than it caught. `true` for a
 * format not listed here, which only means this check has no opinion.
 */
export function isCompleteImage(bytes: Buffer, mediaType: string | undefined) {
  const tail = bytes.subarray(
    Math.max(0, bytes.byteLength - IMAGE_TRAILER_SEARCH_BYTES),
  );
  switch (mediaType) {
    case "image/jpeg": {
      // Scanned rather than matched at the very end: EXIF editors and scanners
      // are free to leave padding after the end-of-image marker.
      return tail.includes(Buffer.from([0xff, 0xd9]));
    }
    case "image/png": {
      return tail.includes("IEND");
    }
    case "image/webp": {
      // RIFF declares its own payload length in bytes 4-7, so a short file
      // contradicts its own header without needing a marker at the end.
      if (bytes.byteLength < 12) {
        return false;
      }
      return bytes.readUInt32LE(4) + 8 <= bytes.byteLength;
    }
    default: {
      return true;
    }
  }
}

/**
 * Whether a PDF is whole enough for a provider to parse.
 *
 * Both ends have to be there. The header is what says the bytes are a PDF at
 * all, and the end marker is what a truncated transfer takes with it.
 */
export function isReadablePdf(bytes: Buffer) {
  if (!bytes.subarray(0, PDF_HEADER_SEARCH_BYTES).includes("%PDF-")) {
    return false;
  }
  const trailerStart = Math.max(0, bytes.byteLength - PDF_TRAILER_SEARCH_BYTES);
  return bytes.subarray(trailerStart).includes("%%EOF");
}

function parseJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return;
  }
}
