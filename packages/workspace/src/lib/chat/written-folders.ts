import fs from "node:fs/promises";
import path from "node:path";
import { unique } from "radashi";

import { type ChatId } from "../../schemas/chat-id";
import { type FoldedChat } from "../records/fold";
import { TOOL_NAMES } from "../../tools/name";
import { isToolPart } from "../is-tool-part";
import { pathIsWithin } from "../path-is-within";
import { writingChatRecords } from "../records/chat-records";
import { resolveChat } from "../record-folders";
import { resolveWorkspaceFilePaths } from "../resolve-workspace-file-path";
import { getWorkspaceConfig } from "../workspace-config";
import { outputFolderPath } from "./output-folder";

/** The file tools whose answer names the file they wrote. */
const WRITING_TOOLS = new Set<string>([
  `tool-${TOOL_NAMES.editFile}`,
  `tool-${TOOL_NAMES.generateImage}`,
  `tool-${TOOL_NAMES.writeFile}`,
]);

/**
 * The folders holding files a chat wrote that are still there, for the
 * chat's head to open: its sessions' file tools and what its shell calls
 * changed on disk (`data-stepFacts`), its tasks' included.
 *
 * A folder is named by where the file sits under the Instrument folder (or
 * the workspace, which is the same folder once the person picked one): a
 * file two or more folders down is in its second-level folder, so
 * `Files/Kyoto trip/day 1.md` and `Files/Kyoto trip/maps/a.png` are both
 * `Files/Kyoto trip`; a file one folder down is in that folder; a file at
 * the top is in the Instrument folder itself. Hidden folders (`.instrument`)
 * and anything outside those folders, the work folder above all, are left
 * out. Ordered by path.
 */
export async function foldersChatWrote(chatId: ChatId): Promise<string[]> {
  const records = writingChatRecords();
  if (!records || resolveChat(chatId) === undefined) {
    return [];
  }
  let chat: FoldedChat;
  try {
    ({ chat } = await records.read(chatId));
  } catch {
    return [];
  }
  const { hostPaths, shellPaths } = filesWritten(chat);
  // A shell call's file is read where it is now as well as where it was, so
  // one written in a folder a migration moved is found where it went.
  const resolved = await resolveWorkspaceFilePaths({
    chatId,
    filePaths: [...shellPaths, ...hostPaths],
  });
  const files = unique([
    ...hostPaths,
    ...[...resolved.values()].filter((each) => each !== null),
  ]);
  const bases = unique([outputFolderPath(), getWorkspaceConfig().rootDir]);
  const folders = await Promise.all(
    files.map(async (file) => {
      const folder = folderOf(file, bases);
      return folder !== undefined && (await isFile(file)) ? folder : undefined;
    }),
  );
  return unique(folders.filter((each) => each !== undefined)).toSorted();
}

/**
 * The files a chat's sessions wrote: host paths from what the disk said a
 * shell call changed, and paths as the shell spells them from the file tools.
 */
function filesWritten(chat: FoldedChat): {
  hostPaths: string[];
  shellPaths: string[];
} {
  const hostPaths: string[] = [];
  const shellPaths: string[] = [];
  for (const session of chat.sessions) {
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (part.type === "data-stepFacts") {
          for (const file of part.data.files) {
            if (file.change === "created" || file.change === "changed") {
              hostPaths.push(file.path);
            }
          }
        } else if (isToolPart(part) && WRITING_TOOLS.has(part.type)) {
          const written = writtenPathOf(part.output);
          if (written !== undefined) {
            shellPaths.push(written);
          }
        }
      }
    }
  }
  return { hostPaths, shellPaths };
}

/** The `filePath` a file tool answered with, where it answered with one. */
function writtenPathOf(output: unknown): string | undefined {
  return typeof output === "object" &&
    output !== null &&
    "filePath" in output &&
    typeof output.filePath === "string"
    ? output.filePath
    : undefined;
}

/** The folder a file counts as in, under the first of `bases` it is in. */
function folderOf(file: string, bases: readonly string[]): string | undefined {
  const base = bases.find((each) => pathIsWithin(file, each));
  if (base === undefined || base === file) {
    return undefined;
  }
  const segments = path.relative(base, file).split(path.sep);
  if (segments.some((segment) => segment.startsWith("."))) {
    return undefined;
  }
  const folders = segments.slice(0, -1).slice(0, 2);
  return path.join(base, ...folders);
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}
