import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ChatSource, ImportSource } from "../model";
import { claudeCodeSource } from "./claude-code";
import { codexSource } from "./codex";
import { cursorSource, cursorUserDir } from "./cursor";
import { homeRelative } from "./shared";

/**
 * The coding agents on this computer whose chats can be imported. Their
 * logs are in the home folder (hidden folders, and Cursor's application
 * support folder), none of which macOS puts behind a consent prompt.
 */

type LocalKind = "claude-code" | "codex" | "cursor";

const KNOWN: { kind: LocalKind; name: string; site: string }[] = [
  { kind: "claude-code", name: "Claude Code", site: "https://claude.ai" },
  { kind: "codex", name: "Codex", site: "https://openai.com" },
  { kind: "cursor", name: "Cursor", site: "https://cursor.com" },
];

/**
 * One source per home folder and kind, so a second listing reuses what the
 * first read instead of reading every log again.
 */
const opened = new Map<string, ChatSource>();

export function openLocalSource(
  kind: LocalKind,
  homeDir: string = os.homedir(),
): ChatSource {
  const key = `${kind}:${homeDir}`;
  const held = opened.get(key);
  if (held) {
    return held;
  }
  const source =
    kind === "claude-code"
      ? claudeCodeSource({ homeDir })
      : kind === "codex"
        ? codexSource({ homeDir })
        : cursorSource({ homeDir });
  opened.set(key, source);
  return source;
}

/**
 * The coding agents here that have kept a chat log. Only whether a log is
 * there is checked, so the answer is quick; listing each one starts behind
 * it, so the picker's listing finds it read.
 */
export async function localSources(
  homeDir: string = os.homedir(),
): Promise<ImportSource[]> {
  const found = await Promise.all(
    KNOWN.map(
      async ({ kind, name, site }): Promise<ImportSource | undefined> => {
        if (!(await hasLogs(kind, homeDir))) {
          return undefined;
        }
        void openLocalSource(kind, homeDir)
          .list()
          .catch(() => []);
        return {
          from: { kind, type: "local" },
          kind,
          location: homeRelative(locationOf(kind, homeDir), homeDir),
          name,
          site,
        };
      },
    ),
  );
  return found.flatMap((source) => (source ? [source] : []));
}

/** Whether the agent has written a log: a session file, or Cursor's database. */
async function hasLogs(kind: LocalKind, homeDir: string): Promise<boolean> {
  if (kind === "cursor") {
    return exists(
      path.join(cursorUserDir(homeDir), "globalStorage", "state.vscdb"),
    );
  }
  const root =
    kind === "claude-code"
      ? path.join(homeDir, ".claude", "projects")
      : path.join(homeDir, ".codex", "sessions");
  return holdsFile(root, kind === "claude-code" ? 1 : 3);
}

/** Whether a file is in `dir` or in its folders down to `depth` levels. */
async function holdsFile(dir: string, depth: number): Promise<boolean> {
  const entries = await fs
    .readdir(dir, { withFileTypes: true })
    .catch(() => []);
  for (const entry of entries) {
    if (entry.isFile() && !entry.name.startsWith(".")) {
      return true;
    }
    if (
      entry.isDirectory() &&
      depth > 0 &&
      (await holdsFile(path.join(dir, entry.name), depth - 1))
    ) {
      return true;
    }
  }
  return false;
}

function exists(file: string): Promise<boolean> {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false);
}

function locationOf(kind: LocalKind, homeDir: string): string {
  if (kind === "claude-code") {
    return path.join(homeDir, ".claude");
  }
  if (kind === "codex") {
    return path.join(homeDir, ".codex");
  }
  return path.dirname(cursorUserDir(homeDir));
}
