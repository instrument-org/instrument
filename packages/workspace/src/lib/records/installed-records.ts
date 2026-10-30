import type { ChatRecords } from "./chat-records";

/**
 * The chat records a workspace put in place for this process, apart from
 * `chat-records.ts` so a module the records' own schemas reach (the
 * permission rules raise cards) can write through them without importing
 * them back.
 */
let installed: ChatRecords | undefined;

/** Puts `records` in place of the process's own, or takes it out again. */
export function installChatRecords(records: ChatRecords | undefined): void {
  installed = records;
}

/**
 * The chat records this process writes, or nothing where none are in place.
 * A workspace puts them there as it opens; a process that only reads chats
 * writes no record, and neither does a test that has not asked for one.
 */
export function writingChatRecords(): ChatRecords | undefined {
  return installed;
}
