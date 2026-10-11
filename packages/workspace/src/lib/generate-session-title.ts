import { UNTITLED_CHAT_TITLE } from "../constants";
import { type ChatId } from "../schemas/chat-id";
import { Store } from "./store";
import { chatDir } from "./record-folders";
import { getChatSettings } from "./chat-settings";

const defaultUntitledChatPattern = new RegExp(
  `^${UNTITLED_CHAT_TITLE}(?: \\d+)?$`,
);

export async function generateSessionTitle({
  signal,
  chatId,
}: {
  signal?: AbortSignal;
  chatId: ChatId;
}): Promise<string> {
  const baseTitle = UNTITLED_CHAT_TITLE;

  const sessionsResult = await Store.getSessions(chatId, {
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
  chatId,
  title,
}: {
  chatId: ChatId;
  title: string;
}) {
  if (isUntitledChatSessionTitle(title)) {
    return true;
  }
  const settings = await getChatSettings(chatDir(chatId));
  return settings?.name === title;
}

export function isUntitledChatSessionTitle(title: string) {
  return defaultUntitledChatPattern.test(title);
}
