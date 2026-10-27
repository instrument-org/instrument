import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { runtimeLayout } from "../runtime-dir";
import { venvPython } from "../uv";
import { getWorkspaceConfig } from "../workspace-config";
import { shellPath } from "../workspace-fs-layout";
import { createPythonCommand, pythonScript } from "./python";
import { chatLayout } from "../../test/helpers/chat-layout";

vi.mock("execa");
vi.mock(import("../venv"), () => ({ pythonToRun: vi.fn() }));
vi.mock(import("../python-base"), () => ({ pythonBaseDir: vi.fn() }));
vi.mock(import("../skill-environments"), () => ({
  environmentBinDir: (venv: string) => path.join(venv, "bin"),
  pythonLayerEnv: (layer: string, pythonPath: string | undefined) => ({
    INSTRUMENT_EXTRA_SITE_PACKAGES: path.join(layer, "site-packages"),
    PYTHONPATH: ["/runtime/environments/site", pythonPath]
      .filter(Boolean)
      .join(path.delimiter),
  }),
  skillPythonToRun: vi.fn(),
}));

const realFs = new InMemoryFs();

describe("python", () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("test"));
  const layout = chatLayout(chatId);
  const command = createPythonCommand(chatId, layout);
  const chatRoot = layout.chat.shellRoot;
  const mockCtx = createCommandContext({
    cwd: chatRoot,
    env: new Map<string, string>(),
    fs: realFs,
    stdin: EMPTY_BYTES,
  });

  beforeEach(async () => {
    const { pythonToRun } = await import("../venv");
    const { skillPythonToRun } = await import("../skill-environments");
    const { pythonBaseDir } = await import("../python-base");
    vi.mocked(pythonBaseDir).mockReturnValue(undefined);
    vi.mocked(skillPythonToRun).mockResolvedValue({});
    vi.mocked(pythonToRun).mockResolvedValue({
      python: "/work/.venv/bin/python",
      venv: AbsolutePathSchema.parse("/work/.venv"),
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("runs the managed Python bare, reading no user site-packages, where no venv is near", async () => {
    const { execa } = await import("execa");
    const { pythonToRun } = await import("../venv");
    vi.mocked(pythonToRun).mockResolvedValueOnce({
      python: "/runtime/python/bin/python3.12",
      venv: undefined,
    });
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute(["-c", "print(1)"], mockCtx);

    expect(vi.mocked(execa)).toHaveBeenLastCalledWith(
      expect.stringContaining("python3.12"),
      ["-c", "print(1)"],
      expect.objectContaining({
        env: expect.objectContaining({ PYTHONNOUSERSITE: "1" }),
      }),
    );
  });

  it("points the bare interpreter at instrument and the base packages, which no venv holds the link to", async () => {
    const { execa } = await import("execa");
    const { pythonToRun } = await import("../venv");
    const { pythonBaseDir } = await import("../python-base");
    // A fresh chat: nothing has run `pip`, so there is no virtualenv for
    // `linkPythonBase` to have written a `.pth` into.
    vi.mocked(pythonBaseDir).mockReturnValue("/runtime/python-base/abc");
    vi.mocked(pythonToRun).mockResolvedValueOnce({
      python: "/runtime/python/bin/python3.12",
      venv: undefined,
    });
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute(["-c", "import matplotlib"], mockCtx);

    const { preload } = runtimeLayout(getWorkspaceConfig().runtimeDir);
    expect(vi.mocked(execa)).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        env: expect.objectContaining({
          PYTHONNOUSERSITE: "1",
          // The folder whose `sitecustomize` takes the channel first, then
          // the one with `instrument` in it.
          PYTHONPATH: [
            path.join(preload, "python-site"),
            path.join(preload, "python"),
            "/runtime/python-base/abc",
          ].join(path.delimiter),
        }),
      }),
    );
  });

  it("leaves the base packages to the venv's own link when there is one", async () => {
    const { execa } = await import("execa");
    const { pythonBaseDir } = await import("../python-base");
    vi.mocked(pythonBaseDir).mockReturnValue("/runtime/python-base/abc");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute(["-c", "import matplotlib"], mockCtx);

    expect(vi.mocked(execa)).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        env: expect.not.objectContaining({ PYTHONPATH: expect.anything() }),
      }),
    );
  });

  // The folders as this computer spells them, with a drive on Windows, where
  // the shell names them differently and an environment keeps its Python in
  // Scripts rather than bin.
  const skillEnv = AbsolutePathSchema.parse(
    path.resolve("/runtime/environments/0123"),
  );
  const workVenv = AbsolutePathSchema.parse(path.resolve("/work/.venv"));
  const skillDir = path.resolve("/runtime/skills/pdf");
  const skillScript = path.join(skillDir, "scripts", "x.py");
  const skillEnvBin = new RegExp(
    `^${path.join(skillEnv, "bin").replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`)}`,
  );

  it.each([
    {
      absent: ["INSTRUMENT_EXTRA_SITE_PACKAGES"],
      env: {
        PATH: expect.stringMatching(skillEnvBin),
        PYTHONPATH: "/mine",
        VIRTUAL_ENV: skillEnv,
      },
      interpreter: venvPython(skillEnv),
      name: "a skill's script in the skill's environment, which what it starts finds too",
      skill: { venv: skillEnv },
    },
    {
      absent: [],
      env: {
        INSTRUMENT_EXTRA_SITE_PACKAGES: path.join(workVenv, "site-packages"),
        PATH: expect.stringMatching(skillEnvBin),
        PYTHONPATH: ["/runtime/environments/site", "/mine"].join(
          path.delimiter,
        ),
        VIRTUAL_ENV: skillEnv,
      },
      interpreter: venvPython(skillEnv),
      name: "a skill's script with the .venv layered behind its environment",
      skill: { layer: workVenv, venv: skillEnv },
    },
    {
      absent: ["PYTHONNOUSERSITE", "VIRTUAL_ENV"],
      env: {
        INSTRUMENT_EXTRA_SITE_PACKAGES: path.join(skillEnv, "site-packages"),
        PYTHONPATH: ["/runtime/environments/site", "/mine"].join(
          path.delimiter,
        ),
      },
      interpreter: "/work/.venv/bin/python",
      name: "the agent's own code in its .venv with the skill's environment layered behind it",
      skill: { layer: skillEnv },
    },
  ])("runs $name", async ({ absent, env, interpreter, skill }) => {
    const { execa } = await import("execa");
    const { skillPythonToRun } = await import("../skill-environments");
    vi.mocked(skillPythonToRun).mockResolvedValueOnce(skill);
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute(["-u", `${shellPath(skillDir)}/scripts/x.py`], {
      ...mockCtx,
      env: new Map([
        ["INSTRUMENT_SKILL_DIR", shellPath(skillDir)],
        ["PYTHONPATH", "/mine"],
      ]),
    });

    expect(vi.mocked(skillPythonToRun)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        loadedSkillDir: skillDir,
        script: skillScript,
      }),
    );
    expect(vi.mocked(execa)).toHaveBeenLastCalledWith(
      interpreter,
      ["-u", skillScript],
      expect.objectContaining({
        env: expect.objectContaining(env),
      }),
    );
    for (const name of absent) {
      expect(vi.mocked(execa)).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          env: expect.not.objectContaining({ [name]: expect.anything() }),
        }),
      );
    }
  });

  it.each([
    [["script.py", "--flag"], "script.py"],
    [["-u", "-B", "job/run.py"], "job/run.py"],
    [["-W", "ignore", "run.py"], "run.py"],
    [["-Wignore", "run.py"], "run.py"],
    [["-uW", "ignore", "run.py"], "run.py"],
    [["--", "-odd.py"], "-odd.py"],
    [["-c", "print(1)"], undefined],
    [["-uc", "print(1)"], undefined],
    [["-m", "http.server"], undefined],
    [["-"], undefined],
    [[], undefined],
  ])("finds the script in %j", (args, script) => {
    expect(pythonScript(args)).toBe(script);
  });

  it("passes -c code with a real path through unchanged", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);
    const code = `open("${chatRoot}/attachments/chart.svg")`;

    await command.execute(["-c", code], mockCtx);

    const calledArgs = vi.mocked(execa).mock.calls.at(-1)?.[1];
    expect(calledArgs).toEqual(["-c", code]);
  });

  it("passes a heredoc program on stdin through unchanged", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);
    const program = `print(open("${chatRoot}/work/data.csv").read())`;

    await command.execute([], {
      ...mockCtx,
      stdin: encodeUtf8ToBytes(program),
    });

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({ input: Buffer.from(program) }),
    );
  });

  it("leaves stdin alone when a script file argument is present", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    const data = 'rows mentioning "/x" are data, not code';
    await command.execute(["work/script.py"], {
      ...mockCtx,
      stdin: encodeUtf8ToBytes(data),
    });

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      expect.any(String),
      ["work/script.py"],
      expect.objectContaining({ input: Buffer.from(data) }),
    );
  });

  it("forwards non-ASCII stdin bytes unchanged", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute([], {
      ...mockCtx,
      stdin: encodeUtf8ToBytes("print('café → déjà')"),
    });

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({
        input: Buffer.from("print('café → déjà')", "utf8"),
      }),
    );
  });
});
