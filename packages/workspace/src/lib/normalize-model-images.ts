import type { LanguageModelV2ToolResultOutput } from "@ai-sdk/provider";
import type { FilePart, ModelMessage } from "ai";

import crypto from "node:crypto";

import {
  type ImageViewLimits,
  imageViewSize,
  PREVIEW_LIMITS,
} from "./image-view-size";
import { exceedsDecodeBudget, measureImage, renderImage } from "./render-image";

type ContentOutput = Extract<
  LanguageModelV2ToolResultOutput,
  { type: "content" }
>;
type MediaPart = Extract<ContentOutput["value"][number], { type: "media" }>;
type ToolResultPart = Extract<
  ModelMessage["content"][number],
  { type: "tool-result" }
>;

// Anthropic's per-image ceiling is 5 MB base64-encoded, the tightest of the
// providers we send to. Base64 costs a third on top of the raw bytes.
const MAX_ENCODED_BYTES = 5 * 1024 * 1024;
const MAX_RAW_BYTES = Math.floor((MAX_ENCODED_BYTES * 3) / 4);

// Media types a provider is known to accept. A sniffed format outside this set
// is re-encoded rather than refused, since ffmpeg can usually read it.
const SENDABLE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const UNREADABLE_NOTE =
  "[Image omitted: the file is not readable as an image. It may be truncated, or it may not be the format its name claims.]";
const OVERSIZED_NOTE =
  "[Image omitted: it could not be reduced to a size this model accepts.]";
const TOO_MANY_PIXELS_NOTE =
  "[Image omitted: its dimensions are too large to decode. Downscale it and attach the smaller copy.]";

// One turn re-sends the whole transcript, so without this every image in the
// history is re-encoded on every request. Keyed on the source bytes and the
// budget, so a cache hit is byte-identical to what a miss would produce --
// which also keeps the prompt cache from breaking on a re-render.
const RENDER_CACHE = new Map<string, Awaited<ReturnType<typeof renderImage>>>();
const RENDER_CACHE_LIMIT = 32;

/**
 * Resize every outgoing image to the size the model will actually render it at.
 *
 * A provider downscales anything over its budget on the way in, silently and
 * after we have already described the image. Doing it here instead means the
 * dimensions a tool reports are the dimensions the model sees, and a region a
 * tool crops lines up with the picture the model was looking at.
 *
 * This sits at the message level rather than in any one tool so it covers every
 * source of an image: a file the agent read, an image it generated, and a photo
 * the user attached.
 */
export async function normalizeModelImages({
  messages,
  signal,
}: {
  messages: ModelMessage[];
  signal?: AbortSignal;
}): Promise<ModelMessage[]> {
  async function normalizeFilePart(part: FilePart) {
    const normalized = await normalizeImage({
      data: part.data,
      declaredMediaType: part.mediaType,
      signal,
    });
    if (normalized.state === "dropped") {
      return { text: normalized.note, type: "text" as const };
    }
    if (normalized.state === "replaced") {
      return {
        ...part,
        data: normalized.data,
        mediaType: normalized.mediaType,
      };
    }
    return part;
  }

  async function normalizeToolResultPart(part: ToolResultPart) {
    if (!isContentOutput(part.output)) {
      return part;
    }
    const value: ContentOutput["value"] = [];
    for (const item of part.output.value) {
      if (!isImageMedia(item)) {
        value.push(item);
        continue;
      }
      const normalized = await normalizeImage({
        data: item.data,
        declaredMediaType: item.mediaType,
        signal,
      });
      if (normalized.state === "dropped") {
        value.push({ text: normalized.note, type: "text" });
      } else if (normalized.state === "replaced") {
        value.push({
          ...item,
          // A tool result carries media as bare base64, never a data URL.
          data:
            typeof normalized.data === "string"
              ? normalized.data
              : Buffer.from(normalized.data).toString("base64"),
          mediaType: normalized.mediaType,
        });
      } else {
        value.push(item);
      }
    }
    return { ...part, output: { ...part.output, value } };
  }

  const result: ModelMessage[] = [];

  for (const message of messages) {
    if (message.role === "system" || !Array.isArray(message.content)) {
      result.push(message);
      continue;
    }

    if (message.role === "tool") {
      const content = [];
      for (const part of message.content) {
        content.push(
          part.type === "tool-result"
            ? await normalizeToolResultPart(part)
            : part,
        );
      }
      result.push({ ...message, content });
      continue;
    }

    if (message.role === "user") {
      const content = [];
      for (const part of message.content) {
        content.push(isImagePart(part) ? await normalizeFilePart(part) : part);
      }
      result.push({ ...message, content });
      continue;
    }

    const content = [];
    for (const part of message.content) {
      if (isImagePart(part)) {
        content.push(await normalizeFilePart(part));
      } else if (part.type === "tool-result") {
        content.push(await normalizeToolResultPart(part));
      } else {
        content.push(part);
      }
    }
    result.push({ ...message, content });
  }

  return result;
}

