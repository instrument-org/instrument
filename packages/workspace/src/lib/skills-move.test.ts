import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SKILLS_FOLDER_NAME } from "../constants";
import { WorkspaceDirSchema } from "../schemas/paths";
import { moveSkillsToFolder } from "./skills-move";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { workspaceLayout } from "./workspace-layout";
import { getWorkspaceSkillsDir } from "./workspace-skills-dir";

let root: string;
/** Where every build until this one hid them, `.instrument/skills/`. */
const hiddenDir = () => workspaceLayout(root).skillsDir;
const folder = () => path.join(root, SKILLS_FOLDER_NAME);
const previous = getWorkspaceConfig();

async function writeSkill(dir: string, name: string): Promise<void> {
  await fs.mkdir(path.join(dir, name), { recursive: true });
  await fs.writeFile(
    path.join(dir, name, "SKILL.md"),
    `---\ndescription: ${name}\n---\n`,
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-move-test-"));
  setWorkspaceConfig({ ...previous, rootDir: WorkspaceDirSchema.parse(root) });
});

afterEach(async () => {
  setWorkspaceConfig(previous);
  await fs.rm(root, { force: true, recursive: true });
});

describe("moveSkillsToFolder", () => {
  it("brings the workspace's skills out where the person can read them", async () => {
    await writeSkill(hiddenDir(), "tidy-notes");

    const moved = await moveSkillsToFolder(root);

    expect(moved).toEqual({ count: 1, kind: "moved", where: folder() });
    // The resolver and the move agree, which is what makes the skill load.
    expect(getWorkspaceSkillsDir()).toBe(folder());
    await expect(
      fs.readFile(path.join(folder(), "tidy-notes", "SKILL.md"), "utf8"),
    ).resolves.toContain("description: tidy-notes");
    await expect(fs.readdir(hiddenDir())).rejects.toThrow();
  });

  it("leaves a Skills folder the person already made alone", async () => {
    await writeSkill(hiddenDir(), "hidden-one");
    await writeSkill(folder(), "theirs");

    const moved = await moveSkillsToFolder(root);

    expect(moved).toEqual({ kind: "already-there", where: folder() });
    // Never merged over: what they wrote stays, and the hidden one stays
    // put rather than being half-emptied into it.
    expect((await fs.readdir(folder())).toSorted()).toEqual(["theirs"]);
    expect(await fs.readdir(hiddenDir())).toEqual(["hidden-one"]);
  });

  it("does nothing for a workspace with no skills hidden away", async () => {
    expect(await moveSkillsToFolder(root)).toEqual({ kind: "none" });

    await fs.mkdir(hiddenDir(), { recursive: true });
    expect(await moveSkillsToFolder(root)).toEqual({ kind: "none" });
  });

  it("finds nothing to move on a second launch", async () => {
    await writeSkill(hiddenDir(), "tidy-notes");
    await moveSkillsToFolder(root);

    expect(await moveSkillsToFolder(root)).toEqual({ kind: "none" });
    expect(await fs.readdir(folder())).toEqual(["tidy-notes"]);
  });
});
