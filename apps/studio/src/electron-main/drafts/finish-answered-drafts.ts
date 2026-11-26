import { type Draft, type DraftOp, type DraftsSnapshot } from "@/shared/drafts";
import {
  type ChatId,
  type DraftMessage,
  type StoreId,
} from "@instrument-org/workspace/electron";

import { logger } from "../lib/electron-logger";

/** A session's turn that ended, as the workspace says so (`session.done`). */
export interface TurnEnd {
  id: ChatId;
  /** Whose stop ended it, where one did; `takesBack` when it asked to take a message back. */
  notice?: { takesBack?: true };
  sessionId: StoreId.Session;
}

/**
 * What the end of a turn in a chat does to the drafts sent into it and not
 * yet finished (`sent`), by the rule `lib/drafts/send.ts` gives a launch:
 *
 * - Its message is in the session whose turn ended: the turn it started is
 *   over, so the draft is finished. Not while that turn's Stop asked to take
 *   back a message nothing answered and this is that message: the take-back
 *   decides it once the turn has wound down, and the window it answers
 *   gives the draft back.
 * - Its message is in another session: that turn is not this one, so the
 *   draft waits for its own.
 * - Its message is not in the chat at all, taken back or the chat gone: the
 *   draft is the person's again.
 */
export function settleAfterTurn(
  drafts: readonly Draft[],
  ended: TurnEnd,
  messages: ReadonlyMap<string, DraftMessage>,
): DraftOp[] {
  return drafts.flatMap((draft): DraftOp[] => {
    if (draft.send?.stage !== "sent" || draft.send.chatId !== ended.id) {
      return [];
    }
    const message = messages.get(draft.id);
    if (message === undefined) {
      return [{ id: draft.id, type: "release" }];
    }
    if (
      message.sessionId !== ended.sessionId ||
      (message.isUnanswered && ended.notice?.takesBack === true)
    ) {
      return [];
    }
    return [{ id: draft.id, type: "finish" }];
  });
}

/**
 * Settles the drafts sent into a chat each time one of its turns ends
 * ({@link settleAfterTurn}), whichever window or device sent them. Runs in
 * main, the drafts' one writer, until the answer is called.
 */
export function startFinishingAnsweredDrafts({
  apply,
  messagesIn,
  turnEnds,
  watch,
}: {
  /** Changes the drafts, as a window's ops would. */
  apply: (ops: DraftOp[]) => void;
  /** The messages in a chat that name the draft they came from, by draft id. */
  messagesIn: (chatId: ChatId) => Promise<Map<string, DraftMessage>>;
  /** Each turn that ends, until `signal` aborts. */
  turnEnds: (signal: AbortSignal) => AsyncIterable<TurnEnd>;
  /** Hears the drafts as they are and at each change; answers the stop. */
  watch: (listener: (snapshot: DraftsSnapshot) => void) => () => void;
}): () => void {
  const log = logger.scope("finishAnsweredDrafts");
  const stop = new AbortController();
  let drafts: readonly Draft[] = [];
  const unwatch = watch((snapshot) => {
    ({ drafts } = snapshot);
  });
  void (async () => {
    for await (const ended of turnEnds(stop.signal)) {
      if (
        !drafts.some(
          (draft) =>
            draft.send?.stage === "sent" && draft.send.chatId === ended.id,
        )
      ) {
        continue;
      }
      try {
        const ops = settleAfterTurn(drafts, ended, await messagesIn(ended.id));
        if (ops.length > 0) {
          apply(ops);
        }
      } catch (error) {
        log.warn(`Could not settle the drafts sent into ${ended.id}`, error);
      }
    }
  })().catch((error: unknown) => {
    if (!stop.signal.aborted) {
      log.error("Stopped hearing turns end", error);
    }
  });
  return () => {
    stop.abort();
    unwatch();
  };
}
