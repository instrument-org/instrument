import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { ok, type Result } from "neverthrow";
import path from "node:path";

import { CHATS_FOLDER_NAME } from "../../constants";
import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type WorkspaceConfig } from "../../types";
import {
  cappedTitle,
  numberedName,
  safeName,
} from "../chat-folders/folder-name";
import { chatFolderNames, foldersIn } from "../chat-folders/own-folder";
import { generateTitleFromUserMessage } from "../generate-title-from-user-message";
import { listChats } from "./chats";

/**
 * How many of the person's other chats the titler sees: enough to cover what
 * a list shows near the top, few enough that the call stays small.
 */
export const RECENT_TITLES = 20;

/**
 * What a title is compared by to say two chats share a name: the folder name
 * it makes, in one case, since a disk that ignores case (a Mac's, Windows')
 * already counts two such folders as one.
 */
export function nameKey(title: string): string {
  return safeName(title).toLowerCase();
}

/** The names around a chat: those it may not take, and the recent ones it is shown. */
export interface NamesBeside {
  /** The titles of the person's other recent chats, newest first. */
  recent: string[];
  /** Every name another chat has, by {@link nameKey}: its title, or a folder under `Chats/`. */
  taken: ReadonlySet<string>;
}

/**
 * The names a chat's title has to stand apart from: every other chat's
 * title, archived ones included, since a search still finds them by it, and
 * every folder under `Chats/` but the chat's own, which is what the folder's
 * rename would otherwise have to number around.
 */
export async function namesBeside(
  chatId: ChatId,
  workspaceConfig: Pick<WorkspaceConfig, "rootDir" | "workspaceMachineDir">,
): Promise<NamesBeside> {
  const others = (await listChats()).filter(
    (chat) => chat.id !== chatId && chat.titled,
  );
  const recent = others
    .filter((chat) => !chat.archived)
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, RECENT_TITLES)
    .map((chat) => chat.title);
  const own = chatFolderNames(workspaceConfig.workspaceMachineDir).get(chatId);
  const folders = foldersIn(
    path.join(workspaceConfig.rootDir, CHATS_FOLDER_NAME),
  ).filter((name) => own === undefined || nameKey(name) !== nameKey(own));
  return {
    recent,
    taken: new Set(
      [...others.map((chat) => chat.title), ...folders].map(nameKey),
    ),
  };
}

/**
 * A title no other chat has: the one asked for first, and where that is
 * taken, the one asked for again with the taken name handed back. A second
 * answer that is taken as well, or that fails, leaves the first one numbered
 * the way the folder would be (`Weather 2`), so the chat and its folder still
 * read the same.
 *
 * `ask` is the titler, given the name it may not use on the second try. Its
 * failure on the first try is the whole answer: there is nothing to number.
 */
export async function untakenTitle<E>({
  ask,
  taken,
}: {
  ask: (rejected?: string) => PromiseLike<Result<string, E>>;
  taken: ReadonlySet<string>;
}): Promise<Result<string, E>> {
  const first = await ask();
  if (first.isErr()) {
    return first;
  }
  const named = cappedTitle(first.value);
  if (!taken.has(nameKey(named))) {
    return ok(named);
  }
  const again = await ask(named);
  if (again.isOk()) {
    const renamed = cappedTitle(again.value);
    if (!taken.has(nameKey(renamed))) {
      return ok(renamed);
    }
  }
  return ok(numberedTitle(named, taken));
}

/** `title` with the first number on the end that makes it a name nothing has. */
export function numberedTitle(
  title: string,
  taken: ReadonlySet<string>,
): string {
  for (let suffix = 2; ; suffix += 1) {
    const numbered = numberedName(title, suffix);
    if (!taken.has(nameKey(numbered))) {
      return numbered;
    }
  }
}

/**
 * Names a chat from its opening message (and its latest reply, once there is
 * one) so it can be told apart from the person's other chats: the titler sees
 * their recent titles, and a name another chat already has goes back to it
 * once before it is numbered.
 */
export async function nameChat({
  chatId,
  currentTitle,
  message,
  model,
  reply,
  workspaceConfig,
}: {
  chatId: ChatId;
  currentTitle?: string;
  message: SessionMessage.UserWithParts;
  model: AIGatewayModel.Type;
  reply?: string;
  workspaceConfig: WorkspaceConfig;
}): Promise<Result<string, { message: string; originalError: unknown }>> {
  // A list that cannot be read leaves the chat named as if it were alone,
  // with nothing to tell it apart from and no name taken.
  const { recent, taken } = await namesBeside(chatId, workspaceConfig).catch(
    (error: unknown): NamesBeside => {
      workspaceConfig.captureException(error);
      return { recent: [], taken: new Set() };
    },
  );
  return untakenTitle({
    ask: (rejected) =>
      generateTitleFromUserMessage({
        chatId,
        ...(currentTitle === undefined ? {} : { currentTitle }),
        message,
        model,
        otherTitles: recent,
        ...(rejected === undefined ? {} : { rejected }),
        ...(reply === undefined ? {} : { reply }),
        workspaceConfig,
      }),
    taken,
  });
}
