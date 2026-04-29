import { type AppConfig } from "./app-config/types";
import { Store } from "./store";

const DEFAULT_UNTITLED_BASE = "Untitled chat";

const defaultUntitledChatPattern = /^Untitled chat(?: \d+)?$/;

export async function generateSessionTitle({
  appConfig,
  sessionNamePrefix,
  signal,
}: {
  appConfig: AppConfig;
  sessionNamePrefix?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const baseTitle = sessionNamePrefix
    ? `Untitled ${sessionNamePrefix}`
    : DEFAULT_UNTITLED_BASE;

  const sessionsResult = await Store.getSessions(appConfig, {
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

export function isDefaultGeneratedSessionTitle(title: string): boolean {
  return defaultUntitledChatPattern.test(title);
}
