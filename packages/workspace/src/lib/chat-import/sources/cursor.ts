import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import type { ChatSource, ImportCandidate, ImportedTranscript } from "../model";
import {
  ConversationFolder,
  dateOf,
  homeRelative,
  isRecord,
  previewFrom,
  stringOf,
  titleFrom,
} from "./shared";

/**
 * Cursor's chats ("composers"), in the editor's global SQLite store,
 * `User/globalStorage/state.vscdb`, table `cursorDiskKV`:
 *
 * - `composerData:<composerId>`: the chat's name, `createdAt` and
 *   `lastUpdatedAt` (epoch milliseconds), and its messages' order as
 *   `fullConversationHeadersOnly` (`{ bubbleId, type }`, 1 the person and 2
 *   the AI). Older chats keep the messages inline as `conversation`.
 * - `bubbleId:<composerId>:<bubbleId>`: one message, `{ type, text,
 *   createdAt, timingInfo, toolFormerData, images, … }`. A tool call is a
 *   message of its own, its tool named in `toolFormerData.name`.
 *
 * Which folder a chat was in is kept apart: in the global `ItemTable` under
 * `composer.composerHeaders` (Cursor 3.0 on), or per workspace, in
 * `workspaceStorage/<hash>/state.vscdb` beside a `workspace.json` naming the
 * folder (before 3.0).
 *
 * Built from published descriptions of the format and read-only throughout:
 * the database is opened read-only and nothing is written to it.
 */

const KIND = "cursor";

const PERSON = 1;
/** Stands in for a message listing counts by its header without reading it. */
const HEADER_ONLY = "\u0000";
const AI = 2;

/** Where Cursor keeps its `User` folder on each platform, under the home folder. */
export function cursorUserDir(
  homeDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "darwin") {
    return path.join(
      homeDir,
      "Library",
      "Application Support",
      "Cursor",
      "User",
    );
  }
  if (platform === "win32") {
    return path.join(homeDir, "AppData", "Roaming", "Cursor", "User");
  }
  return path.join(homeDir, ".config", "Cursor", "User");
}

interface Composer {
  data: Record<string, unknown>;
  id: string;
}

