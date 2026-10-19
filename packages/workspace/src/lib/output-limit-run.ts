import { type SessionMessage } from "../schemas/session/message";

/**
 * How many replies in a row a turn may end by running out of room before the
 * turn stops there.
 *
 * One continuation, so a reply that needed a little more room gets it, and a
 * model answering at length regardless of being told twice to write less does
 * not spend the turn's whole step budget 32,000 tokens at a time. Two cuts in
 * a row means the advice is not landing, which is a thing to hand back to the
 * person rather than keep paying for.
 */
export const MAX_OUTPUT_LIMIT_REPLIES = 2;

/**
 * How many of the turn's latest replies in a row the model ended by running
 * out of room, counting back to the message the user sent.
 *
 * A step that errored does not break the run, because its retry is still the
 * same reply being written; a synthetic message does not either, because
 * nothing wrote it.
 */
export function outputLimitRun(messages: SessionMessage.WithParts[]): number {
  let run = 0;
  for (const message of [...messages].reverse()) {
    if (message.role === "user") {
      break;
    }
    if (message.role !== "assistant") {
      continue;
    }
    if (message.metadata.error !== undefined || message.metadata.synthetic) {
      continue;
    }
    if (message.metadata.finishReason !== "length") {
      break;
    }
    run += 1;
  }
  return run;
}
