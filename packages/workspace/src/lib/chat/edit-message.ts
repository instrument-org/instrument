import { sleep } from "radashi";

import { type WorkspaceActorRef } from "../../machines/workspace";
import {
  editedMessageNote,
  type EditedAwayTask,
} from "../../model-text/notes/edited-message-model-text";
import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { TypedError } from "../errors";
import { isTypedByUser } from "../typed-by-user";
import { isWorking } from "./activity";
import { closeAsksOf } from "./asks";
import { listChildTasks } from "./children";

/** How long an edit waits for the turns it stopped to wind down. */
const WIND_DOWN_MS = 15_000;

/** A message being edited, and what its new version takes out. */
export interface MessageEdit {
  edited: SessionMessage.UserWithParts;
  /** The edited message and all that followed it, oldest first. */
  takesOut: StoreId.Message[];
  /** The tasks started after it, oldest first, as they were before the edit. */
  tasks: EditedAwayTask[];
}

/**
 * Readies a chat for one of its messages to be edited: stops the work the
 * edit takes out (the chat's own turn, and the tasks started after the
 * message, none of which write a note about it), closes what that work was
 * asking, and once it has wound down says which messages go. The processes
 * it left running keep running, and files stay as they are.
 */
export async function beginEdit({
  chatId,
  messageId,
  sessionId,
  workspaceRef,
}: {
  chatId: ChatId;
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  workspaceRef: WorkspaceActorRef;
}): Promise<MessageEdit> {
  // Before anything is stopped, so an edit that can't be made costs nothing.
  await editedIn(chatId, sessionId, messageId);

  const tasks = (await listChildTasks(chatId))
    .filter((task) => ulidOf(task.id) > ulidOf(messageId))
    .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const told = tasks.map(({ handle, id, title }) => ({
    handle,
    title,
    wasRunning: isWorking(chatId, id),
  }));
  const stopped = [sessionId, ...tasks.map((task) => task.id)];
  for (const each of stopped) {
    workspaceRef.send({
      type: "stopSessions",
      value: {
        id: chatId,
        notice: { by: "person", wakesChat: false },
        sessionId: each,
      },
    });
  }
  await Promise.all(stopped.map((each) => closeAsksOf(chatId, each)));
  const until = Date.now() + WIND_DOWN_MS;
  while (stopped.some((each) => isWorking(chatId, each))) {
    if (Date.now() > until) {
      throw new TypedError.Conflict("The chat is still stopping.");
    }
    await sleep(50);
  }
  return { ...(await editedIn(chatId, sessionId, messageId)), tasks: told };
}

/** The new version of an edited message: what it was sent with that the box doesn't hold, its earlier versions, and the note for the agent. */
export function asNewVersion(
  message: SessionMessage.UserWithParts,
  { edited, tasks }: Pick<MessageEdit, "edited" | "tasks">,
): SessionMessage.UserWithParts {
  const has = new Set(message.parts.map(({ type }) => type));
  const { createdAt, sessionId } = message.metadata;
  const metadata = () => ({
    createdAt,
    id: StoreId.newPartId(),
    messageId: message.id,
    sessionId,
  });
  const carried = edited.parts.flatMap((part): SessionMessagePart.Type[] =>
    (part.type === "data-viewContext" || part.type === "data-asks") &&
    !has.has(part.type)
      ? [{ ...part, metadata: metadata() }]
      : [],
  );
  return {
    ...message,
    metadata: {
      ...message.metadata,
      earlierVersions: [...(edited.metadata.earlierVersions ?? []), edited.id],
    },
    parts: [
      ...message.parts,
      ...carried,
      {
        data: { text: editedMessageNote(tasks) },
        metadata: metadata(),
        type: "data-intent",
      },
    ],
  };
}

async function editedIn(
  chatId: ChatId,
  sessionId: StoreId.Session,
  messageId: StoreId.Message,
): Promise<Omit<MessageEdit, "tasks">> {
  const history = await ChatReads.history({ chatId, sessionId });
  if (history.isErr()) {
    throw history.error;
  }
  const at = history.value.findIndex(({ id }) => id === messageId);
  const edited = history.value[at];
  if (
    edited?.role !== "user" ||
    edited.metadata.sessionId !== sessionId ||
    !isTypedByUser(edited)
  ) {
    throw new TypedError.NotFound(
      `${chatId} has no message ${messageId} to edit.`,
    );
  }
  return {
    edited,
    takesOut: history.value
      .slice(at)
      // What the app told the agent as the chat began stands, wherever in
      // the conversation it was last written.
      .filter(({ role }) => role !== "session-context")
      .map(({ id }) => id),
  };
}

/** When an id was made, as ids of every kind sort by it. */
function ulidOf(id: StoreId.Message | StoreId.Session): string {
  return id.slice(id.indexOf("_") + 1);
}
