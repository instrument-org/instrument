import { err, ok } from "neverthrow";

import { isCompleteImage } from "./probe-media";
import { exceedsDecodeBudget, measureImage, renderImage } from "./render-image";

// What an image model takes as a reference image. A format outside this set is
// re-encoded rather than refused, since ffmpeg can usually read it.
const ACCEPTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// The provider caps a single reference image at 50 MB, and the bytes travel
// base64'd inside a JSON body, which costs a third on top. The budget sits well
// under the cap: an image model resizes its references far below this anyway, so
// the room is only there to keep a large photo from being rejected outright.
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

// Components in a JPEG's frame header: one is grayscale, three is color, and
// four is CMYK or YCCK. The last is a print color space rather than a screen
// one, and a decoder that only handles screen images rejects it for its mode
// while reporting nothing about which file was at fault.
const SCREEN_JPEG_COMPONENTS = new Set([1, 3]);

/**
 * Bring one img2img reference image into a shape the provider will accept.
 *
 * A file the provider cannot decode comes back as a 400 that names the image by
 * position and nothing else -- after the request was built, sent, and paid for,
 * and with no way for the agent to tell which of the paths it passed was the
 * problem. Every check here happens before that: what can be converted is
 * converted, and what cannot is refused with the path and the reason.
 *
 * Passing an image through untouched is the common case and the important one.
 * A reference image is the picture the user asked to edit, so re-encoding one
 * that was already fine would soften it for nothing.
 */
export async function prepareSourceImage({
  bytes,
  displayPath,
  signal,
}: {
  bytes: Buffer;
  displayPath: string;
  signal?: AbortSignal;
}) {
  const size = measureImage(bytes);
  if (!size) {
    return err(
      `Source image ${displayPath} is not readable as an image. It may be truncated, or it may not be the format its name claims.`,
    );
  }

  if (exceedsDecodeBudget(size)) {
    return err(
      `Source image ${displayPath} is ${size.width}x${size.height}, too large to decode. Downscale it and pass the smaller copy.`,
    );
  }

  const acceptedFormat =
    size.mediaType !== undefined && ACCEPTED_MEDIA_TYPES.has(size.mediaType);

  if (acceptedFormat && !isCompleteImage(bytes, size.mediaType)) {
    // Re-encoding would produce a valid image of the half that arrived, which
    // is not the picture anyone asked to edit.
    return err(
      `Source image ${displayPath} is incomplete: the file ends before the image data does. Re-export it and pass the whole file.`,
    );
  }

  if (
    acceptedFormat &&
    isScreenJpeg(bytes) &&
    bytes.byteLength <= MAX_SOURCE_BYTES
  ) {
    return ok(bytes);
  }

  const rendered = await renderImage({
    bytes,
    maxBytes: MAX_SOURCE_BYTES,
    signal,
    target: size,
  });

  switch (rendered.state) {
    case "failed": {
      return err(
        acceptedFormat
          ? `Source image ${displayPath} could not be reduced to a size the image model accepts. Downscale it and pass the smaller copy.`
          : `Source image ${displayPath} is in a format the image model does not accept (${size.format?.toUpperCase() ?? "unrecognized"}), and it could not be converted here. Pass a PNG, JPEG, or WebP copy instead.`,
      );
    }
    case "rendered": {
      return ok(rendered.image.bytes);
    }
    case "unavailable": {
      // ffmpeg never ran, so nothing is known about these bytes beyond what
      // their header said. Sending them is what happened before this pass
      // existed, and it beats refusing a picture that is probably fine over a
      // binary that would not start.
      return bytes.byteLength <= MAX_SOURCE_BYTES
        ? ok(bytes)
        : err(
            `Source image ${displayPath} is too large to send, and it could not be resized on this system. Downscale it and pass the smaller copy.`,
          );
    }
  }
}

// Start-of-frame markers, which are every 0xC-something except the three that
// start a table or an arithmetic-coding definition instead.
function isFrameHeader(marker: number) {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

/**
 * Whether a JPEG's frame header describes an ordinary screen image.
 *
 * `true` for anything that is not a JPEG at all: this answers one question
 * about one format, and the formats it knows nothing about are settled
 * elsewhere.
 */
function isScreenJpeg(bytes: Buffer) {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return true;
  }

  // Segments run header to header: a two-byte marker, then for all but a
  // handful of standalone markers a two-byte length covering itself and the
  // payload that follows.
  let offset = 2;
  while (offset + 3 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined) {
      return true;
    }
    // Padding, and the standalone markers that carry no length.
    if (
      marker === 0xff ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2;
      continue;
    }
    if (isFrameHeader(marker)) {
      // Marker, length, sample precision, height, width, then the count.
      return SCREEN_JPEG_COMPONENTS.has(bytes[offset + 9] ?? 0);
    }
    // The scan is the last thing before entropy-coded data, which is not made
    // of segments and must not be walked as though it were.
    if (marker === 0xda) {
      return true;
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  return true;
}
