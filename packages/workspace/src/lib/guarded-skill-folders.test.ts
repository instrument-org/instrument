import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema } from "../schemas/paths";
import { realPathByLinks, skippedSkillFolders } from "./guarded-skill-folders";
import { findSkills } from "./skills";

async function tempHome(): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "guarded-home-")));
}

async function writeSkill(dir: string, name: string): Promise<void> {
  await fs.mkdir(path.join(dir, name), { recursive: true });
  await fs.writeFile(
    path.join(dir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: A skill.\n---\nBody.\n`,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("realPathByLinks", () => {
  it("follows links part by part, relative ones included, to where a path really is", async () => {
    const home = await tempHome();
    await fs.mkdir(path.join(home, "Documents", "skills", "demo"), {
      recursive: true,
    });
    await fs.mkdir(path.join(home, ".claude"));
    await fs.symlink(
      path.join("..", "Documents", "skills"),
      path.join(home, ".claude", "skills"),
    );
    await fs.symlink(path.join(home, ".claude"), path.join(home, "dotclaude"));

    expect(
      await realPathByLinks(path.join(home, "dotclaude", "skills", "demo")),
    ).toBe(path.join(home, "Documents", "skills", "demo"));
    expect(await realPathByLinks(path.join(home, "nowhere", "x"))).toBe(
      path.join(home, "nowhere", "x"),
    );
  });
});

describe.runIf(process.platform === "darwin")("findSkills on macOS", () => {
  it("leaves unread a skills folder, or one skill, linked into a place macOS guards", async () => {
    const home = await tempHome();
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const inDocuments = path.join(home, "Documents", "skills");
    await writeSkill(inDocuments, "demo");
    await writeSkill(path.join(home, "Projects", "skills"), "kept");
    await fs.mkdir(path.join(home, ".claude"));
    await fs.symlink(inDocuments, path.join(home, ".claude", "skills"));
    await fs.mkdir(path.join(home, ".codex", "skills"), { recursive: true });
    await fs.symlink(
      path.join(inDocuments, "demo"),
      path.join(home, ".codex", "skills", "demo"),
    );
    await fs.symlink(
      path.join(home, "Projects", "skills", "kept"),
      path.join(home, ".codex", "skills", "kept"),
    );
    const readFile = vi.spyOn(fs, "readFile");

    const skills = await findSkills([
      {
        dir: AbsolutePathSchema.parse(path.join(home, ".claude", "skills")),
        id: "claude",
        source: "claude",
      },
      {
        dir: AbsolutePathSchema.parse(path.join(home, ".codex", "skills")),
        id: "codex",
        source: "codex",
      },
    ]);

    expect(skills.map((skill) => skill.name)).toEqual(["kept"]);
    expect(skippedSkillFolders()).toEqual([
      { folder: inDocuments, root: path.join(home, "Documents") },
      {
        folder: path.join(inDocuments, "demo"),
        root: path.join(home, "Documents"),
      },
    ]);
    // Nothing inside Documents was opened, which is what puts macOS's prompt up.
    expect(
      readFile.mock.calls.filter(([file]) =>
        String(file).startsWith(path.join(home, "Documents")),
      ),
    ).toEqual([]);
  });
});
