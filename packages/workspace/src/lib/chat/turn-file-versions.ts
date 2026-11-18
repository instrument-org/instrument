import { existsSync } from "node:fs";
import path from "node:path";

import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { StoreId } from "../../schemas/store-id";
import { ChatWrites } from "../chat-writes";
import { keepVersion, trimVersions } from "../file-versions";
import { filesNamedIn } from "../parse-files-block";
import { resolveWorkspaceFilePaths } from "../resolve-workspace-file-path";
import { workDir } from "../work-dir";
import { sessionToolFs } from "../tool-fs";
import { shellPath } from "../workspace-fs-layout";
import { thisDevice } from "./asks";
import { keptBefore, takeOriginals } from "./turn-originals";
import { VERSIONS_FOLDER } from "./versions-folder";

/** The most files one reply's versions are kept for. */
const MOST_FILES = 10;

export { VERSIONS_FOLDER } from "./versions-folder";

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
  const folder = path.join(workDir(chatId), VERSIONS_FOLDER);
  // What the turn's tools kept before first changing a file goes first, so
  // the reply's own record of the file stays its newest.
  if (originals.length > 0) {
    await record(originals, "original");
  }
  const files = await keepNamedFiles({ chatId, folder, messages, sessionId });
  if (files.length > 0) {
    await record(files);
  }
  if (originals.length > 0 || files.length > 0) {
    await trimVersions(folder);
  }
}

/** Keeps a version of each file the turn's reply names in its files fence. */
async function keepNamedFiles({
  chatId,
  folder,
  messages,
  sessionId,
}: {
  chatId: ChatId;
  folder: string;
  messages: readonly SessionMessage.WithParts[];
  sessionId: StoreId.Session;
}): Promise<Entry[]> {
  const start = messages.findLastIndex((message) => message.role === "user");
  const turn = messages.slice(start + 1);
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
    return [];
  }
  const resolved = await resolveWorkspaceFilePaths({
    chatId,
    filePaths: named,
  });
  const previous = await keptBefore(chatId, sessionId);
  // Read as the agent reads, so a listed symlink cannot copy out what the
  // rules keep it from.
  const agentFs = await sessionToolFs({ chatId, sessionId });
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
      read: () => agentFs.fs.readFileBuffer(shellPath(hostPath)),
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
  return files;
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
 * The messages with every kept copy left out that is not on this computer:
 * one another computer made, since a copy is only on the computer that made
 * it, and one the trim has since removed. A card shows such a file as it is
 * now, and says it changed since.
 */
export function withCopiesHere(
  messages: SessionMessage.WithParts[],
): SessionMessage.WithParts[] {
  const here = thisDevice();
  const isHere = (device: string, copy: string | undefined) =>
    copy === undefined || (device === here && existsSync(copy));
  return messages.map((message) =>
    message.parts.some(
      (part) =>
        part.type === "data-fileVersions" &&
        part.data.files.some((file) => !isHere(part.data.device, file.copy)),
    )
      ? {
          ...message,
          parts: message.parts.map((part) =>
            part.type === "data-fileVersions"
              ? {
                  ...part,
                  data: {
                    ...part.data,
                    files: part.data.files.map(({ copy, ...file }) =>
                      isHere(part.data.device, copy) && copy !== undefined
                        ? { ...file, copy }
                        : file,
                    ),
                  },
                }
              : part,
          ),
        }
      : message,
  );
}
