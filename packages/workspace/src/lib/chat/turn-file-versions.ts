import path from "node:path";

import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
import { keepVersion, type KeptVersion, trimVersions } from "../file-versions";
import { filesNamedIn } from "../parse-files-block";
import { resolveWorkspaceFilePaths } from "../resolve-workspace-file-path";
import { workDir } from "../work-dir";
import { getWorkspaceConfig } from "../workspace-config";
import { thisDevice } from "./asks";

/** The most files one reply's versions are kept for. */
const MOST_FILES = 10;

/** The folder in a chat's work folder its versions are kept in. */
export const VERSIONS_FOLDER = ".versions";

type Entry = SessionMessageDataPart.FileVersionsDataPart["files"][number];

/**
 * Keeps a version of each file the turn's reply handed over in its files
 * fence, as the turn left it, and records them on the reply
 * (`data-fileVersions`), so its card can still show them once a later turn
 * changes one. Only what the reply listed: a file the turn changed without
 * listing it is not known to be the turn's. A listed file in the work
 * folder is kept like any other, since listing it hands it over; a kept
 * copy itself is not. Run as the turn ends, before the next one
 * can start, so no later write is taken for this turn's.
 */
export async function keepTurnFileVersions({
  chatId,
  messages,
  sessionId,
}: {
  chatId: ChatId;
  messages: readonly SessionMessage.WithParts[];
  sessionId: StoreId.Session;
}): Promise<void> {
  const start = messages.findLastIndex((message) => message.role === "user");
  const turn = messages.slice(start + 1);
  const reply = turn.findLast((message) => message.role === "assistant");
  const originals = takeOriginals(sessionId);
  if (
    reply === undefined ||
    reply.parts.some(
      (part) =>
        part.type === "data-fileVersions" && part.data.kind === undefined,
    )
  ) {
    return;
  }
  const record = async (
    files: Entry[],
    kind?: SessionMessageDataPart.FileVersionsDataPart["kind"],
  ) => {
    const saved = await ChatWrites.savePart(
      {
        data: { device: thisDevice(), files, ...(kind && { kind }) },
        metadata: {
          createdAt: new Date(),
          id: StoreId.newPartId(),
          messageId: reply.id,
          sessionId,
        },
        type: "data-fileVersions",
      },
      chatId,
    );
    if (saved.isErr()) {
      throw saved.error;
    }
  };
  // What the turn's tools kept before first changing a file goes first, so
  // the reply's own record of the file stays its newest.
  if (originals.length > 0) {
    await record(originals, "original");
  }
  const text = turn
    .flatMap((message) =>
      message.role === "assistant"
        ? message.parts.flatMap((part) =>
            part.type === "text" ? [part.text] : [],
          )
        : [],
    )
    .join("\n\n");
  const named = [...new Set(filesNamedIn(text))]
    .filter((written) => !written.endsWith("/"))
    .slice(0, MOST_FILES);
  if (named.length === 0) {
    return;
  }
  const folder = path.join(workDir(chatId), VERSIONS_FOLDER);
  const resolved = await resolveWorkspaceFilePaths({
    chatId,
    filePaths: named,
  });
  const previous = await keptBefore(chatId, sessionId);
  const label = labelOf(messages[start]);
  const files: Entry[] = [];
  for (const written of named) {
    const hostPath = resolved.get(written);
    if (!hostPath || isInside(folder, hostPath)) {
      continue;
    }
    const kept = await keepVersion({
      file: hostPath,
      folder,
      label,
      kept: previous.get(hostPath),
    });
    if (kept) {
      files.push({
        ...(kept.copy !== undefined && {
          copy: AbsolutePathSchema.parse(kept.copy),
        }),
        hash: kept.hash,
        hostPath,
        path: written,
        size: kept.size,
      });
    }
  }
  if (files.length === 0) {
    return;
  }
  await trimVersions(folder);
  await record(files);
}

/** The versions this computer kept of each file in the session, oldest first, by where it is. */
async function keptBefore(
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

/** The first words the person asked the turn with, fit for a file's name. */
function labelOf(opener: SessionMessage.WithParts | undefined): string {
  const words = (opener?.parts ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .replaceAll(/[^\p{L}\p{N}' -]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .slice(0, 6)
    .join(" ");
  return words.slice(0, 48).trim();
}

function isInside(folder: string, file: string): boolean {
  const relative = path.relative(folder, file);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * The messages with every kept copy another computer made left out, since a
 * copy is only on the computer that made it: a card on this one shows the
 * file as it is now, and says it changed since.
 */
export function withCopiesHere(
  messages: SessionMessage.WithParts[],
): SessionMessage.WithParts[] {
  const here = thisDevice();
  return messages.map((message) =>
    message.parts.some(
      (part) => part.type === "data-fileVersions" && part.data.device !== here,
    )
      ? {
          ...message,
          parts: message.parts.map((part) =>
            part.type === "data-fileVersions" && part.data.device !== here
              ? {
                  ...part,
                  data: {
                    ...part.data,
                    files: part.data.files.map(({ copy: _, ...file }) => file),
                  },
                }
              : part,
          ),
        }
      : message,
  );
}

/** What each session's turn kept before first changing a file, until the turn records it. */
const pending = new Map<
  StoreId.Session,
  { files: Entry[]; seen: Set<string> }
>();

/**
 * Keeps a copy of the file at `hostPath` before a tool first changes it in
 * this turn, unless this chat already has a record of what it holds now.
 * That is the version nothing else keeps: the file as it was before this
 * chat touched it, or as the person left it since. A new file, one in the
 * chat's own work folder, and one too big to copy are passed over. Never
 * fails the write it guards.
 */
export async function keepOriginal({
  chatId,
  hostPath,
  sessionId,
}: {
  chatId: ChatId;
  hostPath: string;
  sessionId: StoreId.Session;
}): Promise<void> {
  const turn = pending.get(sessionId) ?? { files: [], seen: new Set() };
  pending.set(sessionId, turn);
  if (turn.seen.has(hostPath)) {
    return;
  }
  turn.seen.add(hostPath);
  try {
    if (isInside(workDir(chatId), hostPath)) {
      return;
    }
    const name = path.basename(hostPath);
    const kept = [...(await keptBefore(chatId, sessionId))]
      .filter(([at]) => path.basename(at) === name)
      .flatMap(([, versions]) => versions);
    const version = await keepVersion({
      file: hostPath,
      folder: path.join(workDir(chatId), VERSIONS_FOLDER),
      kept,
      label: "before changes",
    });
    if (
      version?.copy === undefined ||
      kept.some((earlier) => earlier.hash === version.hash)
    ) {
      return;
    }
    turn.files.push({
      copy: AbsolutePathSchema.parse(version.copy),
      hash: version.hash,
      hostPath: AbsolutePathSchema.parse(hostPath),
      path: name,
      size: version.size,
    });
  } catch (error) {
    getWorkspaceConfig().captureException(error, { area: "file-versions" });
  }
}

/** The originals a session's turn kept, which the turn's end records; empties them. */
export function takeOriginals(sessionId: StoreId.Session): Entry[] {
  const turn = pending.get(sessionId);
  pending.delete(sessionId);
  return turn?.files ?? [];
}
