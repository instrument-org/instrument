import path from "node:path";

import { type AbsolutePath, type ChatDir } from "../schemas/paths";
import { ChatIdSchema } from "../schemas/chat-id";
import { StoredChatStateSchema, type ChatState } from "../schemas/chat-state";
import { chatStatePath } from "./chat-dir-utils";
import {
  type JsonRecord,
  readJsonRecord,
  updateJsonRecord,
} from "./json-record-file";
import { recordChanged } from "./record-changes";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * Where this device left off *inside* a chat, `state.<device>.json` in its
 * record folder, and the only writer of it: the browser tabs its sessions
 * drive, the cards its agent waits on, the app guides it was handed. Only
 * this device writes it, and only this device reads it, so a turn on another
 * computer never closes this one's tabs or takes away a card its agent is
 * waiting on. Another device's state file is there for later readers and
 * ignored.
 *
 * What every device knows about a chat is in its settings files, and is
 * written through the records (`ChatWrites.setting`). Every write here says
 * `state` on the record change feed, so a reader of the state hears every
 * write to it without its writer having to announce it.
 */

/**
 * Where this device left off in a chat.
 *
 * Total rather than optional: an empty state means nothing has been set, and
 * a state file that cannot be read costs the chat its tabs and cards and
 * nothing else.
 */
export async function getChatState(dir: ChatDir): Promise<ChatState> {
  const read = await readJsonRecord(statePath(dir));
  return read.kind === "read" ? stateFrom(read.record) : emptyState();
}

export async function setChatState(
  dir: ChatDir,
  state: Partial<ChatState>,
): Promise<void> {
  await updateChatState(dir, () => state);
}

/**
 * Changes this device's state from what is on disk, read inside the write
 * queue, so two changes landing together each build on the other. A field
 * this build cannot read is carried forward.
 */
export async function updateChatState(
  dir: ChatDir,
  change: (state: ChatState) => Partial<ChatState>,
): Promise<void> {
  await updateJsonRecord(statePath(dir), (raw) => change(stateFrom(raw)));
  // A record's folder is named by its id.
  const id = ChatIdSchema.safeParse(path.basename(dir));
  if (id.success) {
    recordChanged(id.data, "state");
  }
}

function emptyState(): ChatState {
  return StoredChatStateSchema.parse({});
}

function stateFrom(raw: JsonRecord): ChatState {
  const state = StoredChatStateSchema.safeParse(raw);
  return state.success ? state.data : emptyState();
}

function statePath(dir: ChatDir): AbsolutePath {
  return chatStatePath(dir, getWorkspaceConfig().deviceId);
}
