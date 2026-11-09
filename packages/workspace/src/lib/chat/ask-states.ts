import { isFreshAsk } from "@instrument-org/shared";

import {
  type AnswerRef,
  type AskAnswer,
  type AskRecord,
  type AskRecordAsker,
  type Taken,
} from "../../schemas/ask";
import { type SessionMessage } from "../../schemas/session/message";
import { type Stopper } from "../../schemas/stop-notice";
import { type StoreId } from "../../schemas/store-id";
import { isTypedByUser } from "../typed-by-user";

/**
 * Where each of a chat's asks stands, read from its records alone: the one
 * fold every reader uses, the card, the chat list, `stoppable` and the
 * driver on the ask's computer alike.
 */

export interface AskState {
  /** The ask as its computer last wrote it. */
  ask: AskRecord;
  /** The askers no Stop, from any device, took off it. */
  askers: AskRecordAsker[];
  /**
   * The newest answer given that is no longer fresh (`isFreshAsk`) and was
   * never taken, while nothing is pending: one given while the ask's
   * computer was away, which it never acts on when it comes back, so the
   * card asks again and says so.
   */
  away?: Taken;
  /**
   * Whether it still waits on the person: not closed, with someone left on
   * it, and (a question or a sign-in) not moved past by what the person
   * wrote or a Stop of theirs since it was asked, and (a question) not
   * asked again past by a later turn.
   */
  live: boolean;
  /**
   * The answer its computer takes next: the first fresh one in log order
   * that is not spent, while it is open. A permission's yes being carried
   * out or waiting on the system is still closed by a later fresh no given
   * on its own computer, where the system's prompt is.
   */
  pending?: Taken;
}

/**
 * How far the person moved past what the chat asked: the last message they
 * wrote, which is their answer to whatever was asked before it, by its id
 * (messages are ordered by id), and when they last stopped the chat.
 */
export interface MovedPast {
  stoppedAt?: Date;
  typed?: StoreId.Message;
}

/** How far the person moved past what the chat asked, from its own session (`MovedPast`). */
export function movedPastOf(
  messages: readonly SessionMessage.WithParts[],
  stopped: { at: Date; by: Stopper } | undefined,
): MovedPast {
  const typed = messages.findLast(
    (message) => message.role === "user" && isTypedByUser(message),
  )?.id;
  return {
    ...(stopped?.by === "person" && { stoppedAt: stopped.at }),
    ...(typed && { typed }),
  };
}

/** Whether the person moved past an open question or sign-in: wrote after its call, or stopped since. */
function isMovedPast(ask: AskRecord, moved: MovedPast | undefined): boolean {
  if (ask.kind === "permission" || ask.stage.is !== "open" || !moved) {
    return false;
  }
  return (
    (moved.typed !== undefined &&
      moved.typed >
        (ask.kind === "sign-in"
          ? (ask.since ?? ask.messageId)
          : ask.messageId)) ||
    (moved.stoppedAt !== undefined &&
      moved.stoppedAt.getTime() >= ask.askedAt.getTime())
  );
}

/**
 * Whether a later turn asked again past a question: a question of another
 * set (or one an earlier build asked, which has none) was asked in a later
 * message, whichever computer asked it. Only the newest set waits on the
 * person.
 */
function isAskedAgain(ask: AskRecord, asks: readonly AskRecord[]): boolean {
  return (
    ask.kind === "question" &&
    asks.some(
      (other) =>
        other.kind === "question" &&
        other.messageId > ask.messageId &&
        (other.set === undefined || other.set !== ask.set),
    )
  );
}

/**
 * Each ask's state, oldest first, from a session's `ask` records (the
 * newest of each id) and its `answer` records in log order. `movedPast`
 * says how far the person wrote or stopped past what the chat asked; `now`
 * is this computer's clock, which an answer's freshness is read against.
 */
export function askStates({
  answers,
  asks,
  movedPast,
  now,
}: {
  answers: readonly AskAnswer[];
  asks: readonly AskRecord[];
  movedPast?: MovedPast;
  now: number;
}): AskState[] {
  return asks
    .map((ask) => {
      const toAsk = answers.filter((answer) => answer.ask === ask.id);
      const askers = ask.askers.filter(
        (asker) =>
          !toAsk.some(
            ({ given }) =>
              given.kind === "stopped" &&
              given.askers.some(
                (entry) =>
                  entry.sessionId === asker.sessionId &&
                  entry.at.getTime() === asker.at.getTime(),
              ),
          ),
      );
      const live =
        ask.stage.is !== "closed" &&
        askers.length > 0 &&
        !isMovedPast(ask, movedPast) &&
        !isAskedAgain(ask, asks);
      const unused = live ? unusedAnswers(ask, toAsk) : [];
      const pending = unused.find((answer) => isFreshAsk(answer.at, now));
      const away =
        pending === undefined && ask.stage.is === "open"
          ? unused.findLast((answer) => !isFreshAsk(answer.at, now))
          : undefined;
      return {
        ask,
        askers,
        live,
        ...(pending && { pending }),
        ...(away && { away }),
      };
    })
    .toSorted((a, b) => a.ask.askedAt.getTime() - b.ask.askedAt.getTime());
}

/**
 * The answers an ask's computer could still take, in log order: of the
 * ask's kind, not spent nor already taken, while it is open; while a
 * permission's yes is under way, only a no.
 */
function unusedAnswers(ask: AskRecord, answers: readonly AskAnswer[]): Taken[] {
  const { stage } = ask;
  const used: AnswerRef[] = [
    ...(ask.spent ?? []),
    ...(stage.is === "taken" ? [stage.answer] : []),
    ...(stage.is === "waiting" && stage.answer ? [stage.answer] : []),
  ];
  const yesUnderWay =
    (stage.is === "taken" &&
      stage.answer.kind === "permission" &&
      stage.answer.decision !== "declined") ||
    stage.is === "waiting";
  if (stage.is !== "open" && !yesUnderWay) {
    return [];
  }
  return answers.flatMap(({ at, device, given }) =>
    given.kind === "stopped" ||
    given.kind !== ask.kind ||
    used.some(
      (ref) => ref.device === device && ref.at.getTime() === at.getTime(),
    ) ||
    (yesUnderWay &&
      !(
        given.kind === "permission" &&
        given.decision === "declined" &&
        device === ask.device
      ))
      ? []
      : [{ at, device, ...given }],
  );
}
