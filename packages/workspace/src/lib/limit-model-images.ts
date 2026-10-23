import type { ModelMessage } from "ai";

import { mapModelMessageParts } from "./model-message-parts";

/**
 * When the images in one request pass either trigger, the oldest leave until
 * both targets hold. The triggers sit just under the hardest limits a
 * provider refuses a request at (Anthropic: 100 images for a model with a
 * 200k-token window, 32 MB for the whole request), since a refused request
 * is sent again unchanged on every later turn and the chat could never answer
 * again. Below them nothing is left out: images count toward the context
 * like anything else and the window's rollover bounds them.
 *
 * The gap between trigger and target is what keeps the cached request prefix
 * stable: a new image moves the cut only once the images since the last cut
 * fill that gap again, rather than on every request.
 */
const IMAGE_COUNT_TRIGGER = 90;
const IMAGE_COUNT_TARGET = 50;
/** Base64-encoded, as the images are sent. */
const IMAGE_BYTES_TRIGGER = 25 * 1024 * 1024;
const IMAGE_BYTES_TARGET = 15 * 1024 * 1024;

const DROPPED_NOTE = `<system_note>
This image was left out of this request to keep it within what a model accepts at once, and is no longer visible to you. Do not describe it from memory; read the file again if you need it.
</system_note>`;

/**
 * Leave the oldest images out of a request that would carry more than a
 * provider accepts at once, replacing each with a note.
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

/**
 * The index of the oldest image the request keeps, given every image's
 * encoded size in order: the images are replayed oldest first, and whenever
 * those kept pass a trigger the oldest leave until both targets hold.
 */
export function firstKept(sizes: readonly number[]): number {
  let cut = 0;
  let bytes = 0;
  for (let index = 0; index < sizes.length; index++) {
    bytes += sizes[index] ?? 0;
    const count = index + 1 - cut;
    if (count <= IMAGE_COUNT_TRIGGER && bytes <= IMAGE_BYTES_TRIGGER) {
      continue;
    }
    while (
      cut <= index &&
      (index + 1 - cut > IMAGE_COUNT_TARGET || bytes > IMAGE_BYTES_TARGET)
    ) {
      bytes -= sizes[cut] ?? 0;
      cut += 1;
    }
  }
  return cut;
}
