import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { withTempDir } from "../test/helpers/temp-dir";
import { runtimeLayout } from "./runtime-dir";
import {
  ensureNodeEnvironment,
  ensurePythonEnvironment,
  pythonEnvironmentOf,
  skillPythonToRun,
  trustedSkillFolder,
} from "./skill-environments";
import { venvPython } from "./uv";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { workspaceLayout } from "./workspace-layout";

vi.mock(import("./run-uv"));
vi.mock(import("./run-pnpm"));

const root = withTempDir("skill-environments");

function write(file: string, contents = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function runtime() {
  return runtimeLayout(path.join(root.path, "runtime"));
}

/** A skill in the runtime folder's `skills/`, as the app ships one. */
function shippedSkill(name: string, files: Record<string, string>) {
  const dir = path.join(runtime().skills, name);
  write(path.join(dir, "SKILL.md"), `---\nname: ${name}\n---\n`);
  for (const [file, contents] of Object.entries(files)) {
    write(path.join(dir, file), contents);
  }
  return AbsolutePathSchema.parse(dir);
}

const PYTHON_SKILL = {
  "pyproject.toml": "[project]\nname = 'x'\n",
  "scripts/run.py": "print(1)",
  "uv.lock": "version = 1\n",
};

let chatId: ReturnType<typeof createMockChatConfig>;

beforeEach(async () => {
  vi.clearAllMocks();
  chatId = createMockChatConfig(ChatIdSchema.parse("skill-environments"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(path.join(root.path, "workspace")),
    runtimeDir: AbsolutePathSchema.parse(path.join(root.path, "runtime")),
  });
  const { ensureManagedPython, runUvCommand } = await import("./run-uv");
  vi.mocked(ensureManagedPython).mockResolvedValue(undefined);
  // uv as far as the environment's shape goes: the venv's interpreter and
  // config, and one requirement exported.
  vi.mocked(runUvCommand).mockImplementation(({ args }) => {
    if (args[0] === "venv") {
      const venv = AbsolutePathSchema.parse(args.at(-1));
      write(venvPython(venv), "");
      write(path.join(venv, "pyvenv.cfg"), "relocatable = true\n");
    }
    return Promise.resolve({
      combined: "",
      exitCode: 0,
      stdout: args[0] === "export" ? "pypdf==6.0\n" : "",
    });
  });
});

describe("pythonEnvironmentOf", () => {
  it("names one environment per lockfile, whichever skill holds it", () => {
    const pdf = shippedSkill("pdf", PYTHON_SKILL);
    const twin = shippedSkill("twin", PYTHON_SKILL);
    const other = shippedSkill("other", {
      ...PYTHON_SKILL,
      "uv.lock": "version = 2\n",
    });

    expect(path.dirname(pythonEnvironmentOf(pdf) ?? "")).toBe(
      runtime().environments,
    );
    expect(pythonEnvironmentOf(twin)).toBe(pythonEnvironmentOf(pdf));
    expect(pythonEnvironmentOf(other)).not.toBe(pythonEnvironmentOf(pdf));
  });

  it("names none for a skill without a locked Python project", () => {
    expect(
      pythonEnvironmentOf(shippedSkill("page", { "scripts/a.ts": "" })),
    ).toBeUndefined();
    expect(
      pythonEnvironmentOf(
        shippedSkill("unlocked", { "pyproject.toml": "[project]\n" }),
      ),
    ).toBeUndefined();
  });
});

describe("ensurePythonEnvironment", () => {
  it("builds the environment once, held to the chat with only its folder opened", async () => {
    const { runUvCommand } = await import("./run-uv");
    const skillDir = shippedSkill("pdf", PYTHON_SKILL);
    const target = pythonEnvironmentOf(skillDir);

    const [first, second] = await Promise.all([
      ensurePythonEnvironment({ chatId, skillDir }),
      ensurePythonEnvironment({ chatId, skillDir }),
    ]);
    const third = await ensurePythonEnvironment({ chatId, skillDir });

    expect([first, second, third]).toEqual([
      { venv: target },
      { venv: target },
      { venv: target },
    ]);
    expect(fs.existsSync(venvPython(AbsolutePathSchema.parse(target)))).toBe(
      true,
    );
    // Nothing of the build is left beside it.
    expect(fs.readdirSync(runtime().environments)).toEqual([
      path.basename(target ?? ""),
    ]);
    const calls = vi.mocked(runUvCommand).mock.calls.map(([call]) => ({
      args: call.args.map((arg) =>
        arg
          .replace(skillDir, "<skill>")
          .replace(/\/\.[0-9a-f]+\.building-[^/]+/, "/<staging>")
          .replace(runtime().environments, "<environments>"),
      ),
      lockfilePinned: call.lockfilePinned,
      stdin: call.stdin,
      writable: call.writable?.map((dir) =>
        dir.replace(/\/\.[0-9a-f]+\.building-[^/]+/, "/<staging>"),
      ),
    }));
    expect(calls).toEqual([
      {
        args: [
          "venv",
          "--relocatable",
          "--python",
          "3.12",
          "<environments>/<staging>",
        ],
        lockfilePinned: true,
        stdin: undefined,
        writable: [`${runtime().environments}/<staging>`],
      },
      {
        args: [
          "export",
          "--locked",
          "--no-dev",
          "--no-emit-project",
          "--no-hashes",
          "--project",
          "<skill>",
        ],
        lockfilePinned: true,
        stdin: undefined,
        writable: [`${runtime().environments}/<staging>`],
      },
      {
        args: [
          "pip",
          "install",
          "--compile-bytecode",
          "--python",
          path.join(
            "<environments>/<staging>",
            path.relative(
              "/venv",
              venvPython(AbsolutePathSchema.parse("/venv")),
            ),
          ),
          "--requirement",
          "-",
        ],
        lockfilePinned: true,
        stdin: "pypdf==6.0\n",
        writable: [`${runtime().environments}/<staging>`],
      },
    ]);
  });

  it("reports a failed export and leaves no environment behind", async () => {
    const { runUvCommand } = await import("./run-uv");
    const skillDir = shippedSkill("pdf", PYTHON_SKILL);
    vi.mocked(runUvCommand).mockImplementation(({ args }) =>
      Promise.resolve(
        args[0] === "export"
          ? { combined: "lockfile is stale", exitCode: 2, stdout: "" }
          : { combined: "", exitCode: 0, stdout: "" },
      ),
    );

    await expect(
      ensurePythonEnvironment({ chatId, skillDir }),
    ).resolves.toEqual({
      error: { exitCode: 2, output: "lockfile is stale" },
    });
    expect(fs.readdirSync(runtime().environments)).toEqual([]);
  });

  it("builds again an environment whose Python is gone", async () => {
    const { runUvCommand } = await import("./run-uv");
    const skillDir = shippedSkill("pdf", PYTHON_SKILL);
    const target = AbsolutePathSchema.parse(pythonEnvironmentOf(skillDir));
    write(venvPython(target), "");
    write(
      path.join(target, "pyvenv.cfg"),
      `home = ${path.join(root.path, "gone")}\n`,
    );

    await expect(
      ensurePythonEnvironment({ chatId, skillDir }),
    ).resolves.toEqual({ venv: target });
    expect(runUvCommand).toHaveBeenCalledTimes(3);
    expect(fs.readFileSync(path.join(target, "pyvenv.cfg"), "utf8")).toBe(
      "relocatable = true\n",
    );
  });
});

describe("ensureNodeEnvironment", () => {
  it("builds one copy per version of the skill, with its packages beside it", async () => {
    const { runPnpmCommand } = await import("./run-pnpm");
    vi.mocked(runPnpmCommand).mockResolvedValue({
      command: "pnpm install --prod",
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    const skillDir = shippedSkill("sharp-images", {
      "SKILL.template.md": "",
      "package.json": `{"dependencies":{"sharp":"^0.35.0"}}`,
      "scripts/resize.ts": "",
      "tests/resize.test.ts": "",
    });

    const built = await ensureNodeEnvironment({ chatId, skillDir });
    if (!("dir" in built)) {
      throw new Error(built.error.output);
    }

    expect(path.dirname(built.dir)).toBe(runtime().environments);
    expect(fs.readdirSync(built.dir).toSorted()).toEqual([
      "SKILL.md",
      "node_modules",
      "package.json",
      "scripts",
    ]);
    expect(vi.mocked(runPnpmCommand).mock.calls[0]?.[0]).toMatchObject({
      args: ["install", "--prod"],
      chatId,
    });
    await expect(ensureNodeEnvironment({ chatId, skillDir })).resolves.toEqual(
      built,
    );
    expect(runPnpmCommand).toHaveBeenCalledTimes(1);

    write(path.join(skillDir, "scripts", "crop.ts"), "");
    const next = await ensureNodeEnvironment({ chatId, skillDir });
    expect(next).not.toEqual(built);
  });
});

describe("trustedSkillFolder", () => {
  it.each([
    ["a skill the app ships", () => path.join(runtime().skills, "pdf")],
    [
      "a Node skill's built copy",
      () => path.join(runtime().environments, "0123456789abcdef"),
    ],
    [
      "one of the workspace's skills",
      () =>
        path.join(
          workspaceLayout(path.join(root.path, "workspace")).skillsDir,
          "mine",
        ),
    ],
  ])("finds %s from a script inside it", (_, folder) => {
    expect(trustedSkillFolder(path.join(folder(), "scripts", "x.py"))).toBe(
      folder(),
    );
  });

  it("finds none outside them", () => {
    expect(
      trustedSkillFolder(
        path.join(root.path, "home", ".claude", "skills", "x"),
      ),
    ).toBeUndefined();
    expect(trustedSkillFolder(runtime().skills)).toBeUndefined();
  });
});

describe("skillPythonToRun", () => {
  it("runs a script in the environment of the skill that holds it", async () => {
    const skillDir = shippedSkill("pdf", PYTHON_SKILL);

    await expect(
      skillPythonToRun({
        chatId,
        cwd: root.path,
        loadedSkillDir: undefined,
        script: path.join(skillDir, "scripts", "run.py"),
      }),
    ).resolves.toEqual({ venv: pythonEnvironmentOf(skillDir) });
  });

  it("runs other code in the loaded skill's environment until a .venv is near", async () => {
    const skillDir = shippedSkill("pdf", PYTHON_SKILL);
    const cwd = path.join(root.path, "machine", "work", "skill-environments");
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      workFoldersDir: AbsolutePathSchema.parse(path.dirname(cwd)),
    });
    const own = {
      chatId,
      cwd,
      loadedSkillDir: skillDir,
      script: path.join(cwd, "job", "mine.py"),
    };

    await expect(skillPythonToRun(own)).resolves.toEqual({
      venv: pythonEnvironmentOf(skillDir),
    });

    write(path.join(cwd, ".venv", "pyvenv.cfg"));
    await expect(skillPythonToRun(own)).resolves.toBeUndefined();
  });
});
