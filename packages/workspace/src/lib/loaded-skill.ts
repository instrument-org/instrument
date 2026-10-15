import { type ChatId } from "../schemas/chat-id";
import { type StoreId } from "../schemas/store-id";
import { ChatReads } from "./chat-reads";

/**
 * The folder of the skill each session loaded last, as its shell names it
 * (`INSTRUMENT_SKILL_DIR`). Read once from the session's history, where the
 * successful `load_skill` calls are, then kept up as it loads more.
 */
const loaded = new Map<StoreId.Session, string | undefined>();

/** Records the folder of a skill a session just loaded. */
export function rememberLoadedSkill(
  sessionId: StoreId.Session,
  skillDir: string,
): void {
  loaded.set(sessionId, skillDir);
}

/**
 * The folder of the skill the session loaded last, a task's own or, before
 * it loaded one, the one its chat had loaded where it forked. Undefined
 * where it has loaded none, or its history cannot be read.
 */
export async function lastLoadedSkillDir({
  chatId,
  sessionId,
  signal,
}: {
  chatId: ChatId;
  sessionId: StoreId.Session;
  signal?: AbortSignal;
}): Promise<string | undefined> {
  if (loaded.has(sessionId)) {
    return loaded.get(sessionId);
  }
  const messages = await ChatReads.modelHistory({ chatId, sessionId, signal });
  if (messages.isErr()) {
    return undefined;
  }
  let found: string | undefined;
  for (const message of messages.value) {
    for (const part of message.parts) {
      if (
        part.type === "tool-load_skill" &&
        part.state === "output-available" &&
        part.output.state === "success" &&
        // A load recorded before skills were read in place names no folder.
        typeof part.output.skillDir === "string"
      ) {
        found = part.output.skillDir;
      }
    }
  }
  // A load made while the history was read wins over what it found.
  if (!loaded.has(sessionId)) {
    loaded.set(sessionId, found);
  }
  return loaded.get(sessionId);
}