export function cursorSource({
  homeDir,
  platform,
}: {
  homeDir: string;
  platform?: NodeJS.Platform;
}): ChatSource {
  const userDir = cursorUserDir(homeDir, platform);
  const dbPath = path.join(userDir, "globalStorage", "state.vscdb");
  let cached: { stamp: string; candidates: ImportCandidate[] } | undefined;

  return {
    kind: KIND,
    async list() {
      const stamp = fileStamp(dbPath);
      if (!stamp) {
        return [];
      }
      if (cached?.stamp === stamp) {
        return cached.candidates;
      }
      const candidates = withDatabase(dbPath, (db) => {
        const projects = projectsOf(db, userDir);
        const listed: ImportCandidate[] = [];
        for (const composer of composers(db)) {
          const scanned = scanComposer(db, composer, {
            homeDir,
            keepText: false,
            project: projects.get(composer.id),
          });
          if (scanned) {
            listed.push(scanned.candidate);
          }
        }
        return listed.toSorted(
          (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
        );
      });
      cached = { candidates: candidates ?? [], stamp };
      return cached.candidates;
    },
    async *read(sourceIds) {
      const transcripts =
        withDatabase(dbPath, (db) => {
          const projects = projectsOf(db, userDir);
          return sourceIds.flatMap((id) => {
            const data = jsonValue(db, `composerData:${id}`);
            const scanned = data
              ? scanComposer(
                  db,
                  { data, id },
                  { homeDir, keepText: true, project: projects.get(id) },
                )
              : undefined;
            return scanned
              ? [{ ...scanned.candidate, messages: scanned.messages }]
              : [];
          });
        }) ?? [];
      yield* transcripts;
    },
  };
}

/** The database's size and modified time, its write-ahead log's included, or undefined when absent. */
function fileStamp(dbPath: string): string | undefined {
  try {
    const db = fs.statSync(dbPath);
    const wal = fs.statSync(`${dbPath}-wal`, { throwIfNoEntry: false });
    return [db.size, db.mtimeMs, wal?.size ?? 0, wal?.mtimeMs ?? 0].join(":");
  } catch {
    return undefined;
  }
}

function withDatabase<T>(
  dbPath: string,
  use: (db: DatabaseSync) => T,
): T | undefined {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    return use(db);
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

function* composers(db: DatabaseSync): Generator<Composer> {
  const rows = db
    .prepare(
      "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'",
    )
    .iterate();
  for (const row of rows) {
    const data = parseValue(row.value);
    const key = stringOf(row.key);
    const id = stringOf(data?.composerId) ?? key?.slice("composerData:".length);
    if (data && id) {
      yield { data, id };
    }
  }
}

function jsonValue(
  db: DatabaseSync,
  key: string,
): Record<string, unknown> | undefined {
  try {
    const row = db
      .prepare("SELECT value FROM cursorDiskKV WHERE key = ?")
      .get(key);
    return parseValue(row?.value);
  } catch {
    return undefined;
  }
}

function itemValue(db: DatabaseSync, key: string): unknown {
  try {
    const row = db
      .prepare("SELECT value FROM ItemTable WHERE key = ?")
      .get(key);
    return parseJson(row?.value);
  } catch {
    return undefined;
  }
}

function parseValue(value: unknown): Record<string, unknown> | undefined {
  const parsed = parseJson(value);
  return isRecord(parsed) ? parsed : undefined;
}

function parseJson(value: unknown): unknown {
  const text =
    typeof value === "string"
      ? value
      : value instanceof Uint8Array
        ? Buffer.from(value).toString("utf8")
        : undefined;
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Each chat's folder, by composer id, from wherever this Cursor build keeps it. */
function projectsOf(db: DatabaseSync, userDir: string): Map<string, string> {
  const projects = new Map<string, string>();
  for (const workspace of workspaceFolders(userDir)) {
    for (const id of workspace.composerIds) {
      projects.set(id, workspace.folder);
    }
  }
  const headers = itemValue(db, "composer.composerHeaders");
  const entries = isRecord(headers) ? headers.allComposers : headers;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isRecord(entry) || !isRecord(entry.workspaceIdentifier)) {
      continue;
    }
    const id = stringOf(entry.composerId);
    const uri = entry.workspaceIdentifier.uri;
    const folder = isRecord(uri) ? stringOf(uri.fsPath) : undefined;
    if (id && folder) {
      projects.set(id, folder);
    }
  }
  return projects;
}

/** Workspaces from before Cursor 3.0, each with its folder and the chats it listed. */
function workspaceFolders(
  userDir: string,
): { composerIds: string[]; folder: string }[] {
  const root = path.join(userDir, "workspaceStorage");
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const dir = path.join(root, entry);
    const folder = workspaceFolder(path.join(dir, "workspace.json"));
    const dbPath = path.join(dir, "state.vscdb");
    if (!folder || !fs.existsSync(dbPath)) {
      return [];
    }
    const composerIds =
      withDatabase(dbPath, (db) => {
        const data = itemValue(db, "composer.composerData");
        const all = isRecord(data) ? data.allComposers : undefined;
        return (Array.isArray(all) ? all : []).flatMap((item) => {
          const id = isRecord(item) ? stringOf(item.composerId) : undefined;
          return id ? [id] : [];
        });
      }) ?? [];
    return composerIds.length > 0 ? [{ composerIds, folder }] : [];
  });
}

function workspaceFolder(file: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const uri = isRecord(parsed) ? stringOf(parsed.folder) : undefined;
    return uri?.startsWith("file://") ? fileURLToPath(uri) : undefined;
  } catch {
    return undefined;
  }
}

