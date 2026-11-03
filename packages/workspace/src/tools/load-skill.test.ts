import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILLS_FOLDER_NAME } from "../constants";
import { REGISTRY_FOLDER_NAMES } from "../constants";
import { lastLoadedSkillDir } from "../lib/loaded-skill";
import { runtimeLayout } from "../lib/runtime-dir";
import { SKILL_CONTENT_LIMIT } from "../lib/skills";
import { getWorkspaceSkillsDir } from "../lib/workspace-skills-dir";
import { shellPath } from "../lib/workspace-fs-layout";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../lib/workspace-config";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { runTool } from "../test/helpers/run-tool";
import { LoadSkill } from "./load-skill";

vi.mock(import("../lib/skill-environments"));

const model = createMockAIGatewayModel();

/** The rendered text of a tool output, narrowed off the model-output union. */
function modelText(result: ReturnType<typeof LoadSkill.toModelOutput>) {
  if (result.type !== "text" || typeof result.value !== "string") {
    throw new TypeError(`Expected text output, got ${result.type}`);
  }
  return named(result.value);
}

/**
 * Names the workspace's skills folder, which is a temp dir here, as the
 * model reads it: by the shell's spelling of its path.
 */
function named(text: string) {
  return text
    .replaceAll(shellPath(getWorkspaceSkillsDir()), "<workspace skills>")
    .replaceAll(shellPath(preparedSkillsDir()), "<runtime skills>");
}

let tmpDir: string;
let dir: string;
let registryDir: string;
let skillsDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  tmpDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "load-skill-test-")),
  );
  vi.spyOn(os, "homedir").mockReturnValue(path.join(tmpDir, "home"));
  dir = path.join(tmpDir, "app");
  registryDir = path.join(tmpDir, "registry");
  skillsDir = path.join(registryDir, REGISTRY_FOLDER_NAMES.skills);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(skillsDir, { recursive: true });
  const { ensureNodeEnvironment, ensurePythonEnvironment } =
    await import("../lib/skill-environments");
  vi.mocked(ensureNodeEnvironment).mockResolvedValue({
    dir: AbsolutePathSchema.parse(path.join(tmpDir, "runtime", "env-node")),
  });
  vi.mocked(ensurePythonEnvironment).mockResolvedValue({
    venv: AbsolutePathSchema.parse(path.join(tmpDir, "runtime", "env-py")),
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { force: true, recursive: true });
});

function baseExecuteArgs() {
  return {
    model,
    signal: AbortSignal.timeout(10_000),
    chatId: createTaskConfigWithDirs(),
  };
}

/** Loads a skill by name and returns its output, failing on an error. */
async function load(name: string) {
  return (
    await runTool(LoadSkill, {
      ...baseExecuteArgs(),
      input: { explanation: "loading", name },
    })
  )._unsafeUnwrap();
}

/** Loads a skill that must be found. */
async function loadFound(name: string) {
  const result = await load(name);
  if (result.state !== "success") {
    throw new Error(`Expected ${name} to load, got ${result.state}`);
  }
  return result;
}

/** Where the app prepares the skills it ships, which they are read from. */
function preparedSkillsDir() {
  return runtimeLayout(getWorkspaceConfig().runtimeDir).skills;
}

function preparedSkillDir(name: string) {
  return path.join(preparedSkillsDir(), name);
}

async function createSkill({
  description = "A test skill",
  extraFiles = {},
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

function createTaskConfigWithDirs() {
  // Point the singleton's tasksDir at dir's parent so chatDir(id) ===
  // dir, then also override the skill sources and the runtime folder the
  // shipped skills are prepared in.
  const id = createMockChatConfigForDir(dir, { model });
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    registryDir: AbsolutePathSchema.parse(registryDir),
    runtimeDir: AbsolutePathSchema.parse(path.join(tmpDir, "runtime")),
    systemSkillsDir: AbsolutePathSchema.parse(
      path.join(tmpDir, "system-skills"),
    ),
  });
  return id;
}

