import { isFreshAsk, SEND_FRESH_MS } from "@instrument-org/shared";
import { type ChatId } from "@instrument-org/workspace/electron";

import { type Draft, type DraftOp, type DraftsSnapshot } from "@/shared/drafts";

import { type AskedDraftCarries } from "./asked-draft-carries";
import { logger } from "../lib/electron-logger";

/**
 * A draft to send, with what it carries besides its folder: its chat, the draft it is, its words, and for a draft
 * that opens a chat of its own, the project the new chat is filed under.
 */
export interface AskedReply extends AskedDraftCarries {
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
 * A draft with a part this computer can't send for the person (`carries`)
 * is not sent in part: its ask is dropped, and it waits for them whole.
 *
 * A new chat sent this way is shown on this computer (`showChat`) once its
 * message is written, so the person finds it here when they come back.
 *
 * An ask that is not fresh (`isFreshAsk`, a reply asked for longer ago
 * than `SEND_FRESH_MS`, which is left in its chat's box for the person to
 * send or not), or a send that fails, drops the ask and
 * leaves the reply waiting in the box like any other, so a reply is sent
 * by this computer at most once and never long after it was written.
 */
export function startSendingAskedDrafts({
  apply,
  carries,
  deviceId,
  now = Date.now,
  send,
  showChat,
  startChat,
  watch,
}: {
  /** Changes the drafts, as a window's ops would. */
  apply: (ops: DraftOp[]) => void;
  /** What the draft's message carries besides its words and folder; nothing where some of it can't go from here. */
  carries: (draft: Draft) => Promise<AskedDraftCarries | undefined>;
  deviceId: string;
  now?: () => number;
  /** Writes the draft's message into its chat, which starts the agent's turn. */
  send: (reply: AskedReply) => Promise<void>;
  /** Puts a chat a draft opened where the person will find it, taking nothing they are on away. */
  showChat: (chatId: ChatId) => void;
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
    let carried: AskedDraftCarries | undefined;
    try {
      carried = await carries(draft);
    } catch (error) {
      log.warn(`Could not read what ${draft.id} carries`, error);
    }
    if (carried === undefined) {
      log.warn(`Left ${draft.id}, with something only the person can send`);
      apply([{ id: draft.id, set: {}, type: "update", unset: ["sendOn"] }]);
      return;
    }
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
        ...carried,
        chatId,
        draftId: draft.id,
        ...(draft.chatId === undefined && draft.projectId
          ? { projectId: draft.projectId }
          : {}),
        words: draft.words,
      });
    } catch (error) {
      log.warn(
        `Could not send the reply ${draft.id} asked of this computer`,
        error,
      );
      apply([
        { id: draft.id, type: "release" },
        { id: draft.id, set: {}, type: "update", unset: ["sendOn"] },
      ]);
      return;
    }
    if (draft.chatId === undefined) {
      try {
        showChat(chatId);
      } catch (error) {
        log.warn(`Could not show the chat ${draft.id} opened`, error);
      }
    }
    apply([{ id: draft.id, type: "sent" }]);
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
      const fresh = isFreshAsk(draft.updatedAt, now(), SEND_FRESH_MS);
      const empty =
        draft.words.trim() === "" &&
        !draft.inFolder?.length &&
        !draft.asks?.length;
      void (fresh && !empty ? sendOne(draft) : dropAsk(draft)).finally(() => {
        inFlight.delete(draft.id);
      });
    }
  });
}
