import { err, ok, ResultAsync, safeTry } from "neverthrow";

import { type ChatDir } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import {
  type ChatSettings,
  type ChatSettingsUpdate,
  ChatSettingsUpdateSchema,
} from "../schemas/chat-settings";
import { TypedError } from "./errors";
import { getCurrentDate } from "./get-current-date";
import { chatDir } from "./record-folders";
import { readChatRecord, updateChatRecord } from "./chat-record";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * What the app knows about a task: its title, whether it is pinned or unread,
 * which project it belongs to, and when it was made and last worked in.
 *
 * One of the two views over the task record; the state beside it is the other.
 * See task-record.ts for what separates them.
 */
export async function getChatSettings(
  dir: ChatDir,
): Promise<ChatSettings | undefined> {
  const record = await readChatRecord(dir);
  return record.settings;
}

/**
 * Mark that something happened in this task, which is what orders the list.
 *
 * Best-effort: a task whose activity stamp fails to write sorts by the old
 * filesystem fallback, which is worse but not wrong, and losing the turn over
 * it would be.
 */
export async function recordChatActivity(chatId: ChatId): Promise<void> {
  const result = await updateChatSettings(chatId, {
    lastActivityAt: getCurrentDate(),
  });
  if (result.isErr()) {
    getWorkspaceConfig().captureException(result.error);
  }
}

export function updateChatSettings(
  chatId: ChatId,
  updates: ChatSettingsUpdate,
) {
  return safeTry(async function* () {
    const parseResult = ChatSettingsUpdateSchema.safeParse(updates);
    if (!parseResult.success) {
      return err(
        new TypedError.Parse(
          `Invalid task settings updates: ${parseResult.error.message}`,
          { cause: parseResult.error },
        ),
      );
    }

    yield* ResultAsync.fromPromise(
      writeMergedSettings(chatId, parseResult.data),
      (error) =>
        new TypedError.FileSystem(
          `Failed to write task settings: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
    );

    return ok(undefined);
  });
}

async function writeMergedSettings(
  chatId: ChatId,
  updates: ChatSettingsUpdate,
): Promise<void> {
  await updateChatRecord(chatDir(chatId), "settings", (record) => {
    // Raw first so `state` and anything this build cannot read survive the
    // write, then the parsed settings so their defaults apply, then the change.
    //
    // A settings view that would not parse contributes nothing rather than its
    // defaults. The view is parsed as one object, so a single field this build
    // cannot read -- one a newer build wrote, one a hand edit broke -- takes the
    // whole view with it, and defaults laid over the raw record would then
    // replace the title the record still holds. Every activity stamp comes
    // through here, so that write is one the user need do nothing to provoke.
    const merged: Record<string, unknown> = {
      ...record.raw,
      ...record.settings,
      ...updates,
    };

    return merged;
  });
}
