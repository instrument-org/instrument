import path from "node:path";

import type { ChatSource, ImportSource } from "../model";
import {
  chatGptExportSource,
  isChatGptConversationsFile,
} from "./chatgpt-export";
import { claudeExportSource } from "./claude-export";
import {
  type ExportFiles,
  isRecord,
  jsonArrayObjects,
  locate,
  openExportFiles,
  UnreadableExportError,
} from "./export-files";

const NOT_AN_EXPORT = "This file isn't a ChatGPT or Claude export.";

/**
 * Opens an export a person picked, a `.zip` or the folder it was unpacked
 * to, and says which service it came from by what is in it. Nothing is read
 * past the first conversation until `list` or `read` is called.
 *
 * Rejects with a message a person can read when the path is not a ChatGPT or
 * Claude export.
 */
export async function openExport(
  exportPath: string,
): Promise<{ source: ImportSource; chats: ChatSource }> {
  let files: ExportFiles;
  try {
    files = await openExportFiles(exportPath);
  } catch (error) {
    throw error instanceof UnreadableExportError
      ? error
      : new Error(NOT_AN_EXPORT, { cause: error });
  }
  let found = locate(files.names, isChatGptConversationsFile);
  if (!found) {
    const nested = await openNestedExport(files);
    files = nested?.files ?? files;
    found = nested?.found;
  }
  if (!found) {
    throw new Error(NOT_AN_EXPORT);
  }
  const service = await detect(files, found);
  if (!service) {
    throw new Error(NOT_AN_EXPORT);
  }
  const location = path.basename(exportPath);
  if (service === "chatgpt") {
    return {
      source: {
        from: { type: "export", path: exportPath },
        kind: "chatgpt-export",
        name: "ChatGPT",
        location,
        site: "https://chatgpt.com",
      },
      chats: chatGptExportSource(files, found.files),
    };
  }
  const prefix = found.prefix;
  const projectFiles = files.names.filter(
    (name) =>
      name === `${prefix}projects.json` ||
      (name.startsWith(`${prefix}projects/`) &&
        name.endsWith(".json") &&
        !name.slice(prefix.length + "projects/".length).includes("/")),
  );
  return {
    source: {
      from: { type: "export", path: exportPath },
      kind: "claude-export",
      name: "Claude",
      location,
      site: "https://claude.ai",
    },
    chats: claudeExportSource(
      files,
      `${prefix}conversations.json`,
      projectFiles,
    ),
  };
}

/**
 * The export inside an export: an archive whose only way in is a zip it
 * holds, as some ChatGPT exports arrive.
 */
async function openNestedExport(
  files: ExportFiles,
): Promise<
  { files: ExportFiles; found: { prefix: string; files: string[] } } | undefined
> {
  const inner = files.names.filter(
    (name) => name.endsWith(".zip") && !name.startsWith("__MACOSX/"),
  );
  if (!files.openNested || inner.length === 0) {
    return undefined;
  }
  for (const name of inner) {
    const nested = await files.openNested(name);
    const found = locate(nested.names, isChatGptConversationsFile);
    if (found) {
      return { files: nested, found };
    }
  }
  return undefined;
}

type Service = "chatgpt" | "claude";

/**
 * Which service an export is from. Only ChatGPT splits its conversations
 * across numbered files. Otherwise the first conversation says, since the
 * two shape a conversation differently (`mapping` against `chat_messages`),
 * and an export with no conversations falls back on the files beside it.
 */
async function detect(
  files: ExportFiles,
  found: { prefix: string; files: string[] },
): Promise<Service | undefined> {
  const conversations = `${found.prefix}conversations.json`;
  if (!found.files.includes(conversations)) {
    return "chatgpt";
  }
  let looked = 0;
  for await (const raw of jsonArrayObjects(files.stream(conversations))) {
    if (isRecord(raw) && "mapping" in raw) {
      return "chatgpt";
    }
    if (isRecord(raw) && "chat_messages" in raw) {
      return "claude";
    }
    if (++looked >= 10) {
      break;
    }
  }
  const beside = (name: string) => files.names.includes(found.prefix + name);
  if (beside("chat.html") || beside("user.json")) {
    return "chatgpt";
  }
  if (beside("users.json")) {
    return "claude";
  }
  return undefined;
}
