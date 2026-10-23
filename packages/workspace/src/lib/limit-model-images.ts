import type { ModelMessage } from "ai";

import { mapModelMessageParts } from "./model-message-parts";

/**
 * Most images one request carries. Providers refuse a request past a count of
 * their own (Anthropic's is 100) or past a total size, and a refused request
 * is sent again unchanged on every later turn, so a chat that crossed the
 * line could never answer again. Screenshots come back with browser commands
 * on their own, so a long browsing session reaches a count no one chose.
 */
const MAX_IMAGES = 20;

/**
 * How many of the oldest images leave at once when the count passes
 * {@link MAX_IMAGES}. Each removal changes an earlier message and with it the
 * request prefix a provider caches, so the cut moves in steps of this size
 * rather than with every new image.
 */
const DROP_STEP = 10;

/**
 * Most image bytes one request carries, base64-encoded as they are sent.
 * Under Anthropic's 32 MB request ceiling with room for the text, since one
 * preview may be close to 4 MB.
 */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const DROPPED_NOTE = `<system_note>
An earlier image was left out of this request to keep it within what a model accepts at once; the newest images are kept. Read the file again if you need to see it.
</system_note>`;

/**
 * Leave the oldest images out of a request once it carries more than a model
 * accepts at once, by count and by size, replacing each with a note.
 *
 * Runs on the request rather than on the stored history, which keeps every
 * image; the newest are the ones kept, since they are what the work in front
 * of the model is about. Deterministic from the messages alone, so the same
 * history always sends the same request.
 */
export async function limitModelImages(
  messages: ModelMessage[],
): Promise<ModelMessage[]> {
  const sizes: number[] = [];
  await mapModelMessageParts(messages, {
    media: ({ bytes, mediaType }) => {
      if (mediaType?.startsWith("image/") && bytes !== undefined) {
        sizes.push(Math.ceil(bytes.byteLength / 3) * 4);
      }
      return { state: "unchanged" };
    },
  });

  const keepFrom = firstKept(sizes);
  if (keepFrom === 0) {
    return messages;
  }

  let index = 0;
  return mapModelMessageParts(messages, {
    media: ({ bytes, mediaType }) => {
      if (!mediaType?.startsWith("image/") || bytes === undefined) {
        return { state: "unchanged" };
      }
      const position = index;
      index += 1;
      return position < keepFrom
        ? { note: DROPPED_NOTE, state: "dropped" }
        : { state: "unchanged" };
    },
  });
}

/** The index of the oldest image the request keeps, given every image's encoded size in order. */
export function firstKept(sizes: readonly number[]): number {
  const count = sizes.length;
  let keepFrom =
    count <= MAX_IMAGES
      ? 0
      : Math.ceil((count - MAX_IMAGES) / DROP_STEP) * DROP_STEP;
  let total = 0;
  for (let index = count - 1; index >= keepFrom; index--) {
    total += sizes[index] ?? 0;
    if (total > MAX_IMAGE_BYTES) {
      keepFrom = index + 1;
      break;
    }
  }
  return keepFrom;
}
