/**
 * Whether the chat index (`record-folders.ts`) is read synchronously on its
 * first use when `loadChatIndex` has not read it. Apart from that module and
 * free of imports, so the test setup can set it before a test file's
 * imports run.
 */
let readsOnFirstUse = false;

/**
 * For tests, whose chats folder changes from one test to the next: an index
 * `loadChatIndex` has not read is read synchronously on its first use,
 * passing over a log kept by name only as a lookup of one chat does. The
 * app never calls it, so an index use there before `loadChatIndex` is an
 * error.
 */
export function readChatIndexOnFirstUse(): void {
  readsOnFirstUse = true;
}

export function chatIndexReadOnFirstUse(): boolean {
  return readsOnFirstUse;
}
