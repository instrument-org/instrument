import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { ok, type Result } from "neverthrow";

import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type WorkspaceConfig } from "../../types";
import { cappedTitle, numberedName, safeName } from "../folder-name";
import { generateTitleFromUserMessage } from "../generate-title-from-user-message";
import { listChats } from "./chats";

/**
 * How many of the person's other chats the titler sees: enough to cover what
 * a list shows near the top, few enough that the call stays small.
 */
export const RECENT_TITLES = 20;

/**
 * What a title is compared by to say two chats share a name: the name it
 * makes as a folder (`safeName`), in one case, so two titles that differ
 * only in characters a name can't carry, or in capitals, count as one.
 */
export function nameKey(title: string): string {
  return safeName(title).toLowerCase();
}

/** The names around a chat: those it may not take, and the recent ones it is shown. */
export interface NamesBeside {
  /** The titles of the person's other recent chats, newest first. */
  recent: string[];
  /** Every other chat's title, by {@link nameKey}. */
  taken: ReadonlySet<string>;
}

/**
 * The names a chat's title has to stand apart from: every other chat's
 * title, archived ones included, since a search still finds them by it.
 */
export async function namesBeside(chatId: ChatId): Promise<NamesBeside> {
  const others = (await listChats()).filter(
    (chat) => chat.id !== chatId && chat.titled,
  );
  const recent = others
    .filter((chat) => !chat.archived)
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, RECENT_TITLES)
    .map((chat) => chat.title);
  return {
    recent,
    taken: new Set(others.map((chat) => nameKey(chat.title))),
  };
}

/**
 * A title no other chat has: the one asked for first, and where that is
 * taken, the one asked for again with the taken name handed back. A second
 * answer that is taken as well, or that fails, leaves the first one numbered
 * the way a copied folder is (`Weather 2`).
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
  laterMessages,
  message,
  model,
  reply,
  workspaceConfig,
}: {
  chatId: ChatId;
  currentTitle?: string;
  laterMessages?: readonly string[];
  message: SessionMessage.UserWithParts;
  model: AIGatewayModel.Type;
  reply?: string;
  workspaceConfig: WorkspaceConfig;
}): Promise<Result<string, { message: string; originalError: unknown }>> {
  // A list that cannot be read leaves the chat named as if it were alone,
  // with nothing to tell it apart from and no name taken.
  const { recent, taken } = await namesBeside(chatId).catch(
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
        ...(laterMessages === undefined ? {} : { laterMessages }),
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
