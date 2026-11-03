import { isFreshAsk } from "@instrument-org/shared";
import { type ChatId } from "@instrument-org/workspace/electron";

import { type Draft, type DraftOp, type DraftsSnapshot } from "@/shared/drafts";

import { logger } from "../lib/electron-logger";

/**
 * A draft to send: its chat, the draft it is, its words, and for a draft
 * that opens a chat of its own, the project the new chat is filed under.
 */
export interface AskedReply {
  chatId: ChatId;
  draftId: string;
  projectId?: string;
  words: string;
}

/**
 * Sends each draft another device asked this one to send: one whose `send`
 * is this device's id, which a phone's Send writes, since a phone cannot run
 * the agent. A reply names the computer that last worked in its chat; a
 * draft that opens a chat of its own names the computer that last wrote the
 * chat list. It is sent as a window sends one: a new chat made first
 * (`startChat`), then the draft claimed for its chat, the message written
 * naming the draft, and the draft marked sent, so a send stopped partway is
 * finished or offered again exactly as a window's is (`lib/drafts/send.ts`).
 *
 * An ask that is not fresh (`isFreshAsk`, a reply asked for longer ago
 * than `ASK_FRESH_MS`, which is left in its chat's box for the person to
 * send or not), or a send that fails, drops the ask and
 * leaves the reply waiting in the box like any other, so a reply is sent
 * by this computer at most once and never long after it was written.
 */
export function startSendingAskedDrafts({
  apply,
  deviceId,
  now = Date.now,
  send,
  startChat,
  watch,
}: {
  /** Changes the drafts, as a window's ops would. */
  apply: (ops: DraftOp[]) => void;
  deviceId: string;
  now?: () => number;
  /** Writes the draft's message into its chat, which starts the agent's turn. */
  send: (reply: AskedReply) => Promise<void>;
  /** Makes the chat a draft of its own opens, from its first words. */
  startChat: (words: string) => Promise<ChatId>;
  /** Hears the drafts as they are and at each change; answers the stop. */
  watch: (listener: (snapshot: DraftsSnapshot) => void) => () => void;
}): () => void {
  const inFlight = new Set<string>();
  const log = logger.scope("sendAskedDrafts");

  const sendOne = async (draft: Draft) => {
    // Out of the store's own telling of a change, which this answers.
    await Promise.resolve();
    let chatId: ChatId;
    try {
      chatId = draft.chatId ?? (await startChat(draft.words));
    } catch (error) {
      log.warn(`Could not start the chat ${draft.id} asked for`, error);
      apply([{ id: draft.id, set: {}, type: "update", unset: ["sendOn"] }]);
      return;
    }
    apply([
      { at: now(), chatId, id: draft.id, type: "claim", words: draft.words },
    ]);
    try {
      await send({
        chatId,
        draftId: draft.id,
        ...(draft.chatId === undefined && draft.projectId
          ? { projectId: draft.projectId }
          : {}),
        words: draft.words,
      });
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
      if (
        draft.sendOn !== deviceId ||
        draft.sendingTo !== undefined ||
        inFlight.has(draft.id)
      ) {
        continue;
      }
      inFlight.add(draft.id);
      const fresh = isFreshAsk(draft.updatedAt, now());
      const empty = draft.words.trim() === "" && !draft.inFolder?.length;
      void (fresh && !empty ? sendOne(draft) : dropAsk(draft)).finally(() => {
        inFlight.delete(draft.id);
      });
    }
  });
}
