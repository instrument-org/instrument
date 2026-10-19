import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MEMORY_FOLDER_NAME } from "../../constants";
import { WorkspaceDirSchema } from "../../schemas/paths";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { workspaceLayout } from "../workspace-layout";
import { moveMemoriesToFolder } from "./move";
import { listMemories, memoryDir, saveMemory } from "./store";

let root: string;
/** Where every build until this one hid them, `.instrument/memory/`. */
const hiddenDir = () => workspaceLayout(root).memoryDir;
const folder = () => path.join(root, MEMORY_FOLDER_NAME);
const previous = getWorkspaceConfig();

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "memory-move-test-"));
  setWorkspaceConfig({
    ...previous,
    rootDir: WorkspaceDirSchema.parse(root),
  });
});

afterEach(async () => {
  setWorkspaceConfig(previous);
  await fs.rm(root, { force: true, recursive: true });
});

/** A memory file where an earlier build hid it. */
async function hide(name: string, text: string) {
  await fs.mkdir(hiddenDir(), { recursive: true });
  await fs.writeFile(path.join(hiddenDir(), `${name}.md`), text);
}

describe("memoryDir", () => {
  it("is Memory at the workspace's top level, where a memory is saved", async () => {
    expect(memoryDir()).toBe(folder());

    const { memory } = await saveMemory(memoryDir(), {
      name: "pacific-time",
      text: "You are on Pacific time.",
    });

    expect(memory.path).toBe(path.join(folder(), "pacific-time.md"));
    expect(await listMemories(memoryDir())).toMatchObject([
      { name: "pacific-time", text: "You are on Pacific time." },
    ]);
  });
});

describe("moveMemoriesToFolder", () => {
  it("brings what a build hid out to Memory, and lists it back", async () => {
    await hide("no-stevia", "No stevia in anything.");

    expect(await moveMemoriesToFolder(root)).toEqual({
      count: 1,
      kind: "moved",
      where: folder(),
    });
    expect(await fs.readFile(path.join(folder(), "no-stevia.md"), "utf8")).toBe(
      "No stevia in anything.",
    );
    expect(await listMemories(memoryDir())).toMatchObject([
      { name: "no-stevia", text: "No stevia in anything." },
    ]);
    await expect(fs.readdir(hiddenDir())).rejects.toThrow();
  });

  it("leaves an existing Memory alone, whatever the hidden folder holds", async () => {
    await hide("no-stevia", "No stevia in anything.");
    await fs.mkdir(folder(), { recursive: true });
    await fs.writeFile(path.join(folder(), "no-stevia.md"), "Mine.");

    expect(await moveMemoriesToFolder(root)).toEqual({
      kind: "already-there",
      where: folder(),
    });
    expect(await fs.readFile(path.join(folder(), "no-stevia.md"), "utf8")).toBe(
      "Mine.",
    );
    expect(await fs.readdir(hiddenDir())).toEqual(["no-stevia.md"]);
  });

  it.each([
    ["there is no hidden folder", false],
    ["the hidden folder is empty", true],
  ])("does nothing when %s", async (_case, made) => {
    if (made) {
      await fs.mkdir(hiddenDir(), { recursive: true });
    }

    expect(await moveMemoriesToFolder(root)).toEqual({ kind: "none" });
    await expect(fs.readdir(folder())).rejects.toThrow();
  });

  it("finds nothing to move a second time, and keeps what was saved since", async () => {
    await hide("no-stevia", "No stevia in anything.");
    await moveMemoriesToFolder(root);
    await saveMemory(memoryDir(), { name: "roofer", text: "Dale at Summit." });

    expect(await moveMemoriesToFolder(root)).toEqual({ kind: "none" });
    expect(
      (await listMemories(memoryDir())).map((each) => each.name).toSorted(),
    ).toEqual(["no-stevia", "roofer"]);
  });
});
