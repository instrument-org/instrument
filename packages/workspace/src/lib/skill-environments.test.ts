import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { SKILLS_FOLDER_NAME } from "../constants";
import { ChatIdSchema } from "../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { withTempDir } from "../test/helpers/temp-dir";
import { runtimeLayout } from "./runtime-dir";
import {
  ensureNodeEnvironment,
  ensurePythonEnvironment,
  pythonEnvironmentOf,
  pythonLayerEnv,
  skillPythonToRun,
  trustedSkillFolder,
} from "./skill-environments";
import { venvPython, venvSitePackages } from "./uv";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

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

/** A skill in the workspace's own `.instrument/skills/`, which any chat can change. */
function workspaceSkill(name: string, files: Record<string, string>) {
  const dir = path.join(
    path.join(path.join(root.path, "workspace"), SKILLS_FOLDER_NAME),
    name,
  );
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
  it("names one environment per lockfile, whichever skill holds it", async () => {
    const pdf = shippedSkill("pdf", PYTHON_SKILL);
    const twin = shippedSkill("twin", PYTHON_SKILL);
    const other = shippedSkill("other", {
      ...PYTHON_SKILL,
      "uv.lock": "version = 2\n",
    });

    expect(path.dirname((await pythonEnvironmentOf(pdf)) ?? "")).toBe(
      runtime().environments,
    );
    expect(await pythonEnvironmentOf(twin)).toBe(
      await pythonEnvironmentOf(pdf),
    );
    expect(await pythonEnvironmentOf(other)).not.toBe(
      await pythonEnvironmentOf(pdf),
    );
  });

  // A chat can write the workspace's skills, so one of them locking what a
  // shipped skill locks still never names the shipped skill's environment.
  it("names the workspace's own skills' environments apart from the shipped ones'", async () => {
    const pdf = shippedSkill("pdf", PYTHON_SKILL);
    const mine = workspaceSkill("mine", PYTHON_SKILL);

    expect(path.basename((await pythonEnvironmentOf(mine)) ?? "")).toMatch(
      /^[0-9a-f]{16}$/,
    );
    expect(path.basename((await pythonEnvironmentOf(pdf)) ?? "")).toMatch(
      /^shipped-[0-9a-f]{16}$/,
    );
  });

  it("takes a Node skill's built copy for a shipped skill's only by the name the app gives one", async () => {
    const pdf = shippedSkill("pdf", PYTHON_SKILL);
    const mine = workspaceSkill("mine", PYTHON_SKILL);
    const copy = (name: string) => {
      const dir = path.join(runtime().environments, name);
      for (const [file, contents] of Object.entries(PYTHON_SKILL)) {
        write(path.join(dir, file), contents);
      }
      return dir;
    };

    expect(await pythonEnvironmentOf(copy("shipped-0123456789abcdef"))).toBe(
      await pythonEnvironmentOf(pdf),
    );
    expect(await pythonEnvironmentOf(copy("0123456789abcdef"))).toBe(
      await pythonEnvironmentOf(mine),
    );
  });

  it("reads the lockfile off the main thread", async () => {
    const pdf = shippedSkill("pdf", PYTHON_SKILL);
    const readSync = vi.spyOn(fs, "readFileSync");
    const read = vi.spyOn(fs.promises, "readFile");
    onTestFinished(() => {
      readSync.mockRestore();
      read.mockRestore();
    });

    expect(await pythonEnvironmentOf(pdf)).toBeDefined();
    expect(read).toHaveBeenCalledWith(path.join(pdf, "uv.lock"), "utf8");
    expect(readSync).not.toHaveBeenCalled();
  });

  it("names none for a skill without a locked Python project", async () => {
    expect(
      await pythonEnvironmentOf(shippedSkill("page", { "scripts/a.ts": "" })),
    ).toBeUndefined();
    expect(
      await pythonEnvironmentOf(
        shippedSkill("unlocked", { "pyproject.toml": "[project]\n" }),
      ),
    ).toBeUndefined();
  });
});

