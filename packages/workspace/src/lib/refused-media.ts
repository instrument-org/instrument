import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { APICallError, type ModelMessage } from "ai";
import { alphabetical } from "radashi";

import crypto from "node:crypto";

import { type SessionMessage } from "../schemas/session/message";
import {
  classifyProviderError,
  refusesOneFile,
} from "./classify-provider-error";
import { mapModelMessageParts } from "./model-message-parts";

/**
 * Media a provider refused, kept out of later requests.
 *
 * Every check before a request reads headers and end markers, so bytes that
 * pass all of them can still be refused: a PNG whose pixel data no inflater
 * accepts measures fine and ends with its `IEND`. The refused part is already
 * in the records, and every request after replays it, so without this one
 * such part ends the conversation.
 *
 * A refusal blames the media its request newly carried, by the digest of the
 * bytes that went out, recorded on the reply that was refused
 * (`refusedMedia`). The blame is a guess until a request without that media
 * is accepted: the request right after the refused reply leaves the media
 * out, and the blame stands from then on only if that request's reply
 * finished without an error (`standingRefusals`). So a wrong guess costs one
 * request, and a right one keeps the media out of every later request, with
 * no probe.
 */
export function mediaDigest(bytes: Buffer) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/**
 * The digests every request leaves out, read from the stored history.
 *
 * A refused reply's blame applies to the request right after it, which has no
 * assistant message after the refused one yet. Once there is one, the blame
 * stands only if that message, the reply to the request sent without the
 * media, finished without an error.
 */
export function standingRefusals(
  messages: readonly SessionMessage.WithParts[],
) {
  const replies = alphabetical(
    messages.filter((message) => message.role === "assistant"),
    (message) => message.id,
  );
  const standing = new Set<string>();
  replies.forEach((reply, index) => {
    const refused = reply.metadata.refusedMedia ?? [];
    const next = replies[index + 1];
    if (next === undefined || isAccepted(next)) {
      for (const digest of refused) {
        standing.add(digest);
      }
    }
  });
  return standing;
}

/**
 * Whether a failed request's error is worth blaming on the media it newly
 * carried.
 *
 * A refusal naming one file the provider could not take is. So is a 400 the
 * classifier cannot name, when the model is the one whose reply last
 * accepted this conversation: its wording is one we have not matched, and
 * what changed since is what the request newly carried. A wrong guess is
 * one extra request, since the blame needs the next request accepted to
 * stand. A limit on the request's media as a whole names no one file, and a
 * 400 right after a model switch may be the older history the new model
 * refuses, so neither is.
 */
export function suspectsRefusedMedia({
  error,
  history,
  model,
}: {
  error: unknown;
  history: readonly SessionMessage.WithParts[];
  model: AIGatewayModel.Type;
}) {
  if (refusesOneFile(error)) {
    return true;
  }
  if (
    !APICallError.isInstance(error) ||
    error.statusCode !== 400 ||
    classifyProviderError(error).kind !== "unknown"
  ) {
    return false;
  }
  const accepted = alphabetical(
    history.filter(isAccepted),
    (message) => message.id,
  ).at(-1);
  if (accepted?.role !== "assistant") {
    return false;
  }
  const asked = accepted.metadata.aiGatewayModel;
  return asked === undefined
    ? accepted.metadata.modelId === model.canonicalId
    : asked.canonicalId === model.canonicalId &&
        asked.params.provider === model.params.provider;
}

/**
 * The media a refused request newly carried: past its last assistant message,
 * which is the reply to the latest request accepted, so the result of the
 * call that reply made or the user's new message. Media left out with a note
 * is no longer media, so a retry refused again names nothing.
 */
export function refusalCandidates(messages: ModelMessage[]) {
  const lastReply = messages.findLastIndex(
    (message) => message.role === "assistant",
  );
  return digestsIn(messages.slice(lastReply + 1));
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

/** A reply the model finished, to a request the provider accepted. */
function isAccepted(message: SessionMessage.WithParts) {
  return (
    message.role === "assistant" &&
    message.metadata.error === undefined &&
    message.metadata.finishedAt !== undefined
  );
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
