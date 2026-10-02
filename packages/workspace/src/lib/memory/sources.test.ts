import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listMemorySources } from "./sources";

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "memory-sources-test-"));
});

afterEach(async () => {
  await fs.rm(home, { force: true, recursive: true });
});

/** A tool installed, as far as this is concerned: its folder and its marker. */
async function install(...segments: string[]) {
  const file = path.join(home, ...segments);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, "# whatever it remembers\n");
}

describe("listMemorySources", () => {
  it("finds nothing in a home with nothing installed", async () => {
    expect(await listMemorySources(home)).toEqual([]);
  });

  it("names a tool by the folder a person would write", async () => {
    await install(".claude", "CLAUDE.md");

    expect(await listMemorySources(home)).toEqual([
      {
        home: "~/.claude",
        name: "Claude Code",
        path: path.join(home, ".claude"),
        site: "https://claude.ai",
      },
    ]);
  });

  it("finds one kept under .config as readily as one in home", async () => {
    await install(".config", "opencode", "AGENTS.md");

    const found = await listMemorySources(home);
    expect(found.map((source) => source.home)).toEqual(["~/.config/opencode"]);
  });

  it("passes over a folder with nothing in it to import", async () => {
    await fs.mkdir(path.join(home, ".codex"), { recursive: true });

    expect(await listMemorySources(home)).toEqual([]);
  });

  it("lists several, in the order it knows them", async () => {
    await install(".codex", "AGENTS.md");
    await install(".claude", "CLAUDE.md");
    await install(".cursor", "rules");

    const found = await listMemorySources(home);
    expect(found.map((source) => source.name)).toEqual([
      "Claude Code",
      "Codex",
      "Cursor",
    ]);
  });
});