/** A successful output as stored, for rendering it. */
function successOutput(
  overrides: Partial<
    Extract<
      ReturnType<typeof LoadSkill.outputSchema.parse>,
      { state: "success" }
    >
  > = {},
) {
  return {
    content: "# Body",
    contentTruncated: false,
    files: [],
    name: "docx",
    origin: "instrument" as const,
    skillDir: "/runtime/skills/docx",
    skillName: "docx",
    state: "success" as const,
    truncated: false,
    ...overrides,
  };
}

describe("LoadSkill", () => {
  // The catalog this tool used to render lives in the session's context message
  // now, so installing or editing a skill mid-session cannot rewrite a tool
  // definition at the front of the prompt. A literal description is what
  // guarantees that: it has nothing to rediscover between requests. The
  // not-found path below is the recovery route for a name it does not carry.
  it("describes itself with a fixed string that points at the catalog", () => {
    expect(typeof LoadSkill.description).toBe("string");
    expect(LoadSkill.description).toContain("<available_skills>");
  });

  it("lists the skills there are when no skill answers to the name", async () => {
    await createSkill({ name: "existing-skill" });

    expect(await load("nonexistent")).toMatchInlineSnapshot(`
      {
        "available": [
          {
            "description": "A test skill",
            "name": "instrument:existing-skill",
          },
        ],
        "name": "nonexistent",
        "state": "not-found",
        "suggestions": [],
      }
    `);
  });

  it("reads a shipped skill whole, read-only, where the app prepared it, copying nothing into the work folder", async () => {
    await createSkill({
      extraFiles: { "scripts/run.ts": "console.log('hello')" },
      name: "my-skill",
    });

    expect(await load("my-skill")).toMatchObject({
      content: "# my-skill\n\nSkill instructions here.",
      contentTruncated: false,
      files: ["scripts/run.ts"],
      // The registry is not the writable workspace skills folder.
      origin: "instrument",
      skillDir: preparedSkillDir("my-skill"),
      state: "success",
    });
    await expect(
      fs.readFile(
        path.join(preparedSkillDir("my-skill"), "scripts", "run.ts"),
        "utf8",
      ),
    ).resolves.toBe("console.log('hello')");
    await expect(fs.readdir(dir)).resolves.toEqual([]);
  });

  it("names the skill's folder to the session's shell", async () => {
    await createSkill({ name: "my-skill" });
    const sessionId = StoreId.newSessionId();
    const args = baseExecuteArgs();

    await runTool(LoadSkill, {
      ...args,
      input: { explanation: "loading", name: "my-skill" },
      sessionId,
    });

    await expect(
      lastLoadedSkillDir({ chatId: args.chatId, sessionId }),
    ).resolves.toBe(preparedSkillDir("my-skill"));
  });

  it("lists the skill's files relative to its folder, leaving out what its development left", async () => {
    await createSkill({
      extraFiles: {
        ".gitignore": "build/\n",
        ".pytest_cache/v/cache": "cached",
        ".venv/bin/python": "python",
        "SKILL.template.md": "# Template",
        "build/generated.js": "generated",
        "node_modules/example/index.js": "module.exports = {}",
        "references/notes.md": "# Notes",
        "scripts/lib/helper.ts": "export const x = 1",
        "scripts/run.ts": "console.log('hello')",
        "tests/test_run.py": "def test_run(): pass",
        "vitest.config.ts": "export default {}",
      },
      name: "my-skill",
    });

    expect((await loadFound("my-skill")).files).toMatchInlineSnapshot(`
      [
        "references/notes.md",
        "scripts/lib/helper.ts",
        "scripts/run.ts",
      ]
    `);
  });

  it("resolves a name that only differs in case or is the frontmatter title", async () => {
    const skillDir = path.join(skillsDir, "docx");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---\nname: Word Documents\ndescription: "Writes .docx files"\n---\n\nSkill instructions here.`,
    );

    for (const name of ["DOCX", "Word Documents"]) {
      expect([name, (await loadFound(name)).name]).toEqual([
        name,
        "instrument:docx",
      ]);
    }
  });

  it("names the candidates when a plain name reaches several skills", async () => {
    for (const vendor of [".claude", ".cursor"]) {
      const vendorDir = path.join(tmpDir, "home", vendor, "skills", "review");
      await fs.mkdir(vendorDir, { recursive: true });
      await fs.writeFile(
        path.join(vendorDir, "SKILL.md"),
        `---\nname: review\ndescription: "Reviews ${vendor}"\n---\n\nInstructions.`,
      );
    }

    const result = await load("review");
    expect(result.state).toBe("not-found");
    const modelOutput = LoadSkill.toModelOutput({
      input: { explanation: "loading", name: "review" },
      output: result,
      toolCallId: "call-1",
    });
    expect(modelOutput.type).toBe("error-text");
    const text = modelOutput.type === "error-text" ? modelOutput.value : "";
    expect(text.split("\n\n")[1]).toMatchInlineSnapshot(
      `"Several skills answer to that name. Load one of them by its full name: claude:review, cursor:review."`,
    );
  });

  it("loads a shadowed namesake by its qualified name, from its own folder", async () => {
    await createSkill({ description: "Ours", name: "review" });
    const vendorSkillDir = path.join(
      tmpDir,
      "home",
      ".claude",
      "skills",
      "review",
    );
    await fs.mkdir(vendorSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(vendorSkillDir, "SKILL.md"),
      `---\nname: review\ndescription: "Theirs"\n---\n\nVendor instructions.`,
    );

    const result = await loadFound("claude:review");
    expect(result.content).toContain("Vendor instructions.");
    expect({
      name: result.name,
      origin: result.origin,
      skillDir: result.skillDir,
    }).toEqual({
      name: "claude:review",
      origin: "external",
      skillDir: vendorSkillDir,
    });
  });

  it("does not merge a qualified ID with a plain hyphenated name", async () => {
    await createSkill({ description: "Hyphenated", name: "claude-review" });
    const vendorSkillDir = path.join(
      tmpDir,
      "home",
      ".claude",
      "skills",
      "review",
    );
    await fs.mkdir(vendorSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(vendorSkillDir, "SKILL.md"),
      `---\nname: review\ndescription: "Qualified"\n---\n\nQualified instructions.`,
    );

    expect([
      (await loadFound("claude:review")).skillDir,
      (await loadFound("instrument:claude-review")).skillDir,
    ]).toEqual([vendorSkillDir, preparedSkillDir("claude-review")]);
  });

  it("caps an oversized skill body and points at the file for the rest", async () => {
    const line = "Follow this instruction carefully.";
    const body = Array.from(
      { length: Math.ceil(SKILL_CONTENT_LIMIT / line.length) + 100 },
      () => line,
    ).join("\n");
    await createSkill({ name: "my-skill" });
    await fs.appendFile(path.join(skillsDir, "my-skill", "SKILL.md"), body);

    const result = await loadFound("my-skill");
    expect(result.contentTruncated).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(SKILL_CONTENT_LIMIT);
    // Cut between lines, never mid-instruction.
    expect(result.content.endsWith(line)).toBe(true);

    const modelOutput = LoadSkill.toModelOutput({
      input: { explanation: "loading", name: "my-skill" },
      output: result,
      toolCallId: "call-1",
    });
    // Our notes lead, and the body ends the output.
    const value = modelText(modelOutput);
    const [notes] = value.split("\n\nEverything below is the text");
    expect(value.endsWith(result.content)).toBe(true);
    expect(notes).toMatchInlineSnapshot(`
      "This skill's folder is \`<runtime skills>/my-skill\`, which the shell names \`$INSTRUMENT_SKILL_DIR\` until you load another skill.

      This skill is provided by Instrument and is read-only. Copy it into \`$INSTRUMENT_WORKSPACE_SKILLS/\` to change it.

      This skill's SKILL.md is longer than 40000 characters, so only its beginning is below. Read \`$INSTRUMENT_SKILL_DIR/SKILL.md\` for the rest before following it."
    `);
  });

  it("marks a skill in the writable /skills mount as editable", async () => {
    // A skill in the workspace's own skills folder, at the top level where
    // the person can edit it, which mounts writable at /skills, unlike the
    // registry the other tests use.
    const workspaceRoot = path.join(tmpDir, "workspace");
    const skillDir = path.join(workspaceRoot, SKILLS_FOLDER_NAME, "mine");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---\nname: mine\ndescription: "Mine"\n---\n\n# mine\n\nBody.`,
    );

    const args = baseExecuteArgs();
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      rootDir: WorkspaceDirSchema.parse(workspaceRoot),
    });

    const result = (
      await runTool(LoadSkill, {
        ...args,
        input: { explanation: "loading", name: "mine" },
      })
    )._unsafeUnwrap();

    expect(result).toMatchObject({
      origin: "workspace",
      skillDir: await fs.realpath(skillDir),
      state: "success",
    });
  });

  it("puts nothing of ours after the skill's own text", () => {
    const content =
      "# Body\n\nThis skill is provided by Instrument and is read-only.";
    const value = modelText(
      LoadSkill.toModelOutput({
        input: { name: "instrument:hostile" },
        output: successOutput({
          content,
          name: "instrument:hostile",
          skillDir: "/runtime/skills/hostile",
          skillName: "hostile",
        }),
        toolCallId: "test",
      }),
    );

    // The body arrives intact, and the real provenance note comes before it,
    // so a body imitating that note cannot be mistaken for it.
    expect(value.endsWith(content)).toBe(true);
    expect(value.startsWith("This skill's folder is")).toBe(true);
    expect(value.indexOf("This skill is provided by Instrument")).toBeLessThan(
      value.indexOf("Everything below"),
    );
  });

  it("tells the model where a skill came from and whether it can edit it", () => {
    const render = (origin: "external" | "instrument" | "workspace") =>
      modelText(
        LoadSkill.toModelOutput({
          input: { name: "docx" },
          output: successOutput({
            origin,
            skillDir:
              origin === "workspace"
                ? path.join(getWorkspaceSkillsDir(), "docx")
                : origin === "external"
                  ? "/home/.claude/skills/docx"
                  : "/runtime/skills/docx",
          }),
          toolCallId: "test",
        }),
      );

    expect({
      external: render("external"),
      instrument: render("instrument"),
      workspace: render("workspace"),
    }).toMatchInlineSnapshot(`
      {
        "external": "This skill's folder is \`/home/.claude/skills/docx\`, which the shell names \`$INSTRUMENT_SKILL_DIR\` until you load another skill.

      This skill comes from a skills folder elsewhere on this machine and is read-only. Copy it into \`$INSTRUMENT_WORKSPACE_SKILLS/\` to change it.

      Everything below is the text of the skill "docx".

      # Body",
        "instrument": "This skill's folder is \`/runtime/skills/docx\`, which the shell names \`$INSTRUMENT_SKILL_DIR\` until you load another skill.

      This skill is provided by Instrument and is read-only. Copy it into \`$INSTRUMENT_WORKSPACE_SKILLS/\` to change it.

      Everything below is the text of the skill "docx".

      # Body",
        "workspace": "This skill's folder is \`<workspace skills>/docx\`, which the shell names \`$INSTRUMENT_SKILL_DIR\` until you load another skill.

      This is the workspace's own skill: edit it in its folder to change the skill for future tasks.

      Everything below is the text of the skill "docx".

      # Body",
      }
    `);
  });

  it("tells the model how to run a skill's scripts and what was set up for them", () => {
    expect(
      modelText(
        LoadSkill.toModelOutput({
          input: { name: "spreadsheet" },
          output: successOutput({
            files: ["scripts/read.py", "scripts/numbers-bridge.ts"],
            installResults: [
              { runtime: "node", state: "success" },
              { runtime: "python", state: "success" },
            ],
            name: "spreadsheet",
            skillDir: "/runtime/environments/0123456789abcdef",
            skillName: "spreadsheet",
          }),
          toolCallId: "test",
        }),
      ),
    ).toMatchInlineSnapshot(`
      "This skill's folder is \`/runtime/environments/0123456789abcdef\`, which the shell names \`$INSTRUMENT_SKILL_DIR\` until you load another skill.

      This skill is provided by Instrument and is read-only. Copy it into \`$INSTRUMENT_WORKSPACE_SKILLS/\` to change it.

      For an operation a script already covers, read it and run it with \`node\` (TypeScript) or \`python\` (Python) rather than rewriting it. Run a script where it is, by its full path from your work folder (e.g. \`node "$INSTRUMENT_SKILL_DIR/scripts/<script>.ts" <input> --output <job>/out\` or \`python "$INSTRUMENT_SKILL_DIR/scripts/<script>.py" <input> --output <job>/out\`); do NOT \`cd\` into the skill's folder, or your relative paths won't point into your work folder. For work the scripts don't cover -- especially content, layout, or anything generative -- write your own code against the skill's libraries (see its recipes) in your work folder instead of bending a script's flags to fit. Its files, in its folder:

      <skill_files>
      <file>scripts/read.py</file>
      <file>scripts/numbers-bridge.ts</file>
      </skill_files>

      Its Node.js packages are installed beside its scripts. Its folder is read-only, so a script of your own goes in your work folder, with what it imports added there (\`pnpm add <package>\`).

      Its Python packages are installed: \`python\` runs its scripts with them, and your own scripts too until you load another skill, so do not install them again. A package its instructions say to \`pip install\` for one use is not among them; installing it puts it in a \`.venv\` in your work folder, where its scripts find it as well as yours.

      Everything below is the text of the skill "spreadsheet".

      # Body"
    `);
  });

  it("builds a Python skill's environment from where the skill is read", async () => {
    const { ensurePythonEnvironment } =
      await import("../lib/skill-environments");
    await createSkill({
      extraFiles: {
        "pyproject.toml": "[project]\nname = 'python-skill'\n",
        "uv.lock": "version = 1\n",
      },
      name: "python-skill",
    });

    const args = {
      ...baseExecuteArgs(),
      input: { explanation: "loading", name: "python-skill" },
    };
    const result = (await runTool(LoadSkill, args))._unsafeUnwrap();

    expect(ensurePythonEnvironment).toHaveBeenCalledWith({
      chatId: args.chatId,
      signal: args.signal,
      skillDir: preparedSkillDir("python-skill"),
    });
    expect(result).toMatchObject({
      installResults: [{ runtime: "python", state: "success" }],
      skillDir: preparedSkillDir("python-skill"),
      state: "success",
    });
  });

  it.each<{
    extraFiles: Record<string, string>;
    message: string;
    name: string;
  }>([
    {
      extraFiles: { "pyproject.toml": "[project]\nname = 'x'\n" },
      message:
        'Skill "refused" is missing uv.lock for its Python dependencies.',
      name: "a Python skill without a lockfile",
    },
    {
      extraFiles: { "package.json": "{" },
      message: 'Skill "refused" has an invalid package.json.',
      name: "an unparsable package.json",
    },
    {
      extraFiles: { "package.json": JSON.stringify({ dependencies: [] }) },
      message:
        'Skill "refused" has an invalid dependencies field in package.json.',
      name: "dependencies that are not an object",
    },
    {
      extraFiles: {
        "package.json": JSON.stringify({
          optionalDependencies: { example: 1 },
        }),
      },
      message:
        'Skill "refused" has an invalid optionalDependencies field in package.json.',
      name: "a dependency version that is not a string",
    },
  ])(
    "refuses $name before setting anything up",
    async ({ extraFiles, message }) => {
      const { ensureNodeEnvironment, ensurePythonEnvironment } =
        await import("../lib/skill-environments");
      await createSkill({ extraFiles, name: "refused" });

      const result = await runTool(LoadSkill, {
        ...baseExecuteArgs(),
        input: { explanation: "loading", name: "refused" },
      });

      expect(result._unsafeUnwrapErr().message).toBe(message);
      expect(ensureNodeEnvironment).not.toHaveBeenCalled();
      expect(ensurePythonEnvironment).not.toHaveBeenCalled();
    },
  );

  it("does not install Node dependencies for a development-only manifest", async () => {
    const { ensureNodeEnvironment } = await import("../lib/skill-environments");
    await createSkill({
      extraFiles: {
        "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
      },
      name: "metadata-only",
    });

    expect(await loadFound("metadata-only")).not.toHaveProperty(
      "installResults",
    );
    expect(ensureNodeEnvironment).not.toHaveBeenCalled();
  });

  it("runs a mixed skill from its Node copy, with its Python environment built from the skill", async () => {
    const { ensureNodeEnvironment, ensurePythonEnvironment } =
      await import("../lib/skill-environments");
    await createSkill({
      extraFiles: {
        "package.json": JSON.stringify({
          dependencies: { example: "1.0.0" },
        }),
        "pyproject.toml": "[project]\nname = 'mixed-skill'\n",
        "uv.lock": "version = 1\n",
      },
      name: "mixed-skill",
    });

    const result = await load("mixed-skill");

    expect(vi.mocked(ensureNodeEnvironment).mock.lastCall?.[0]).toMatchObject({
      skillDir: preparedSkillDir("mixed-skill"),
    });
    expect(vi.mocked(ensurePythonEnvironment).mock.lastCall?.[0]).toMatchObject(
      { skillDir: preparedSkillDir("mixed-skill") },
    );
    expect(result).toMatchObject({
      installResults: [
        { runtime: "node", state: "success" },
        { runtime: "python", state: "success" },
      ],
      skillDir: path.join(tmpDir, "runtime", "env-node"),
      state: "success",
    });
  });

  it("reads a Node skill where it is when its packages could not be installed", async () => {
    const { ensureNodeEnvironment } = await import("../lib/skill-environments");
    vi.mocked(ensureNodeEnvironment).mockResolvedValueOnce({
      error: { exitCode: 1, output: "ERR_PNPM_FETCH_404" },
    });
    await createSkill({
      extraFiles: {
        "package.json": JSON.stringify({ dependencies: { example: "1.0.0" } }),
      },
      name: "node-skill",
    });

    expect(await load("node-skill")).toMatchObject({
      installResults: [
        {
          exitCode: 1,
          output: "ERR_PNPM_FETCH_404",
          runtime: "node",
          state: "failure",
        },
      ],
      skillDir: preparedSkillDir("node-skill"),
    });
  });

  it("skips dependency installs for a third-party skill", async () => {
    const { ensureNodeEnvironment, ensurePythonEnvironment } =
      await import("../lib/skill-environments");

    // A skill discovered in another tool's home folder, not the registry or the
    // writable workspace mount, so its origin is "external".
    const externalSkillDir = path.join(
      tmpDir,
      "home",
      ".claude",
      "skills",
      "third-party",
    );
    await fs.mkdir(externalSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(externalSkillDir, "SKILL.md"),
      `---\nname: third-party\ndescription: "External"\n---\n\n# third-party\n\nBody.`,
    );
    await fs.writeFile(
      path.join(externalSkillDir, "package.json"),
      JSON.stringify({ dependencies: { example: "1.0.0" } }),
    );
    await fs.writeFile(
      path.join(externalSkillDir, "pyproject.toml"),
      "[project]\nname = 'third-party'\n",
    );
    await fs.writeFile(path.join(externalSkillDir, "uv.lock"), "version = 1\n");

    const result = await load("third-party");

    expect(ensureNodeEnvironment).not.toHaveBeenCalled();
    expect(ensurePythonEnvironment).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      installResults: [
        { runtime: "node", state: "skipped" },
        { runtime: "python", state: "skipped" },
      ],
      origin: "external",
      state: "success",
    });
  });

  it("tells the model that a third-party skill's dependencies were not installed", () => {
    const value = modelText(
      LoadSkill.toModelOutput({
        input: { name: "third-party" },
        output: successOutput({
          installResults: [
            { runtime: "node", state: "skipped" },
            { runtime: "python", state: "skipped" },
          ],
          name: "third-party",
          origin: "external",
          skillDir: "/home/.claude/skills/third-party",
          skillName: "third-party",
        }),
        toolCallId: "test",
      }),
    );

    expect(value).toMatchInlineSnapshot(`
      "This skill's folder is \`/home/.claude/skills/third-party\`, which the shell names \`$INSTRUMENT_SKILL_DIR\` until you load another skill.

      This skill comes from a skills folder elsewhere on this machine and is read-only. Copy it into \`$INSTRUMENT_WORKSPACE_SKILLS/\` to change it.

      This skill declares Node.js dependencies, but Instrument did not set them up because the skill comes from a third-party skills folder on this machine. Review the skill first; if you trust it, copy it into a folder in your work folder, run \`pnpm install\` there, and run the copy's scripts.

      This skill declares Python dependencies, but Instrument did not set them up because the skill comes from a third-party skills folder on this machine. Review the skill first; if you trust it, copy it into a folder in your work folder, install the packages its \`pyproject.toml\` lists with \`pip install\`, and run the copy's scripts.

      Everything below is the text of the skill "third-party".

      # Body"
    `);
  });
});
