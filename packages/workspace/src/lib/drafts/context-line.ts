import {
  chatAddressOf,
  chatIdNamedBy,
  instrumentLinkOf,
  isInstrumentAddress,
} from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";

import { getMimeType } from "../get-mime-type";
import {
  inWorkspacePath,
  isInWorkspacePath,
  workspaceHostPath,
} from "../workspace-relative-path";

/**
 * One line of a draft's `context`: one thing from outside the draft's folder
 * that goes with the message besides the words, written so a person reading
 * the file can tell what it is, and the same on every computer the workspace
 * syncs to where it can be. What is in the draft's folder goes with it
 * without a line (`draftFolderItems`).
 *
 * - A file in the draft's folder, by its path inside it (`receipt.png`), only
 *   in a folder another draft shares, where the folder cannot say whose it is.
 * - A file or folder in the workspace, from the workspace's top level
 *   (`workspace:/Kitchen plans/`), the form chat records use.
 * - Anything else on this computer, at its absolute path.
 * - Another chat, by its address (`instrument://chat/<id>`), and anything else
 *   with an address of its own (a web page, an app), by that address.
 *
 * A folder's line ends in `/`.
 */
export type DraftContextEntry =
  | { chat: string; kind: "chat" }
  | { kind: "file" | "folder"; path: string }
  | { kind: "link"; url: string };

/** Where a draft's lines are read from: its folder, unknown before it has one, and the workspace's. */
interface LineBase {
  dir: string | undefined;
  rootDir: string;
}

const WINDOWS_ABSOLUTE = /^(?:[a-z]:[/\\]|\\\\)/i;

/** A scheme of two letters or more, which a Windows drive is not. */
const SCHEME = /^[a-z][a-z0-9+.-]+:/i;

/** The line a thing that goes with a draft is written as. */
export function contextLineOf(
  entry: DraftContextEntry,
  { dir, rootDir }: LineBase,
): string {
  switch (entry.kind) {
    case "chat": {
      return chatAddressOf(entry.chat);
    }
    case "link": {
      return entry.url;
    }
    case "file":
    case "folder": {
      const inDraft = dir === undefined ? undefined : insideOf(dir, entry.path);
      const line =
        inDraft ?? inWorkspacePath(entry.path, rootDir) ?? entry.path;
      return entry.kind === "folder" && !/[/\\]$/.test(line)
        ? `${line}/`
        : line;
    }
  }
}

/**
 * What a line names, with a path read as this computer's: nothing for a
 * blank line, a place in the workspace that leaves it, or an address of a
 * chat that is not one.
 */
export function contextEntryOf(
  raw: string,
  { dir, rootDir }: LineBase,
): DraftContextEntry | undefined {
  const line = raw.trim();
  if (line === "") {
    return undefined;
  }
  if (isInstrumentAddress(line)) {
    if (instrumentLinkOf(line)?.kind !== "chat") {
      return { kind: "link", url: line };
    }
    const chat = chatIdNamedBy(line);
    return chat === undefined ? undefined : { chat, kind: "chat" };
  }
  const kind = /[/\\]$/.test(line) ? "folder" : "file";
  const bare = line.length > 1 ? line.replace(/[/\\]+$/, "") : line;
  if (isInWorkspacePath(bare)) {
    const host = workspaceHostPath(bare, rootDir);
    return host === null ? undefined : { kind, path: host };
  }
  if (WINDOWS_ABSOLUTE.test(bare) || path.isAbsolute(bare)) {
    return { kind, path: bare };
  }
  if (SCHEME.test(line) && URL.canParse(line)) {
    return { kind: "link", url: line };
  }
  return dir === undefined ? undefined : { kind, path: path.join(dir, bare) };
}

/**
 * The path inside the draft's folder a line names, for a file in the draft's
 * folder; nothing for a line naming anything else.
 */
export function pastedPathOf(raw: string): string | undefined {
  const line = raw.trim();
  if (
    line === "" ||
    /[/\\]$/.test(line) ||
    isInWorkspacePath(line) ||
    WINDOWS_ABSOLUTE.test(line) ||
    path.isAbsolute(line) ||
    (SCHEME.test(line) && URL.canParse(line))
  ) {
    return undefined;
  }
  return line;
}

/**
 * A file in a draft's folder as a composer shows it: its type, read from its
 * name, its name and its size, which is nothing where the file is gone.
 */
export function pastedFileOf(file: string): {
  mediaType: string;
  name: string;
  path: string;
  size: number;
} {
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    // Gone since the draft named it: shown, and refused when it is sent.
  }
  return {
    mediaType: getMimeType(file),
    name: path.basename(file),
    path: file,
    size,
  };
}

/** `target`'s path inside `dir` with `/` between its names, or nothing for one outside it. */
function insideOf(dir: string, target: string): string | undefined {
  const within = path.relative(dir, target);
  return within === "" || within.startsWith("..") || path.isAbsolute(within)
    ? undefined
    : within.split(path.sep).join("/");
}
