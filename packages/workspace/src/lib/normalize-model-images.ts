import type { LanguageModelV2ToolResultOutput } from "@ai-sdk/provider";
import type { FilePart, ModelMessage } from "ai";

import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import crypto from "node:crypto";

import { imageViewLimits, imageViewSize } from "./image-view-size";
import { measureImage, renderImage } from "./render-image";

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

const DROPPED_NOTE =
  "[Image omitted: it could not be reduced to a size this model accepts.]";

// One turn re-sends the whole transcript, so without this every image in the
// history is re-encoded on every request. Keyed on the source bytes and the
// budget, so a cache hit is byte-identical to what a miss would produce --
// which also keeps the prompt cache from breaking on a re-render.
const RENDER_CACHE = new Map<string, Awaited<ReturnType<typeof renderImage>>>();
const RENDER_CACHE_LIMIT = 32;

function cacheKey(bytes: Buffer, limits: ReturnType<typeof imageViewLimits>) {
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
    return undefined;
  }
  const base64 = data.startsWith("data:")
    ? data.slice(data.indexOf(";base64,") + ";base64,".length)
    : data;
  if (data.startsWith("data:") && !data.includes(";base64,")) {
    return undefined;
  }
  try {
    return Buffer.from(base64, "base64");
  } catch {
    return undefined;
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

/**
 * Bring one image inside the budget, or report that it cannot be.
 *
 * `unchanged` is the common case and matters: an image already inside the
 * budget is passed through byte-for-byte, so the pixels the model sees are the
 * ones on disk and no re-encode can soften them.
 */
async function normalizeImage({
  data,
  model,
  signal,
}: {
  data: unknown;
  model: AIGatewayModel.Type;
  signal?: AbortSignal;
}): Promise<
  | { data: string | Uint8Array; mediaType: string; state: "replaced" }
  | { state: "dropped" }
  | { state: "unchanged" }
> {
  const bytes = decodeImageData(data);
  if (!bytes) {
    return { state: "unchanged" };
  }

  const size = measureImage(bytes);
  if (!size) {
    return { state: "unchanged" };
  }

  const limits = imageViewLimits(model.params.provider);
  const target = imageViewSize({ ...size, limits });
  const withinBudget =
    target.width === size.width && target.height === size.height;
  if (withinBudget && bytes.byteLength <= MAX_RAW_BYTES) {
    return { state: "unchanged" };
  }

  const key = cacheKey(bytes, limits);
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
    return { state: "dropped" };
  }

  return {
    data: encodeLikeSource(data, rendered.bytes, rendered.mediaType),
    mediaType: rendered.mediaType,
    state: "replaced",
  };
}

function isImagePart(part: { type: string }): part is FilePart {
  return (
    part.type === "file" &&
    "mediaType" in part &&
    typeof part.mediaType === "string" &&
    part.mediaType.startsWith("image/")
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
  model,
  signal,
}: {
  messages: ModelMessage[];
  model: AIGatewayModel.Type;
  signal?: AbortSignal;
}): Promise<ModelMessage[]> {
  async function normalizeFilePart(part: FilePart) {
    const normalized = await normalizeImage({
      data: part.data,
      model,
      signal,
    });
    if (normalized.state === "dropped") {
      return { text: DROPPED_NOTE, type: "text" as const };
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
        model,
        signal,
      });
      if (normalized.state === "dropped") {
        value.push({ text: DROPPED_NOTE, type: "text" });
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
