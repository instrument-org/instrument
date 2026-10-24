import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { localSources, openLocalSource } from "./local";

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "local-import-sources-test-"));
});

afterEach(async () => {
  await fs.rm(home, { force: true, recursive: true });
});

async function claudeSession(records: unknown[]) {
  const file = path.join(home, ".claude", "projects", "-p", "s1.jsonl");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    records.map((record) => JSON.stringify(record)).join("\n"),
  );
}

const record = (type: string, content: unknown, minute: number) => ({
  cwd: home,
  message: { content, model: "m", role: type },
  sessionId: "s1",
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
  type,
});

describe("localSources", () => {
  it("offers nothing in a home with no coding agents", async () => {
    expect(await localSources(home)).toEqual([]);
  });

  it("leaves out an agent whose folder has no chats", async () => {
    await fs.mkdir(path.join(home, ".claude", "projects"), { recursive: true });
    await fs.mkdir(path.join(home, ".codex", "sessions"), { recursive: true });

    expect(await localSources(home)).toEqual([]);
  });

  it("offers an agent with a chat, named where a person would look", async () => {
    await claudeSession([
      record("user", "Hi", 0),
      record("assistant", [{ text: "Hello", type: "text" }], 1),
    ]);

    expect(await localSources(home)).toEqual([
      {
        from: { kind: "claude-code", type: "local" },
        kind: "claude-code",
        location: "~/.claude",
        name: "Claude Code",
        site: "https://claude.ai",
      },
    ]);
  });

  it("hands back one source per agent and home, so listings share a cache", () => {
    expect(openLocalSource("codex", home)).toBe(openLocalSource("codex", home));
    expect(openLocalSource("codex", home).kind).toBe("codex");
  });
});