function cacheKey(bytes: Buffer, limits: ImageViewLimits) {
  const digest = crypto.createHash("sha1").update(bytes).digest("hex");
  return `${digest}:${limits.maxEdge}:${limits.maxPatches}:${limits.patchSize}`;
}

function decodeImageData(data: unknown) {
  if (data instanceof Uint8Array) {
    return Buffer.from(data);
  }
  if (typeof data !== "string") {
    // A URL the provider fetches itself. We hold no bytes, so there is nothing
    // to measure or resize.
    return;
  }
  const base64 = data.startsWith("data:")
    ? data.slice(data.indexOf(";base64,") + ";base64,".length)
    : data;
  if (data.startsWith("data:") && !data.includes(";base64,")) {
    return;
  }
  try {
    return Buffer.from(base64, "base64");
  } catch {
    return;
  }
}

function encodeLikeSource(data: unknown, bytes: Buffer, mediaType: string) {
  if (data instanceof Uint8Array) {
    return new Uint8Array(bytes);
  }
  if (typeof data === "string" && data.startsWith("data:")) {
    return `data:${mediaType};base64,${bytes.toString("base64")}`;
  }
  return bytes.toString("base64");
}

function isContentOutput(output: unknown): output is ContentOutput {
  return (
    typeof output === "object" &&
    output !== null &&
    "type" in output &&
    output.type === "content" &&
    "value" in output &&
    Array.isArray(output.value)
  );
}

function isImageMedia(item: unknown): item is MediaPart {
  return (
    typeof item === "object" &&
    item !== null &&
    "type" in item &&
    item.type === "media" &&
    "mediaType" in item &&
    typeof item.mediaType === "string" &&
    item.mediaType.startsWith("image/")
  );
}

function isImagePart(part: { type: string }): part is FilePart {
  return (
    part.type === "file" &&
    "mediaType" in part &&
    typeof part.mediaType === "string" &&
    part.mediaType.startsWith("image/")
  );
}

/**
 * Bring one image inside the budget, or report that it cannot be.
 *
 * `unchanged` is the common case and matters: an image already inside the
 * budget is passed through byte-for-byte, so the pixels the model sees are the
 * ones on disk and no re-encode can soften them.
 */
async function normalizeImage({
  data,
  declaredMediaType,
  signal,
}: {
  data: unknown;
  declaredMediaType: string;
  signal?: AbortSignal;
}): Promise<
  | { data: string | Uint8Array; mediaType: string; state: "replaced" }
  | { note: string; state: "dropped" }
  | { state: "unchanged" }
> {
  const bytes = decodeImageData(data);
  if (!bytes) {
    return { state: "unchanged" };
  }

  const size = measureImage(bytes);
  if (!size) {
    // Nothing can read these bytes as an image, so neither can the provider.
    // Sending them anyway costs the whole conversation: the request is rejected
    // for the content, the content is already on disk, and every later turn
    // replays it. Dropping one image is the cheap half of that trade.
    return { note: UNREADABLE_NOTE, state: "dropped" };
  }

  if (exceedsDecodeBudget(size)) {
    // `read_file` refuses these up front, so what reaches here came from
    // somewhere else: a user upload, a generated image, or a session recorded
    // before that check existed.
    return { note: TOO_MANY_PIXELS_NOTE, state: "dropped" };
  }

  const target = imageViewSize({ ...size, limits: PREVIEW_LIMITS });
  const withinBudget =
    target.width === size.width && target.height === size.height;
  // A media type that contradicts the bytes is rejected as surely as bad bytes
  // are, and it is the likelier mistake: media types come from file extensions,
  // which a download or a rename is free to get wrong.
  const honest =
    size.mediaType !== undefined && size.mediaType === declaredMediaType;
  const sendable = honest && SENDABLE_MEDIA_TYPES.has(declaredMediaType);

  if (sendable && withinBudget && bytes.byteLength <= MAX_RAW_BYTES) {
    return { state: "unchanged" };
  }

  const key = cacheKey(bytes, PREVIEW_LIMITS);
  let rendered = RENDER_CACHE.get(key);
  if (!RENDER_CACHE.has(key)) {
    rendered = await renderImage({
      bytes,
      maxBytes: MAX_RAW_BYTES,
      signal,
      target,
    });
    if (RENDER_CACHE.size >= RENDER_CACHE_LIMIT) {
      const oldest = RENDER_CACHE.keys().next();
      if (!oldest.done) {
        RENDER_CACHE.delete(oldest.value);
      }
    }
    RENDER_CACHE.set(key, rendered);
  }

  if (!rendered) {
    return {
      note: sendable ? OVERSIZED_NOTE : UNREADABLE_NOTE,
      state: "dropped",
    };
  }

  return {
    data: encodeLikeSource(data, rendered.bytes, rendered.mediaType),
    mediaType: rendered.mediaType,
    state: "replaced",
  };
}
