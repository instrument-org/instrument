import { ChatIdSchema } from "../../schemas/chat-id";
import { chatGone } from "../chat-gone";
import { recordChanged, recordMessageChanged } from "../record-changes";
import { resolveChat } from "../record-folders";
import { type Arrival, RecordArrivals } from "./arrivals";
import { writingChatRecords } from "./chat-records";
import { type DeviceId } from "./device-id";

/**
 * Takes what another device's files brought a chat into this process: the
 * chat's fold, when it is held, catches up first, so a read that the change
 * wakes sees it; then the change is said the way this process's own writes
 * say theirs, so the chat list, an open conversation and its settings are read
 * again. A folder no chat had before is found as a chat by resolving it.
 * Nothing here starts a turn.
 */
async function takeArrival(arrival: Arrival): Promise<void> {
  const chat = resolveChat(arrival.chat);
  if (chat === undefined) {
    return;
  }
  await writingChatRecords()?.catchUp(chat);
  for (const message of arrival.messages) {
    recordMessageChanged(chat, message);
  }
  if (arrival.new || arrival.session) {
    recordChanged(chat, "session");
  }
}

/**
 * Takes a chat's folder found gone: the chat goes from the index and the
 * list, as it does when trashed here (`chatGone`), which a trash here has
 * already done by the time a look sees its folder go.
 */
async function takeGone(name: string): Promise<void> {
  const chat = ChatIdSchema.safeParse(name);
  if (chat.success) {
    await chatGone(chat.data);
  }
}

let running: RecordArrivals | undefined;

/**
 * Starts noticing another device's files in the workspace's chats folder
 * (`RecordArrivals`), in place of any started before, and answers it for the
 * app to say when its window comes forward and goes behind.
 */
export async function startRecordArrivals({
  chatsDir,
  device,
  onError,
}: {
  chatsDir: string;
  device: DeviceId;
  onError?: (error: unknown) => void;
}): Promise<RecordArrivals> {
  running?.stop();
  const arrivals = new RecordArrivals({
    chatsDir,
    device,
    onArrival: takeArrival,
    onGone: takeGone,
    ...(onError && { onError }),
  });
  running = arrivals;
  await arrivals.start();
  return arrivals;
}

/** Stops noticing another device's files. */
export function stopRecordArrivals(): void {
  running?.stop();
  running = undefined;
}

/**
 * Watches a chat's folder while something shows it, where the chats folder
 * is not watched whole (`RecordArrivals.attend`). Nothing to do where
 * nothing was started.
 */
export function attendChatArrivals(chat: string): () => void {
  return running?.attend(chat) ?? (() => undefined);
}
