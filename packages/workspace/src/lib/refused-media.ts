import type { ModelMessage } from "ai";

import crypto from "node:crypto";

import { mapModelMessageParts } from "./model-message-parts";

/**
 * Media a provider refused, kept out of every later request.
 *
 * Every check before a request reads headers and end markers, so bytes that
 * pass all of them can still be refused: a PNG whose pixel data no inflater
 * accepts measures fine and ends with its `IEND`. The refused part is already
 * in the records, and every request after replays it, so without this one
 * such part ends the conversation.
 *
 * A refusal names the media it blames by the digest of the bytes that went
 * out, recorded on the reply that was refused (`refusedMedia`). The next
 * request leaves those bytes out with a note, and so does every request after
 * it, since the record stays: the repair is permanent and costs no probe.
 */
export function mediaDigest(bytes: Buffer) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/**
 * The media a refused request most likely failed on.
 *
 * Every request before this one was accepted, and the last assistant message
 * is the reply to the latest of them, so media past it is what that request
 * did not carry: the result of the call it made, or the user's new message.
 * When nothing past it is media, the cause is older, which happens when the
 * conversation moved to a stricter model, or when the media past it was
 * already blamed and left out; then every media part is blamed.
 */
export async function refusalCandidates(messages: ModelMessage[]) {
  const lastReply = messages.findLastIndex(
    (message) => message.role === "assistant",
  );
  const recent = await digestsIn(messages.slice(lastReply + 1));
  return recent.length > 0 ? recent : digestsIn(messages);
}

/** Leave out every media part whose bytes a provider refused before. */
export function dropRefusedMedia(
  messages: ModelMessage[],
  refused: ReadonlySet<string>,
) {
  if (refused.size === 0) {
    return Promise.resolve(messages);
  }
  return mapModelMessageParts(messages, {
    media: ({ bytes, mediaType }) =>
      bytes !== undefined && refused.has(mediaDigest(bytes))
        ? {
            note: `[${mediaType ?? "Media"} omitted: the model's provider refused it, so it was left out of this conversation. Tell the user it could not be sent.]`,
            state: "dropped",
          }
        : { state: "unchanged" },
  });
}

async function digestsIn(messages: ModelMessage[]) {
  const digests = new Set<string>();
  await mapModelMessageParts(messages, {
    media: ({ bytes }) => {
      if (bytes !== undefined) {
        digests.add(mediaDigest(bytes));
      }
      return { state: "unchanged" };
    },
  });
  return [...digests];
}
