import path from "node:path";

import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { type StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { keepVersion, type KeptVersion } from "../file-versions";
import { workDir } from "../work-dir";
import { getWorkspaceConfig } from "../workspace-config";
import { thisDevice } from "./asks";
import { VERSIONS_FOLDER } from "./versions-folder";

type Entry = SessionMessageDataPart.FileVersionsDataPart["files"][number];

/** The versions this computer kept of each file in the session, oldest first, by where it is. */
export async function keptBefore(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<Map<string, KeptVersion[]>> {
  const kept = new Map<string, KeptVersion[]>();
  const read = await ChatReads.transcript({ chatId, sessionId });
  if (read.isErr()) {
    return kept;
  }
  const here = thisDevice();
  for (const message of read.value) {
    for (const part of message.parts) {
      if (part.type === "data-fileVersions" && part.data.device === here) {
        for (const file of part.data.files) {
          kept.set(file.hostPath, [...(kept.get(file.hostPath) ?? []), file]);
        }
      }
    }
  }
  return kept;
}

/** The most files one turn keeps originals of, so a shell loop over a folder stops copying. */
const MOST_ORIGINALS = 100;

/** The most bytes of originals one turn keeps. */
const MOST_ORIGINAL_BYTES = 100 * 1024 * 1024;

/** What each session's turn kept before first changing a file, until the turn records it. */
const pending = new Map<
  StoreId.Session,
  {
    bytes: number;
    files: Entry[];
    /** The versions the chat kept before the turn, read once a turn. */
    kept?: Promise<Map<string, KeptVersion[]>>;
    seen: Set<string>;
  }
>();

export type Original = {
  /** What the file held, read through the agent's filesystem; absent for a path that is not a file yet. */
  bytes?: Uint8Array;
  chatId: ChatId;
  hostPath: string;
  sessionId: StoreId.Session;
};

/** Where a shell on another thread sends each original, to be kept on the thread that records the turn. */
let forwardOriginal: ((original: Original) => Promise<boolean>) | undefined;

export function setOriginalForwarder(
  next: (original: Original) => Promise<boolean>,
): void {
  forwardOriginal = next;
}

/**
 * Keeps what the file at `hostPath` held before a write first changed it in
 * this turn, and records it as the turn's starting point, which Undo puts
 * back: the file as it was before this chat touched it, or as the person
 * left it since. Called by the agent's filesystem before each write
 * (`originalKeepingFs`), whichever tool or command makes it. Contents the
 * chat already kept reuse that copy. A path that was not a file yet is
 * marked seen and kept nothing for, so the turn's own later writes to it
 * never pass for the person's; so is one in the chat's own work folder.
 * Past `MOST_ORIGINALS` files or `MOST_ORIGINAL_BYTES` a turn keeps no more.
 * Keeps nothing outside a turn (`beginTurnFileVersions`). Resolves to
 * whether the turn takes more. Never fails the write it guards.
 */
export async function keepOriginal(original: Original): Promise<boolean> {
  if (forwardOriginal) {
    return forwardOriginal(original);
  }
  const { bytes, chatId, hostPath, sessionId } = original;
  const turn = pending.get(sessionId);
  if (turn === undefined) {
    return false;
  }
  const more = () =>
    turn.files.length < MOST_ORIGINALS && turn.bytes < MOST_ORIGINAL_BYTES;
  if (turn.seen.has(hostPath)) {
    return more();
  }
  turn.seen.add(hostPath);
  if (
    bytes === undefined ||
    isInside(workDir(chatId), hostPath) ||
    !more() ||
    turn.bytes + bytes.length > MOST_ORIGINAL_BYTES
  ) {
    return more();
  }
  try {
    turn.kept ??= keptBefore(chatId, sessionId);
    const version = await keepVersion({
      file: hostPath,
      folder: path.join(workDir(chatId), VERSIONS_FOLDER),
      kept: (await turn.kept).get(hostPath),
      label: "before changes",
      read: () => Promise.resolve(bytes),
    });
    if (version?.copy !== undefined) {
      turn.bytes += version.size;
      turn.files.push({
        copy: AbsolutePathSchema.parse(version.copy),
        hash: version.hash,
        hostPath: AbsolutePathSchema.parse(hostPath),
        path: path.basename(hostPath),
        size: version.size,
      });
    }
  } catch (error) {
    getWorkspaceConfig().captureException(error, { area: "file-versions" });
  }
  return more();
}

/**
 * Starts a session's turn with no originals kept, so one a stopped or failed
 * turn kept, which no turn end recorded, never passes for this turn's.
 */
export function beginTurnFileVersions(sessionId: StoreId.Session): void {
  pending.set(sessionId, { bytes: 0, files: [], seen: new Set() });
}

/** The originals a session's turn kept, which the turn's end records; empties them. */
export function takeOriginals(sessionId: StoreId.Session): Entry[] {
  const turn = pending.get(sessionId);
  pending.delete(sessionId);
  return turn?.files ?? [];
}

function isInside(folder: string, file: string): boolean {
  const relative = path.relative(folder, file);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}
