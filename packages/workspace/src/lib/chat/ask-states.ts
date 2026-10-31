import { isFreshAsk } from "@instrument-org/shared";

import {
  type AnswerRef,
  type AskAnswer,
  type AskRecord,
  type AskRecordAsker,
  type Taken,
} from "../../schemas/ask";

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
   * wrote or a Stop of theirs since it was asked.
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
 * Each ask's state, oldest first, from a session's `ask` records (the
 * newest of each id) and its `answer` records in log order. `movedPastAt`
 * is the newest moment the person wrote in the chat or stopped it; `now`
 * is this computer's clock, which an answer's freshness is read against.
 */
export function askStates({
  answers,
  asks,
  movedPastAt,
  now,
}: {
  answers: readonly AskAnswer[];
  asks: readonly AskRecord[];
  movedPastAt?: Date;
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
      const movedPast =
        ask.kind !== "permission" &&
        ask.stage.is === "open" &&
        movedPastAt !== undefined &&
        ask.askedAt.getTime() <= movedPastAt.getTime();
      const live = ask.stage.is !== "closed" && askers.length > 0 && !movedPast;
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