describe("ensurePythonEnvironment", () => {
  it("builds the environment once, hash-checked from the build folders, held to the chat with only its folder opened", async () => {
    const { runUvCommand } = await import("./run-uv");
    const skillDir = shippedSkill("pdf", PYTHON_SKILL);
    const target = await pythonEnvironmentOf(skillDir);

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
    // Nothing of the build is left beside it, only the folder that layers
    // an environment under another.
    const [layerDir, ...others] = fs
      .readdirSync(runtime().environments)
      .filter((entry) => entry !== path.basename(target ?? ""));
    expect(others).toEqual([]);
    expect(
      fs.readdirSync(path.join(runtime().environments, layerDir ?? "")),
    ).toEqual(["sitecustomize.py"]);
    // The staging folder's name, by either separator, as Windows spells it
    // with a backslash.
    const staging = /[\\/]\.(?:shipped-)?[0-9a-f]+\.building-[^\\/]+/;
    const calls = vi.mocked(runUvCommand).mock.calls.map(([call]) => ({
      args: call.args.map((arg) =>
        arg
          .replace(skillDir, "<skill>")
          .replace(staging, `${path.sep}<staging>`)
          .replace(runtime().environments, "<environments>"),
      ),
      buildFolders: call.buildFolders,
      lockfilePinned: call.lockfilePinned,
      stdin: call.stdin,
      writable: call.writable?.map((dir) =>
        dir.replace(staging, `${path.sep}<staging>`),
      ),
    }));
    expect(calls).toEqual([
      {
        args: [
          "venv",
          "--relocatable",
          "--python",
          "3.12",
          path.join("<environments>", "<staging>"),
        ],
        buildFolders: true,
        lockfilePinned: true,
        stdin: undefined,
        writable: [path.join(runtime().environments, "<staging>")],
      },
      {
        args: [
          "export",
          "--locked",
          "--no-dev",
          "--no-emit-project",
          "--project",
          "<skill>",
        ],
        buildFolders: true,
        lockfilePinned: true,
        stdin: undefined,
        writable: [path.join(runtime().environments, "<staging>")],
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
          "--require-hashes",
          "--requirement",
          "-",
        ],
        buildFolders: true,
        lockfilePinned: true,
        stdin: "pypdf==6.0\n",
        writable: [path.join(runtime().environments, "<staging>")],
      },
    ]);
  });

  it("builds a workspace skill's environment as the chat's own installs are, never from the build folders", async () => {
    const { runUvCommand } = await import("./run-uv");
    const skillDir = workspaceSkill("mine", PYTHON_SKILL);

    await expect(
      ensurePythonEnvironment({ chatId, skillDir }),
    ).resolves.toEqual({ venv: await pythonEnvironmentOf(skillDir) });
    expect(
      vi.mocked(runUvCommand).mock.calls.map(([call]) => call.buildFolders),
    ).toEqual([false, false, false]);
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
    const target = AbsolutePathSchema.parse(
      await pythonEnvironmentOf(skillDir),
    );
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
      args: ["install", "--prod", "--frozen-lockfile"],
      buildFolders: true,
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

  it("builds a workspace skill's copy apart from a shipped one's, as the chat's own installs are", async () => {
    const { runPnpmCommand } = await import("./run-pnpm");
    vi.mocked(runPnpmCommand).mockResolvedValue({
      command: "pnpm install --prod --frozen-lockfile",
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    const files = { "package.json": `{"dependencies":{"cac":"^6.7.14"}}` };
    const shipped = await ensureNodeEnvironment({
      chatId,
      skillDir: shippedSkill("zip", files),
    });
    const mine = await ensureNodeEnvironment({
      chatId,
      skillDir: workspaceSkill("zip", files),
    });

    expect("dir" in shipped && path.basename(shipped.dir)).toMatch(
      /^shipped-[0-9a-f]{16}$/,
    );
    expect("dir" in mine && path.basename(mine.dir)).toMatch(/^[0-9a-f]{16}$/);
    expect(mine).not.toEqual(shipped);
    expect(
      vi.mocked(runPnpmCommand).mock.calls.map(([call]) => call.buildFolders),
    ).toEqual([true, false]);
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
          path.join(path.join(root.path, "workspace"), SKILLS_FOLDER_NAME),
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
  const cwd = () =>
    path.join(root.path, "machine", "work", "skill-environments");
  const venv = () => path.join(cwd(), ".venv");
  const skills = () => ({
    other: shippedSkill("other", {
      ...PYTHON_SKILL,
      "uv.lock": "version = 2\n",
    }),
    page: shippedSkill("page", { "scripts/a.ts": "" }),
    pdf: shippedSkill("pdf", PYTHON_SKILL),
  });
  const environment = (skillDir: string) => pythonEnvironmentOf(skillDir);

  beforeEach(() => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      workFoldersDir: AbsolutePathSchema.parse(path.dirname(cwd())),
    });
  });

  it.each<{
    expected: (
      folders: ReturnType<typeof skills>,
    ) => ReturnType<typeof skillPythonToRun>;
    loaded?: keyof ReturnType<typeof skills>;
    name: string;
    script?: keyof ReturnType<typeof skills> | "own";
    venvNear: boolean;
  }>([
    {
      expected: async ({ pdf }) => ({ venv: await environment(pdf) }),
      name: "a skill's script, alone where no .venv is near",
      script: "pdf",
      venvNear: false,
    },
    {
      expected: async ({ pdf }) => ({
        layer: AbsolutePathSchema.parse(venv()),
        venv: await environment(pdf),
      }),
      name: "a skill's script, with the .venv behind it",
      script: "pdf",
      venvNear: true,
    },
    {
      expected: async ({ pdf }) => ({
        layer: AbsolutePathSchema.parse(venv()),
        venv: await environment(pdf),
      }),
      loaded: "other",
      name: "a skill's script, in its own skill's environment whichever was loaded",
      script: "pdf",
      venvNear: true,
    },
    {
      expected: async ({ pdf }) => ({ venv: await environment(pdf) }),
      loaded: "pdf",
      name: "the agent's own script in the loaded skill's environment where no .venv is near",
      script: "own",
      venvNear: false,
    },
    {
      expected: async ({ pdf }) => ({ layer: await environment(pdf) }),
      loaded: "pdf",
      name: "the agent's own script in the .venv, with the loaded skill's environment behind it",
      script: "own",
      venvNear: true,
    },
    {
      expected: async ({ pdf }) => ({ layer: await environment(pdf) }),
      loaded: "pdf",
      name: "code from -c or stdin like the agent's own script",
      venvNear: true,
    },
    {
      expected: async () => ({}),
      name: "the agent's own script with no skill loaded",
      script: "own",
      venvNear: true,
    },
    {
      expected: async () => ({}),
      loaded: "page",
      name: "the agent's own script after a skill with no Python environment",
      script: "own",
      venvNear: true,
    },
  ])("runs $name", async ({ expected, loaded, script, venvNear }) => {
    const folders = skills();
    if (venvNear) {
      write(path.join(venv(), "pyvenv.cfg"));
    }

    await expect(
      skillPythonToRun({
        chatId,
        cwd: cwd(),
        loadedSkillDir: loaded && folders[loaded],
        script:
          script === undefined
            ? undefined
            : path.join(
                script === "own" ? path.join(cwd(), "job") : folders[script],
                "scripts",
                "run.py",
              ),
      }),
    ).resolves.toEqual(await expected(folders));
  });

  it("runs the agent's own code in its .venv when the loaded skill's environment cannot be built, and reports it with none", async () => {
    const { runUvCommand } = await import("./run-uv");
    vi.mocked(runUvCommand).mockResolvedValue({
      combined: "offline",
      exitCode: 2,
      stdout: "",
    });
    const own = {
      chatId,
      cwd: cwd(),
      loadedSkillDir: skills().pdf,
      script: path.join(cwd(), "job", "mine.py"),
    };

    await expect(skillPythonToRun(own)).resolves.toEqual({
      error: { exitCode: 2, output: "offline" },
    });
    write(path.join(venv(), "pyvenv.cfg"));
    await expect(skillPythonToRun(own)).resolves.toEqual({});
  });
});

describe("pythonLayerEnv", () => {
  it("puts the layer's sitecustomize ahead of what PYTHONPATH was, naming the site-packages it adds", async () => {
    const skillDir = shippedSkill("pdf", PYTHON_SKILL);
    const built = await ensurePythonEnvironment({ chatId, skillDir });
    if (!("venv" in built)) {
      throw new Error(built.error.output);
    }
    const layer = AbsolutePathSchema.parse(
      path.join(root.path, "work", ".venv"),
    );

    const env = pythonLayerEnv(layer, "/mine");
    const [siteDir, ...rest] = (env.PYTHONPATH ?? "").split(path.delimiter);

    expect(rest).toEqual(["/mine"]);
    expect(path.dirname(siteDir ?? "")).toBe(runtime().environments);
    const source = fs.readFileSync(
      path.join(siteDir ?? "", "sitecustomize.py"),
      "utf8",
    );
    expect(source).toContain("INSTRUMENT_EXTRA_SITE_PACKAGES");
    expect(source).toContain("site.addsitedir(extra)");
    expect(env.INSTRUMENT_EXTRA_SITE_PACKAGES).toBe(venvSitePackages(layer));
    expect(pythonLayerEnv(layer, undefined).PYTHONPATH).toBe(siteDir);
  });
});
