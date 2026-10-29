import { type ChatId } from "../../schemas/chat-id";
import { type Ask, type QuestionAsk } from "../../schemas/chat-state";
import { type SessionMessage } from "../../schemas/session/message";
import { type Stopper } from "../../schemas/stop-notice";
import { type StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { askLine, chooseQuestions } from "../choose-call";
import { sessionOfChat } from "../record-folders";
import { isTypedByUser } from "../typed-by-user";
import { openPermissionAsks, sortAsks } from "./asks";

/**
 * What a chat waits on the person for: its permission cards, this
 * computer's (`asks.ts`), and the questions its agent asked, read from its
 * records. Apart from `asks.ts` because the questions read the records,
 * which the permission rules that raise a card must not reach.
 */

/**
 * The questions the chat's agent asked with `choose` that are still open,
 * oldest first, read from its session's history: a call that put its
 * question on a card, with no answer written onto it, no message the person
 * wrote after it, which is their answer to whatever was asked, and no Stop
 * of theirs since. So every computer and viewer of the chat sees what it
 * waits on. A question's id is its call's part id.
 */
export function openQuestionsIn(
  messages: SessionMessage.WithParts[],
  stop: { at: Date; by: Stopper } | undefined,
): QuestionAsk[] {
  let open: QuestionAsk[] = [];
  for (const message of messages) {
    if (message.role === "user" && isTypedByUser(message)) {
      open = [];
      continue;
    }
    for (const part of message.parts) {
      if (
        part.type === "tool-choose" &&
        part.state === "output-available" &&
        "asked" in part.output &&
        part.output.answer === undefined
      ) {
        const questions = chooseQuestions(part.input).map(
          ({ question }) => question,
        );
        open.push({
          askedAt: part.metadata.createdAt,
          askers: [
            { partId: part.metadata.id, sessionId: part.metadata.sessionId },
          ],
          id: part.metadata.id,
          kind: "question",
          messageId: part.metadata.messageId,
          question: askLine(questions.map((question) => ({ question }))),
          questions,
        });
      }
    }
  }
  return stop?.by === "person"
    ? open.filter((question) => question.askedAt > stop.at)
    : open;
}

/** The chat's open questions, oldest first (`openQuestionsIn`). */
export async function openQuestions(chatId: ChatId): Promise<QuestionAsk[]> {
  const sessionId = sessionOfChat(chatId);
  if (sessionId === undefined) {
    return [];
  }
  const [history, stop] = await Promise.all([
    ChatReads.history({ chatId, sessionId }),
    ChatReads.stopped({ chatId, sessionId }),
  ]);
  return history.isOk() && stop.isOk()
    ? openQuestionsIn(history.value, stop.value)
    : [];
}

/** The questions being answered this moment, by chat and id, so one answer lands once. */
const answering = new Set<string>();

/**
 * Takes the person's answer to an open question, answering what it was:
 * `write` puts the answer on the call, which is what closes it. Nothing for
 * a question already answered, or being answered this moment.
 */
export async function answerQuestion(
  chatId: ChatId,
  askId: string,
  write: (question: QuestionAsk) => Promise<void>,
): Promise<QuestionAsk | undefined> {
  const key = `${chatId}/${askId}`;
  if (answering.has(key)) {
    return undefined;
  }
  answering.add(key);
  try {
    const question = (await openQuestions(chatId)).find(
      (open) => open.id === askId,
    );
    if (question) {
      await write(question);
    }
    return question;
  } finally {
    answering.delete(key);
  }
}

/** The chat's open asks, its cards and its questions, oldest first. */
export async function openAsks(chatId: ChatId): Promise<Ask[]> {
  const [cards, questions] = await Promise.all([
    openPermissionAsks(chatId),
    openQuestions(chatId),
  ]);
  return sortAsks([...cards, ...questions]);
}

/** The chat's open asks a session is on, waiting to be woken with the answer, oldest first. */
export async function openAsksOf(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<Ask[]> {
  return (await openAsks(chatId)).filter((ask) =>
    ask.askers.some((asker) => asker.sessionId === sessionId),
  );
}
