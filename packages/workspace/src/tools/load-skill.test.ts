import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  APP_FOLDER_NAMES,
  REGISTRY_FOLDER_NAMES,
} from "../constants";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../lib/workspace-config";
import {
  AbsolutePathSchema,
} from "../schemas/paths";
import {
  createMockAIGatewayModel,
} from "../test/helpers/mock-ai-gateway-model";
import {
  createMockAppConfigForDir,
} from "../test/helpers/mock-app-config";
import {
  runTool,
} from "../test/helpers/run-tool";
import {
  LoadSkill,
} from "./load-skill";

const model = createMockAIGatewayModel();

let tmpDir: string;
let dir: string;
let registryDir: string;
let skillsDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "load-skill-test-"));
  dir = path.join(tmpDir, "app");
  registryDir = path.join(tmpDir, "registry");
  skillsDir = path.join(registryDir, REGISTRY_FOLDER_NAMES.skills);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(skillsDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

function baseExecuteArgs() {
  return {
    agentName: "main" as const,
    appConfig: createAppConfigWithDirs(),
    model,
    projectState: {},
    signal: AbortSignal.timeout(10_000),
    spawnAgent: vi.fn(),
  };
}

function createAppConfigWithDirs() {
  // Point the singleton's projectsDir at dir's parent so taskDir(id) ===
  // dir, then also override registryDir for skill resolution.
  const id = createMockAppConfigForDir(dir, { model });
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    registryDir: AbsolutePathSchema.parse(registryDir),
  });
  return id;
}

async function createSkill({
  description = "A test skill",
  extraFiles = {} as Record<string, string>,
  name,
}: {
  description?: string;
  extraFiles?: Record<string, string>;
  name: string;
}) {
  const skillDir = path.join(skillsDir, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n\nSkill instructions here.`,
  );
  for (const [relPath, content] of Object.entries(extraFiles)) {
    const fullPath = path.join(skillDir, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
  }
}

/* eslint-disable unicorn/no-await-expression-member */
describe("LoadSkill", () => {
  it("returns not-found state when skill does not exist", async () => {
    await createSkill({ name: "existing-skill" });

    const result = (
      await runTool(LoadSkill, {
        ...baseExecuteArgs(),
        input: { explanation: "loading", name: "nonexistent" },
      })
    )._unsafeUnwrap();

    expect(result.state).toBe("not-found");
    expect(result).toMatchInlineSnapshot(`
      {
        "available": [
          {
            "description": "A test skill",
            "name": "existing-skill",
          },
        ],
        "name": "nonexistent",
        "state": "not-found",
      }
    `);
  });

  it("copies skill directory to skills/<name> on load", async () => {
    await createSkill({
      extraFiles: { "scripts/run.ts": "console.log('hello')" },
      name: "my-skill",
    });

    await runTool(LoadSkill, {
      ...baseExecuteArgs(),
      input: { explanation: "loading", name: "my-skill" },
    });

    const destBase = path.join(dir, APP_FOLDER_NAMES.skills, "my-skill");
    const md = await fs.readFile(path.join(destBase, "SKILL.md"), "utf8");
    expect(md).toMatchInlineSnapshot(`
      "---
      name: my-skill
      description: "A test skill"
      ---

      # my-skill

      Skill instructions here."
    `);

    const script = await fs.readFile(
      path.join(destBase, "scripts", "run.ts"),
      "utf8",
    );
    expect(script).toMatchInlineSnapshot(`"console.log('hello')"`);
  });

  it("includes relative file paths in files array", async () => {
    await createSkill({
      extraFiles: {
        "references/notes.md": "# Notes",
        "scripts/lib/helper.ts": "export const x = 1",
        "scripts/run.ts": "console.log('hello')",
      },
      name: "my-skill",
    });

    const result = (
      await runTool(LoadSkill, {
        ...baseExecuteArgs(),
        input: { explanation: "loading", name: "my-skill" },
      })
    )._unsafeUnwrap();

    expect(result.state).toBe("success");
    if (result.state !== "success") {
      return;
    }
    expect(result.files).toMatchInlineSnapshot(`
      [
        "skills/my-skill/references/notes.md",
        "skills/my-skill/scripts/lib/helper.ts",
        "skills/my-skill/scripts/run.ts",
      ]
    `);
  });

  it("returns an error and does not re-copy if destination already exists", async () => {
    await createSkill({
      extraFiles: { "scripts/run.ts": "original" },
      name: "my-skill",
    });

    const args = {
      ...baseExecuteArgs(),
      input: { explanation: "loading", name: "my-skill" },
    };

    await runTool(LoadSkill, args);

    const destScript = path.join(
      dir,
      APP_FOLDER_NAMES.skills,
      "my-skill",
      "scripts",
      "run.ts",
    );

    await fs.writeFile(destScript, "modified");

    const result = await runTool(LoadSkill, args);

    const fileContent = await fs.readFile(destScript, "utf8");
    expect(fileContent).toMatchInlineSnapshot(`"modified"`);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toMatchInlineSnapshot(
      `"Skill "my-skill" is already loaded. Read skills/my-skill/SKILL.md if you haven't yet -- do not read other files in that folder unless the skill instructs you to."`,
    );
  });

  it("returns skill content in content field", async () => {
    await createSkill({ name: "my-skill" });

    const result = (
      await runTool(LoadSkill, {
        ...baseExecuteArgs(),
        input: { explanation: "loading", name: "my-skill" },
      })
    )._unsafeUnwrap();

    expect(result.state).toBe("success");
    if (result.state !== "success") {
      return;
    }
    expect(result.content).toMatchInlineSnapshot(`
      "# my-skill

      Skill instructions here."
    `);
  });

  it("returns empty files array when skill has no extra files", async () => {
    await createSkill({ name: "my-skill" });

    const result = (
      await runTool(LoadSkill, {
        ...baseExecuteArgs(),
        input: { explanation: "loading", name: "my-skill" },
      })
    )._unsafeUnwrap();

    expect(result.state).toBe("success");
    if (result.state !== "success") {
      return;
    }
    expect(result.files).toMatchInlineSnapshot(`[]`);
  });
});
/* eslint-enable unicorn/no-await-expression-member */
