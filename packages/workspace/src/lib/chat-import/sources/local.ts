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

/** The coding agents here with at least one chat to import. */
export async function localSources(
  homeDir: string = os.homedir(),
): Promise<ImportSource[]> {
  const found = await Promise.all(
    KNOWN.map(async ({ kind, name, site }): Promise<ImportSource | undefined> => {
      const candidates = await openLocalSource(kind, homeDir)
        .list()
        .catch(() => []);
      return candidates.length > 0
        ? {
            from: { kind, type: "local" },
            kind,
            location: homeRelative(locationOf(kind, homeDir), homeDir),
            name,
            site,
          }
        : undefined;
    }),
  );
  return found.flatMap((source) => (source ? [source] : []));
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
