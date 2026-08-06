import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { WorkspaceDirSchema } from "../../schemas/paths";
import {
  createMockTaskConfigForDir,
  MOCK_WORKSPACE_DIRS,
} from "../../test/helpers/mock-task-config";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createValidateSkillCommand } from "./validate-skill";

createMockTaskConfigForDir(`${MOCK_WORKSPACE_DIRS.tasks}/validate-skill`);

// The shared mock workspace root is a real directory on disk, so skills written
// there would be discovered by every other test file's process too. This suite
// writes skills, so it needs a root of its own.
const rootDir = mkdtempSync(path.join(os.tmpdir(), "validate-skill-cmd-"));
setWorkspaceConfig({
  ...getWorkspaceConfig(),
  rootDir: WorkspaceDirSchema.parse(rootDir),
});

const mockCtx = createCommandContext({
  cwd: "/",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
});

const run = (...args: string[]) =>
  createValidateSkillCommand().execute(args, mockCtx);

const skillsDir = path.join(rootDir, "skills");

// The command runs discovery over every source, and `getSkillSources` derives a
// dozen of them from the home directory. Left real, this suite walks whatever
// agent skills the machine happens to have installed -- slow enough to outrun
// the test timeout under a loaded run, and a result that differs per developer.
beforeAll(() => {
  vi.spyOn(os, "homedir").mockReturnValue(path.join(rootDir, "home"));
});

afterAll(() => {
  vi.restoreAllMocks();
});

afterEach(async () => {
  await fs.rm(skillsDir, { force: true, recursive: true });
});

async function writeSkill(name: string, contents: string) {
  await fs.mkdir(path.join(skillsDir, name), { recursive: true });
  await fs.writeFile(path.join(skillsDir, name, "SKILL.md"), contents);
}

describe("createValidateSkillCommand", () => {
  it.each([
    "/mnt/documents/some-skill",
    "../../etc/passwd",
    "/task/work/skills/loaded",
    "nested/name",
    "/skills",
  ])("refuses %j, which is not a workspace skill", async (argument) => {
    const result = await run(argument);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "validate-skill: only skills under /skills/ can be checked.\n",
    );
  });

  it("accepts a bare name and the mounted path for the same skill", async () => {
    await writeSkill(
      "tidy",
      "---\nname: tidy\ndescription: Tidy things. Use when asked to tidy.\n---\n\nBody.\n",
    );
    const byName = await run("tidy");
    const byPath = await run("/skills/tidy/");
    expect(byName).toEqual(byPath);
    expect(byName.exitCode).toBe(0);
    expect(byName.stdout).toContain("tidy: ok");
  });

  it("exits non-zero on an error and zero on warnings alone", async () => {
    await writeSkill("broken", "no frontmatter here");
    await writeSkill(
      "Tidy_Up",
      "---\nname: Tidy_Up\ndescription: Does a thing. Use when asked.\n---\n\nBody.\n",
    );

    const failed = await run("broken");
    expect(failed.exitCode).toBe(1);

    const warned = await run("Tidy_Up");
    expect(warned.exitCode).toBe(0);
    expect(warned.stdout).toContain("name-not-kebab-case");
  });

  it("names a skill that is not there", async () => {
    const result = await run("ghost");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      'validate-skill: no skill named "ghost" in /skills/.\n',
    );
  });

  it("checks every workspace skill when given no name", async () => {
    await writeSkill("alpha", "not a skill");
    await writeSkill("beta", "also not a skill");
    const result = await run();
    expect(result.stdout).toContain("alpha:");
    expect(result.stdout).toContain("beta:");
    expect(result.exitCode).toBe(1);
  });
});