/** A chat's messages in order: its headers' bubbles, or the older inline list. */
function bubbles(
  db: DatabaseSync,
  composer: Composer,
  full: boolean,
): Record<string, unknown>[] {
  const inline = composer.data.conversation;
  if (Array.isArray(inline) && inline.length > 0) {
    return inline.filter(isRecord);
  }
  const headers = composer.data.fullConversationHeadersOnly;
  if (!Array.isArray(headers)) {
    return [];
  }
  return headers.flatMap((header) => {
    if (!isRecord(header)) {
      return [];
    }
    const bubbleId = stringOf(header.bubbleId);
    if (!full) {
      return [header];
    }
    const bubble = bubbleId
      ? jsonValue(db, `bubbleId:${composer.id}:${bubbleId}`)
      : undefined;
    return bubble ? [{ type: header.type, ...bubble }] : [];
  });
}

function scanComposer(
  db: DatabaseSync,
  composer: Composer,
  {
    homeDir,
    keepText,
    project,
  }: { homeDir: string; keepText: boolean; project?: string },
):
  | { candidate: ImportCandidate; messages: ImportedTranscript["messages"] }
  | undefined {
  const { data, id } = composer;
  const createdAt = dateOf(data.createdAt);
  const updatedAt = dateOf(data.lastUpdatedAt) ?? createdAt;
  if (!createdAt || !updatedAt) {
    return undefined;
  }
  const model = isRecord(data.modelConfig)
    ? stringOf(data.modelConfig.modelName)
    : undefined;
  const folder = new ConversationFolder({ keepText });
  // Listing reads only the headers, which say who spoke but not what; the
  // opening ask is read on its own, for the title.
  let firstPrompt: string | undefined;
  for (const bubble of bubbles(db, composer, keepText)) {
    const at = dateOf(bubble.createdAt) ?? timing(bubble) ?? createdAt;
    if (bubble.type === PERSON) {
      if (keepText || "text" in bubble) {
        const images = Array.isArray(bubble.images) ? bubble.images.length : 0;
        folder.user({
          at,
          text: stringOf(bubble.text) ?? "",
          ...(images ? { attachments: images } : {}),
        });
      } else {
        folder.user({ at, text: HEADER_ONLY });
        firstPrompt ??= openingAsk(db, id, bubble);
      }
    } else if (bubble.type === AI) {
      const tool = isRecord(bubble.toolFormerData)
        ? (stringOf(bubble.toolFormerData.name) ?? "tool")
        : undefined;
      const bubbleModel =
        (isRecord(bubble.modelInfo)
          ? stringOf(bubble.modelInfo.modelName)
          : undefined) ?? model;
      folder.assistant({
        at,
        text:
          keepText || "text" in bubble ? (stringOf(bubble.text) ?? "") : true,
        ...(tool ? { tools: [tool] } : {}),
        ...(bubbleModel ? { model: bubbleModel } : {}),
      });
    }
  }
  const folded = folder.finish();
  if (folded.count === 0) {
    return undefined;
  }
  const prompt = folded.firstPrompt === HEADER_ONLY ? firstPrompt : folded.firstPrompt;
  const name = stringOf(data.name)?.trim();
  const incidental = !folded.prompted || !folded.replied;
  return {
    candidate: {
      createdAt,
      kind: KIND,
      messages: folded.count,
      sourceId: id,
      title: name || (prompt ? titleFrom(prompt) : ""),
      updatedAt:
        folded.updatedAt && folded.updatedAt > updatedAt
          ? folded.updatedAt
          : updatedAt,
      ...(prompt ? { preview: previewFrom(prompt) } : {}),
      ...(project ? { project: homeRelative(project, homeDir) } : {}),
      ...(incidental ? { incidental: true } : {}),
    },
    messages: folded.messages,
  };
}

function timing(bubble: Record<string, unknown>): Date | undefined {
  return isRecord(bubble.timingInfo)
    ? dateOf(bubble.timingInfo.clientStartTime)
    : undefined;
}

function openingAsk(
  db: DatabaseSync,
  composerId: string,
  header: Record<string, unknown>,
): string | undefined {
  const bubbleId = stringOf(header.bubbleId);
  const bubble = bubbleId
    ? jsonValue(db, `bubbleId:${composerId}:${bubbleId}`)
    : undefined;
  const text = stringOf(bubble?.text)?.trim();
  return text || undefined;
}
