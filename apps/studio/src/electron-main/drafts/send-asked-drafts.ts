import { type ChatId } from "@instrument-org/workspace/electron";

import { type Draft, type DraftOp, type DraftsSnapshot } from "@/shared/drafts";

import { logger } from "../lib/electron-logger";

/**
 * How long after another device asks for a reply to be sent this computer
 * still sends it. A reply asked for longer ago than this, found by a launch
 * the next day say, is left in its chat's box for the person to send or not,
 * so nothing they wrote hours ago goes out unseen.
 */
export const ASK_FRESH_MS = 10 * 60 * 1000;

/** A reply to send: its chat, the draft it is, and its words. */
export interface AskedReply {
  chatId: ChatId;
  draftId: string;
  words: string;
}

/**
 * Sends each reply another device asked this one to send: a draft naming
 * its chat whose `send` is this device's id, which a phone's Send writes,
 * naming the computer that last worked in the chat, since a phone cannot run
 * the agent. It is sent as the chat's box sends one: claimed for the chat,
 * the message written naming the draft, then the draft marked sent, so a
 * send stopped partway is finished or offered again exactly as a window's
 * is (`lib/drafts/send.ts`).
 *
 * An ask older than `ASK_FRESH_MS`, or a send that fails, drops the ask and
 * leaves the reply waiting in the box like any other, so a reply is sent
 * by this computer at most once and never long after it was written.
 */
export function startSendingAskedDrafts({
  apply,
  deviceId,
  now = Date.now,
  send,
  watch,
}: {
  /** Changes the drafts, as a window's ops would. */
  apply: (ops: DraftOp[]) => void;
  deviceId: string;
  now?: () => number;
  /** Writes the reply's message into its chat, which starts the agent's turn. */
  send: (reply: AskedReply) => Promise<void>;
  /** Hears the drafts as they are and at each change; answers the stop. */
  watch: (listener: (snapshot: DraftsSnapshot) => void) => () => void;
}): () => void {
  const inFlight = new Set<string>();
  const log = logger.scope("sendAskedDrafts");

  const sendOne = async (draft: Draft, chatId: ChatId) => {
    // Out of the store's own telling of a change, which this answers.
    await Promise.resolve();
    apply([
      { at: now(), chatId, id: draft.id, type: "claim", words: draft.words },
    ]);
    try {
      await send({ chatId, draftId: draft.id, words: draft.words });
      apply([{ id: draft.id, type: "sent" }]);
    } catch (error) {
      log.warn(
        `Could not send the reply ${draft.id} asked of this computer`,
        error,
      );
      apply([
        { id: draft.id, type: "release" },
        { id: draft.id, set: {}, type: "update", unset: ["sendOn"] },
      ]);
    }
  };

  const dropAsk = async (draft: Draft) => {
    await Promise.resolve();
    apply([{ id: draft.id, set: {}, type: "update", unset: ["sendOn"] }]);
  };

  return watch(({ drafts }) => {
    for (const draft of drafts) {
      const chatId = draft.chatId;
      if (
        draft.sendOn !== deviceId ||
        draft.sendingTo !== undefined ||
        chatId === undefined ||
        inFlight.has(draft.id)
      ) {
        continue;
      }
      inFlight.add(draft.id);
      const fresh = now() - draft.updatedAt <= ASK_FRESH_MS;
      const empty = draft.words.trim() === "" && !draft.inFolder?.length;
      void (fresh && !empty ? sendOne(draft, chatId) : dropAsk(draft)).finally(
        () => {
          inFlight.delete(draft.id);
        },
      );
    }
  });
}
