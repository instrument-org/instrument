import { sleep } from "radashi";

import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { type StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
import { isToolPart } from "../is-tool-part";
import { resolveWorkspaceFilePaths } from "../resolve-workspace-file-path";
import { isTypedByUser } from "../typed-by-user";
import { isWorking } from "./activity";
import { joinedMidTurn } from "./mid-turn";

/** How long a take-back waits for the turn its Stop ended to wind down. */
const WIND_DOWN_MS = 15_000;

/**
 * A message the person's Stop took back, as the reply box is given it again:
 * its words, the files and folders sent with it by their paths on this
 * computer, the pages, chats and screens named on it, and the places marked
 * in files.
 */
export interface TakenBack {
  asks?: SessionMessageDataPart.AsksDataPart;
  chips: SessionMessageDataPart.SentChip[];
  files: { mediaType: string; name: string; path: string; size: number }[];
  folders: { path: string }[];
  words: string;
}

/**
 * The message a Stop pressed now would take back, with what goes with it: the
 * person's newest message in the session, when the model has not answered it.
 *
 * Answered is any words or any tool call in a reply since the last message
 * the person typed; reasoning alone is not, since nothing of it stays on
 * screen. It is the only message the person typed since the last answer, so
 * taking it back leaves no other request unanswered, and it started its turn
 * rather than joining one already at work, whose Stop ends more than this
 * message. A note the app wrote (a task finishing, a sign-in) is no answer
 * and stays where it is, and so does what the app told the agent as the
 * chat began.
 */
export function unansweredMessage(
  history: readonly SessionMessage.WithParts[],
  sessionId: StoreId.Session,
):
  | undefined
  | { message: SessionMessage.UserWithParts; takesOut: StoreId.Message[] } {
  const own = history.filter(
    (message) => message.metadata.sessionId === sessionId,
  );
  const answeredAt = own.findLastIndex(
    (message) =>
      message.role === "assistant" &&
      message.parts.some(
        (part) =>
          isToolPart(part) || (part.type === "text" && part.text.trim() !== ""),
      ),
  );
  const since = own.slice(answeredAt + 1);
  const typed = since.filter(
    (message): message is SessionMessage.UserWithParts =>
      message.role === "user" && isTypedByUser(message),
  );
  const [message] = typed;
  if (message === undefined || typed.length > 1 || joinedMidTurn(message)) {
    return undefined;
  }
  const from = since.indexOf(message);
  return {
    message,
    takesOut: since
      .slice(from)
      .filter((each) => each === message || each.role === "assistant")
      .map(({ id }) => id),
  };
}

/**
 * Takes back the chat's message its Stop reached before the model answered
 * it: once the stopped turn has wound down, the message and the empty reply
 * under it go from the session, as a retraction every device reads, and what
 * it was sent with comes back for the reply box. Nothing when the model had
 * answered it, or the turn is still stopping after a while.
 */
export async function takeBackUnanswered({
  chatId,
  sessionId,
}: {
  chatId: ChatId;
  sessionId: StoreId.Session;
}): Promise<TakenBack | undefined> {
  const until = Date.now() + WIND_DOWN_MS;
  while (isWorking(chatId, sessionId)) {
    if (Date.now() > until) {
      return undefined;
    }
    await sleep(50);
  }
  const history = await ChatReads.history({ chatId, sessionId });
  if (history.isErr()) {
    return undefined;
  }
  const found = unansweredMessage(history.value, sessionId);
  if (found === undefined) {
    return undefined;
  }
  const taken = await takenBackOf(chatId, found.message);
  const retracted = await ChatWrites.retract(chatId, sessionId, found.takesOut);
  return retracted.isOk() ? taken : undefined;
}

async function takenBackOf(
  chatId: ChatId,
  message: SessionMessage.UserWithParts,
): Promise<TakenBack> {
  let words = "";
  let attachments: SessionMessageDataPart.FileAttachmentsDataPart | undefined;
  let chips: SessionMessageDataPart.SentChip[] = [];
  let asks: SessionMessageDataPart.AsksDataPart | undefined;
  for (const part of message.parts) {
    switch (part.type) {
      case "text": {
        words = part.text;
        break;
      }
      case "data-attachments": {
        attachments = part.data;
        break;
      }
      case "data-viewContext": {
        chips = part.data.attached ?? [];
        break;
      }
      case "data-asks": {
        asks = part.data;
        break;
      }
      default:
    }
  }
  const sent = attachments?.files ?? [];
  const here = await resolveWorkspaceFilePaths({
    chatId,
    filePaths: sent.map(({ filePath }) => filePath),
  });
  return {
    ...(asks ? { asks } : {}),
    // Files and folders come back from the attachments, which say more of
    // them than a chip does.
    chips: chips.filter((chip) => chip.kind !== "paths"),
    // A file this computer cannot reach is not given back.
    files: sent.flatMap((file) => {
      const path = here.get(file.filePath);
      return path
        ? [
            {
              mediaType: file.mimeType,
              name: file.filename,
              path,
              size: file.size,
            },
          ]
        : [];
    }),
    folders: attachments?.folders ?? [],
    words,
  };
}
