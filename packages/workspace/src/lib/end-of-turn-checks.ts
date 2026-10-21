import { type ChatId } from "../schemas/chat-id";
import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { brokenLinksIn } from "./broken-links";
import { sessionRole } from "./chat/children";
import { isToolPart } from "./is-tool-part";
import { systemNote } from "./system-note";

interface FinishedTurn {
  chatId: ChatId;
  /** Everything the agent wrote this turn. */
  reply: string;
  role: "chat" | "task";
}

/**
 * What a reply that ends a turn is checked for, each answering the lines of
 * a note asking for the correction, or undefined when there is nothing to
 * correct. Only what can be told for certain from the computer belongs here.
 */
const END_OF_TURN_CHECKS: ((
  turn: FinishedTurn,
) => Promise<string | undefined>)[] = [linksThatOpenNothing];

async function linksThatOpenNothing({
  chatId,
  reply,
  role,
}: FinishedTurn): Promise<string | undefined> {
  const broken = await brokenLinksIn({ chatId, text: reply });
  if (broken.length === 0) {
    return undefined;
  }
  const listed = broken
    .map(({ link, reason }) => `- \`${link}\`: ${reason}`)
    .join("\n");
  const ask =
    role === "task"
      ? "Find where each really is, then write your reply again whole with links that open, since it is what the chat receives. Say plainly of anything that was not made that it was not."
      : "Find where each really is, then send one short follow-up with links that open (a files fence with full paths for files). Say plainly of anything that was not made that it was not. The user already has the rest of your reply, so say only that.";
  return `These links in your reply open nothing:\n${listed}\n${ask}`;
}

/**
 * The note for the one step a turn gets after its reply, when that reply
 * fails an end-of-turn check, or undefined. Read from the stored transcript:
 * the turn's latest step finished with no tool call, and no step of the turn
 * before it did, since a step after a finished reply is the correction
 * already given. So a turn is corrected once at most and can never loop.
 */
export async function endOfTurnNote({
  chatId,
  messages,
  sessionId,
}: {
  chatId: ChatId;
  messages: SessionMessage.WithParts[];
  sessionId: StoreId.Session;
}): Promise<string | undefined> {
  const start = messages.findLastIndex((message) => message.role === "user");
  const steps = messages
    .slice(start + 1)
    .filter(
      (message) =>
        message.role === "assistant" &&
        message.metadata.error === undefined &&
        !message.metadata.synthetic,
    );
  const last = steps.at(-1);
  if (
    last === undefined ||
    !finishedReply(last) ||
    steps.slice(0, -1).some(finishedReply)
  ) {
    return undefined;
  }
  const role = sessionRole(chatId, sessionId);
  if (role === undefined) {
    return undefined;
  }
  const reply = steps
    .flatMap((step) =>
      step.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])),
    )
    .join("\n\n");
  const found = (
    await Promise.all(
      END_OF_TURN_CHECKS.map((check) => check({ chatId, reply, role })),
    )
  ).filter((note) => note !== undefined);
  return found.length === 0 ? undefined : systemNote`${found.join("\n\n")}`;
}

/** A step that ended the turn: it wrote, called nothing, and was not cut off. */
function finishedReply(step: SessionMessage.WithParts): boolean {
  return (
    step.role === "assistant" &&
    step.metadata.finishReason !== "length" &&
    !step.parts.some((part) => isToolPart(part)) &&
    step.parts.some((part) => part.type === "text" && part.text.trim() !== "")
  );
}
