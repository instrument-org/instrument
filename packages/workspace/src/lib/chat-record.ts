import path from "node:path";

import { type AbsolutePath, type ChatDir } from "../schemas/paths";
import { ChatIdSchema } from "../schemas/chat-id";
import {
  type ChatSettings,
  ChatSettingsSchema,
} from "../schemas/chat-settings";
import { StoredChatStateSchema, type ChatState } from "../schemas/chat-state";
import { chatSettingsPath, chatStatePath } from "./chat-dir-utils";
import {
  type JsonRecord,
  readJsonRecord,
  updateJsonRecord,
} from "./json-record-file";
import { recordChanged } from "./record-changes";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The two files a chat keeps beside its records, and the only writer of
 * either:
 *
 * - `settings.json` is what the app knows *about* a chat: timestamps, its
 *   folder, the model and effort. Every device reads and writes it, and the
 *   chat list reads it for every chat in the workspace.
 * - `state.<device>.json` is where this device left off *inside* the chat:
 *   the browser tabs its sessions drive, the cards its agent waits on, the
 *   app guides it was handed. Only this device writes it, and only this
 *   device reads it, so a turn on another computer never closes this one's
 *   tabs or takes away a card its agent is waiting on. Another device's
 *   state file is there for later readers and ignored.
 *
 * Every write says which of the two it changed on the record change feed
 * (`settings` or `state`), so a reader of the settings is not woken by a
 * model pick or a tab, and a reader of the state hears every write to it
 * without its writer having to announce it.
 */
export interface ChatRecord {
  /**
   * The object as it was on disk.
   *
   * Writes are built on top of this rather than on the parsed view, so a field
   * this build cannot read is carried forward instead of being dropped by the
   * write that happened to come next.
   */
  raw: Record<string, unknown>;
  /** Undefined when the file is missing or its settings cannot be read. */
  settings: ChatSettings | undefined;
  /**
   * The file is there and could not be read: truncated JSON, something that is
   * not an object, a permission error.
   *
   * Reads answer empty for it, the same answer a chat with no file gets, since
   * a caller asking for its settings has nothing better to show. Writes must
   * not: that empty answer plus whatever the caller is changing *becomes* the
   * file, so a model pick would replace everything else the file held.
   */
  unreadable: boolean;
}

/**
 * Where this device left off in a chat.
 *
 * Total rather than optional, unlike the settings: an empty state means
 * nothing has been set, and a state file that cannot be read costs the chat
 * its tabs and cards rather than its settings.
 */
export async function getChatState(dir: ChatDir): Promise<ChatState> {
  await adoptSettingsState(dir);
  const read = await readJsonRecord(statePath(dir));
  return read.kind === "read" ? stateFrom(read.record) : emptyState();
}

/** Reads the settings file, tolerant of it being missing or unreadable. */
export async function readChatRecord(dir: ChatDir): Promise<ChatRecord> {
  const read = await readJsonRecord(chatSettingsPath(dir));
  // A chat nobody has written a settings file for yet is the one case a write may
  // create from nothing; anything else is a file we have but cannot read.
  return read.kind === "read"
    ? recordFrom(read.record)
    : emptyRecord(read.kind === "unreadable");
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
  await adoptSettingsState(dir);
  await updateJsonRecord(statePath(dir), (raw) => change(stateFrom(raw)));
  announce(dir, "state");
}

/**
 * Applies a change to the settings file, reading it inside the write queue.
 *
 * The callback receives what is currently on disk and returns the fields to
 * write over it (`undefined` drops one; one left out is kept), so a
 * read-modify-write cannot interleave with another: a title's folder and a
 * message's activity stamp landing together would otherwise each build on the
 * record the other had not written yet.
 */
export async function updateChatRecord(
  dir: ChatDir,
  update: (record: ChatRecord) => Record<string, unknown>,
): Promise<ChatRecord> {
  // An unreadable record is refused rather than built on: the write would
  // build on an empty reading of it, and going ahead costs everything the
  // file holds where failing the caller costs a model pick.
  const written = recordFrom(
    await updateJsonRecord(chatSettingsPath(dir), (raw) =>
      update(recordFrom(raw)),
    ),
  );
  announce(dir, "settings");
  return written;
}

/** Record folders this process has already looked in for an earlier build's state. */
const adopted = new Set<string>();

/**
 * Takes in the state an earlier build kept under `state` in `settings.json`,
 * once per chat: into this device's state file when it has none, under the
 * names it has now, and out of the settings either way, since each device's
 * state is its own.
 */
async function adoptSettingsState(dir: ChatDir): Promise<void> {
  if (adopted.has(dir)) {
    return;
  }
  adopted.add(dir);
  const settings = await readJsonRecord(chatSettingsPath(dir));
  if (settings.kind !== "read" || !isRecord(settings.record.state)) {
    return;
  }
  const { appGuidesRead, asks, ...rest } = settings.record.state;
  await updateJsonRecord(statePath(dir), (current) =>
    Object.keys(current).length > 0
      ? undefined
      : {
          ...rest,
          ...(asks !== undefined && { waitingOn: asks }),
          ...(appGuidesRead !== undefined && { appGuidesShown: appGuidesRead }),
        },
  );
  await updateJsonRecord(chatSettingsPath(dir), () => ({ state: undefined }));
}

function announce(dir: ChatDir, half: "settings" | "state") {
  // A record's folder is named by its id.
  const id = ChatIdSchema.safeParse(path.basename(dir));
  if (id.success) {
    recordChanged(id.data, half);
  }
}

function emptyRecord(unreadable: boolean): ChatRecord {
  return { raw: {}, settings: undefined, unreadable };
}

function emptyState(): ChatState {
  return StoredChatStateSchema.parse({});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordFrom(parsed: unknown): ChatRecord {
  if (!isRecord(parsed)) {
    // Valid JSON holding an array, a number, `null`: a record we cannot merge
    // into, which is the same position a truncated file leaves us in.
    return emptyRecord(true);
  }
  const settings = ChatSettingsSchema.safeParse(parsed);
  return {
    raw: parsed,
    settings: settings.success ? settings.data : undefined,
    unreadable: false,
  };
}

function stateFrom(raw: JsonRecord): ChatState {
  const state = StoredChatStateSchema.safeParse(raw);
  return state.success ? state.data : emptyState();
}

function statePath(dir: ChatDir): AbsolutePath {
  return chatStatePath(dir, getWorkspaceConfig().deviceId);
}
