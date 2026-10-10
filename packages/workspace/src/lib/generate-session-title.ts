import { type ChatId } from "../schemas/chat-id";
import { Store } from "./store";
import { chatDir } from "./record-folders";
import { getChatSettings } from "./chat-settings";

const DEFAULT_UNTITLED_BASE = "Untitled chat";

const defaultUntitledChatPattern = /^Untitled chat(?: \d+)?$/;

export async function generateSessionTitle({
  signal,
  taskId,
}: {
  signal?: AbortSignal;
  taskId: ChatId;
}): Promise<string> {
  const baseTitle = DEFAULT_UNTITLED_BASE;

  const sessionsResult = await Store.getSessions(taskId, {
    includeChildSessions: true,
    signal,
  });

  if (sessionsResult.isErr()) {
    return baseTitle;
  }

  const existingSessions = sessionsResult.value;
  const existingTitles = new Set(
    existingSessions.map((session) => session.title),
  );

  if (!existingTitles.has(baseTitle)) {
    return baseTitle;
  }

  let counter = 2;
  let candidateTitle = `${baseTitle} ${counter}`;

  while (existingTitles.has(candidateTitle)) {
    counter++;
    candidateTitle = `${baseTitle} ${counter}`;
  }

  return candidateTitle;
}

export async function isSessionTitleAutoReplaceable({
  taskId,
  title,
}: {
  taskId: ChatId;
  title: string;
}) {
  if (isUntitledChatSessionTitle(title)) {
    return true;
  }
  const settings = await getChatSettings(chatDir(taskId));
  return settings?.name === title;
}

export function isUntitledChatSessionTitle(title: string) {
  return defaultUntitledChatPattern.test(title);
}
