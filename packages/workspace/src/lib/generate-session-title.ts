import { type TaskId } from "../schemas/task-id";
import { taskDir } from "./app-dir-utils";
import { getProjectManifest } from "./project-manifest";
import { Store } from "./store";

const DEFAULT_UNTITLED_BASE = "Untitled chat";

const defaultUntitledChatPattern = /^Untitled chat(?: \d+)?$/;

export async function generateSessionTitle({
  sessionNamePrefix,
  signal,
  taskId,
}: {
  sessionNamePrefix?: string;
  signal?: AbortSignal;
  taskId: TaskId;
}): Promise<string> {
  const baseTitle = sessionNamePrefix
    ? `Untitled ${sessionNamePrefix}`
    : DEFAULT_UNTITLED_BASE;

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
  taskId: TaskId;
  title: string;
}) {
  if (isUntitledChatSessionTitle(title)) {
    return true;
  }
  const manifest = await getProjectManifest(taskDir(taskId));
  return manifest?.name === title;
}

export function isUntitledChatSessionTitle(title: string) {
  return defaultUntitledChatPattern.test(title);
}
