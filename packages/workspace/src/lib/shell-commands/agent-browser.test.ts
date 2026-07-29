import { type CommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import {
  createMockTaskConfig,
  MOCK_WORKSPACE_DIRS,
} from "../../test/helpers/mock-task-config";
import {
  agentBrowserCommandDescription,
  browserFreeReadEnv,
  createAgentBrowserCommand,
  isBrowserFreeRead,
  isDaemonConfigRace,
  isExternalBrowserInvocation,
  isExternalLocalLaunch,
  resolveAgentBrowserPathArgs,
  scrubHostPaths,
} from "./agent-browser";

vi.mock("execa");

const mockCtx: CommandContext = {
  cwd: "/",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
};

describe("createAgentBrowserCommand", () => {
  const taskId = TaskIdSchema.parse("test");
  const command = createAgentBrowserCommand({
    sessionId: StoreId.newSessionId(),
    taskId,
  });

  beforeEach(() => {
    createMockTaskConfig(taskId, { externalBrowser: true });
  });

  it("returns managed help with read guidance", async () => {
    const result = await command.execute(["--help"], mockCtx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("agent-browser read");
    expect(result.stdout).toContain(
      "Read the active page as agent-friendly text",
    );
    expect(result.stdout).toContain("--auto-connect");
  });

  it.each([
    { flag: "--config" },
    { flag: "--namespace" },
    { flag: "--session" },
    { flag: "--session-name" },
  ])("blocks harness-owned flag $flag", async ({ flag }) => {
    const result = await command.execute([flag, "value", "open"], mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`flag ${flag} is not allowed`);
  });

  it.each([
    { subcommand: "auth" },
    { subcommand: "batch" },
    { subcommand: "connect" },
    { subcommand: "install" },
    { subcommand: "mcp" },
    { subcommand: "plugin" },
    { subcommand: "session" },
  ])(
    "blocks workspace-managed subcommand $subcommand",
    async ({ subcommand }) => {
      const result = await command.execute([subcommand], mockCtx);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        `subcommand '${subcommand}' is not available`,
      );
    },
  );

  it("blocks a subcommand hidden behind a global flag's value", async () => {
    const result = await command.execute(["--headers", "{}", "close"], mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("subcommand 'close' is not available");
  });
});

describe("isBrowserFreeRead", () => {
  it.each([
    { args: ["read", "https://example.com"] },
    { args: ["read", "example.com/docs"] },
    { args: ["read", "https://example.com", "--raw"] },
    { args: ["read", "--llms", "index", "https://example.com"] },
    { args: ["read", "https://example.com", "--filter", "auth", "--outline"] },
    { args: ["read", "https://example.com", "--timeout", "2500"] },
    { args: ["read", "https://example.com", "--headers", '{"A":"b"}'] },
    { args: ["--json", "read", "https://example.com"] },
  ])("treats $args as a fetch that needs no browser", ({ args }) => {
    expect(isBrowserFreeRead(args)).toBe(true);
  });

  it.each([
    // Reads the active page, which only exists in the managed target.
    { args: ["read"] },
    { args: ["read", "--llms", "full"] },
    { args: ["read", "--require-md"] },
    // Launch configuration: the CLI would answer it with its own browser.
    { args: ["read", "https://example.com", "--headed"] },
    { args: ["read", "https://example.com", "--engine", "firefox"] },
    {
      args: ["read", "https://example.com", "--allowed-domains", "example.com"],
    },
    // Not the read command at all.
    { args: ["open", "https://example.com"] },
    { args: ["snapshot", "-i"] },
    { args: [] },
    // The CLI's read parser rejects inline flag values, so it never fetches.
    { args: ["read", "--llms=index", "https://example.com"] },
  ])("keeps $args on the target-backed path", ({ args }) => {
    expect(isBrowserFreeRead(args)).toBe(false);
  });
});

describe("browserFreeReadEnv", () => {
  it("drops launch configuration the CLI would answer with its own browser", () => {
    const result = browserFreeReadEnv({
      AGENT_BROWSER_ARGS: "--single-process",
      AGENT_BROWSER_DOWNLOAD_PATH: "/task/work/downloads",
      AGENT_BROWSER_HEADED: "1",
      HOME: "/task/.instrument/agent-browser-home",
      HTTPS_PROXY: "http://127.0.0.1:8080",
      PATH: "/usr/bin",
    });

    expect(result).toMatchInlineSnapshot(`
      {
        "AGENT_BROWSER_CONTENT_BOUNDARIES": "true",
        "AGENT_BROWSER_IDLE_TIMEOUT_MS": "300000",
        "AGENT_BROWSER_SOCKET_DIR": "/tmp/.instrument-browser",
        "HOME": "/task/.instrument/agent-browser-home",
        "PATH": "/usr/bin",
      }
    `);
  });

  it("keeps content boundaries even though it drops AGENT_BROWSER_ vars", () => {
    // A `read <url>` fetches from a host nobody here chose, so it is the last
    // invocation that should lose its boundary markers -- and the only one
    // whose env is rebuilt from scratch rather than inherited.
    const result = browserFreeReadEnv({
      AGENT_BROWSER_CONTENT_BOUNDARIES: "true",
      PATH: "/usr/bin",
    });

    expect(result.AGENT_BROWSER_CONTENT_BOUNDARIES).toBe("true");
  });
});

describe("resolveAgentBrowserPathArgs", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("upload-paths"));
  const taskDirPath = `${MOCK_WORKSPACE_DIRS.tasks}/upload-paths`;
  const fs = new InMemoryFs();

  it.each([
    {
      expected: `${taskDirPath}/attachments/image.png`,
      name: "task-relative path",
      path: "attachments/image.png",
    },
    {
      expected: `${taskDirPath}/work/image.png`,
      name: "/task path",
      path: "/task/work/image.png",
    },
    {
      expected: `${taskDirPath}/mnt/Photos/image.png`,
      name: "attached-folder path",
      path: "/mnt/Photos/image.png",
    },
    {
      expected: `${taskDirPath}/task/.instrument/state.json`,
      name: "private task path",
      path: "/task/.instrument/state.json",
    },
  ])(
    "resolves an upload $name for the native browser",
    ({ expected, path }) => {
      const result = resolveAgentBrowserPathArgs(
        ["upload", "@e1", path],
        taskId,
        {
          cwd: "/task",
          fs,
        },
      );

      expect(result).toEqual(["upload", "@e1", expected]);
    },
  );

  it("resolves multiple upload files from the live shell cwd", () => {
    const result = resolveAgentBrowserPathArgs(
      [
        "--json",
        "upload",
        "@e1",
        "front.png",
        "--quiet",
        "../attachments/back.png",
      ],
      taskId,
      {
        cwd: "/task/work",
        fs,
      },
    );

    expect(result).toEqual([
      "--json",
      "upload",
      "@e1",
      `${taskDirPath}/work/front.png`,
      "--quiet",
      `${taskDirPath}/attachments/back.png`,
    ]);
  });

  it("leaves non-upload relative arguments unchanged", () => {
    const result = resolveAgentBrowserPathArgs(
      ["fill", "@e1", "attachments/image.png"],
      taskId,
      {
        cwd: "/task",
        fs,
      },
    );

    expect(result).toEqual(["fill", "@e1", "attachments/image.png"]);
  });
});

describe("agent-browser routing", () => {
  const taskId = TaskIdSchema.parse("routing");
  const sessionId = StoreId.newSessionId();
  const command = createAgentBrowserCommand({ sessionId, taskId });
  const taskDirPath = `${MOCK_WORKSPACE_DIRS.tasks}/routing`;

  // Per test, not once at collection: the config is a process singleton, so a
  // describe that sets it in its body loses to whichever describe runs last.
  beforeEach(() => {
    createMockTaskConfig(taskId, { externalBrowser: true });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  async function spawnedWith(
    args: string[],
    agentEnv: [string, string][] = [],
  ) {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValue({
      exitCode: 0,
      stderr: "",
      stdout: "",
    } as never);

    await command.execute(args, {
      ...mockCtx,
      env: new Map(agentEnv),
    });

    const call = vi.mocked(execa).mock.calls[0];
    if (!call) {
      throw new Error("agent-browser was never spawned");
    }
    // execa's overloads type the call tuple as its 2-argument form, so read
    // the (binary, args, options) triple positionally and narrow each part.
    const positional: unknown[] = [...call];
    const spawnedArgs = positional[1];
    const options = positional[2];
    const optionsEnv =
      typeof options === "object" && options !== null && "env" in options
        ? options.env
        : undefined;
    const env: Record<string, string | undefined> =
      typeof optionsEnv === "object" && optionsEnv !== null
        ? Object.fromEntries(
            Object.entries(optionsEnv).map(([key, value]) => [
              key,
              typeof value === "string" ? value : undefined,
            ]),
          )
        : {};
    return {
      args: Array.isArray(spawnedArgs) ? spawnedArgs.map(String) : [],
      env,
    };
  }

  it("routes a bare command to the task browser via the instrument provider", async () => {
    const { args, env } = await spawnedWith(["open", "https://example.com"]);

    expect(args).toContain("--session");
    expect(args[args.indexOf("--session") + 1]).toBe(sessionId);
    expect(env.AGENT_BROWSER_PROVIDER).toBe("instrument");
    expect(env.AGENT_BROWSER_PLUGINS).toContain('"name":"instrument"');
    // Lets the daemon run the plugin under Electron's node on packaged builds.
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(env.HOME).not.toBe(os.homedir());
  });

  it("passes upload files to the browser as host-absolute paths", async () => {
    const { args } = await spawnedWith([
      "upload",
      "@e1",
      "attachments/image.png",
    ]);

    expect(args).toContain(`${taskDirPath}/attachments/image.png`);
  });

  it("routes an external targeting flag to the sibling session with no provider", async () => {
    const { args, env } = await spawnedWith([
      "--profile",
      "Default",
      "open",
      "https://example.com",
    ]);

    expect(args[args.indexOf("--session") + 1]).toBe(`${sessionId}-ext`);
    expect(env.AGENT_BROWSER_PROVIDER).toBeUndefined();
    expect(env.AGENT_BROWSER_PLUGINS).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    // --profile and --auto-connect resolve against the real user-data dirs.
    expect(env.HOME).toBe(os.homedir());
  });

  it("launches an external browser with a window the user can see", async () => {
    const { args } = await spawnedWith([
      "--profile",
      "Default",
      "open",
      "https://example.com",
    ]);

    expect(args).toContain("--headed");
  });

  it.each([
    { args: ["--cdp", "9222", "snapshot"], name: "--cdp" },
    { args: ["--auto-connect", "snapshot"], name: "--auto-connect" },
    { args: ["--provider", "browserbase", "open", "x"], name: "--provider" },
    { args: ["profiles"], name: "profiles" },
    { args: ["open", "https://example.com"], name: "the task browser" },
  ])("does not ask $name for a window it cannot open", async ({ args }) => {
    const { args: spawned } = await spawnedWith(args);

    expect(spawned).not.toContain("--headed");
  });

  it("keeps a cloned Chrome profile out of the task tree", async () => {
    const { env } = await spawnedWith([
      "--profile",
      "Default",
      "open",
      "https://example.com",
    ]);

    // The CLI clones the user's real profile into TMPDIR. Inside the task that
    // clone is indexed, reported back to the model as changed files, packed
    // into an export zip, and readable by the agent.
    for (const key of ["TEMP", "TMP", "TMPDIR"]) {
      expect(env[key]).toBeTruthy();
      expect(env[key]).not.toContain(taskDirPath);
    }
  });

  it("keeps the task browser's temp files inside the task", async () => {
    const { env } = await spawnedWith(["open", "https://example.com"]);

    for (const key of ["TEMP", "TMP", "TMPDIR"]) {
      expect(env[key]).toContain(taskDirPath);
    }
  });

  it("routes profiles to the host even without a targeting flag", async () => {
    const { args, env } = await spawnedWith(["profiles"]);

    expect(args[args.indexOf("--session") + 1]).toBe(`${sessionId}-ext`);
    expect(env.HOME).toBe(os.homedir());
    expect(env.AGENT_BROWSER_PROVIDER).toBeUndefined();
  });

  it("ignores connection env the agent exported into its shell", async () => {
    const { args, env } = await spawnedWith(
      ["open", "https://example.com"],
      [
        ["AGENT_BROWSER_CDP", "9222"],
        ["AGENT_BROWSER_AUTO_CONNECT", "1"],
        ["AGENT_BROWSER_PROFILE", "Default"],
        ["AGENT_BROWSER_PLUGINS", '[{"name":"evil","command":"/bin/sh"}]'],
        ["AGENT_BROWSER_PROVIDER", "evil"],
        ["AGENT_BROWSER_SESSION", "hijacked"],
        ["AGENT_BROWSER_CONFIG", "/task/agent-browser.json"],
      ],
    );

    // Routing stays argv-derived: the shell env cannot move the invocation off
    // the task browser or re-point the plugin registry.
    expect(args[args.indexOf("--session") + 1]).toBe(sessionId);
    expect(env.AGENT_BROWSER_CDP).toBeUndefined();
    expect(env.AGENT_BROWSER_AUTO_CONNECT).toBeUndefined();
    expect(env.AGENT_BROWSER_PROFILE).toBeUndefined();
    expect(env.AGENT_BROWSER_SESSION).toBeUndefined();
    expect(env.AGENT_BROWSER_CONFIG).toBeUndefined();
    expect(env.AGENT_BROWSER_PROVIDER).toBe("instrument");
    expect(env.AGENT_BROWSER_PLUGINS).not.toContain("evil");
  });
});

describe("agent-browser with external browsers disabled", () => {
  const taskId = TaskIdSchema.parse("gated");
  const sessionId = StoreId.newSessionId();
  const command = createAgentBrowserCommand({ sessionId, taskId });

  beforeEach(() => {
    createMockTaskConfig(taskId, { externalBrowser: false });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  async function execute(args: string[]) {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValue({
      exitCode: 0,
      stderr: "",
      stdout: "",
    } as never);

    const result = await command.execute(args, mockCtx);
    return { result, spawned: vi.mocked(execa).mock.calls.length > 0 };
  }

  it.each([
    { args: ["--profile", "Default", "open", "https://example.com"] },
    { args: ["--auto-connect", "snapshot"] },
    { args: ["--cdp", "9222", "snapshot"] },
    { args: ["--provider", "browserbase", "open", "x"] },
    { args: ["--executable-path", "/opt/chrome", "open", "x"] },
    { args: ["--state", "state.json", "open", "x"] },
    { args: ["profiles"] },
  ])(
    "refuses $args instead of answering it on the task browser",
    async ({ args }) => {
      const { result, spawned } = await execute(args);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("external browsers are not available");
      // The point of refusing: silently dropping the flag would run the command
      // against a browser that is not the one the agent believes it is on.
      expect(spawned).toBe(false);
    },
  );

  it("still drives the task browser", async () => {
    const { result, spawned } = await execute(["open", "https://example.com"]);

    expect(result.exitCode).toBe(0);
    expect(spawned).toBe(true);
  });

  it("still answers --version without a browser", async () => {
    const { spawned } = await execute(["--version"]);

    expect(spawned).toBe(true);
  });

  it("leaves external browsers out of the help", async () => {
    const { result } = await execute(["--help"]);

    expect(result.stdout).toContain("agent-browser read");
    expect(result.stdout).not.toContain("--auto-connect");
    expect(result.stdout).not.toContain("--profile");
    expect(result.stdout).not.toContain("External browsers");
  });

  it("leaves external browsers out of the command description", () => {
    const description = agentBrowserCommandDescription();

    expect(description).not.toContain("--profile");
    expect(description).not.toContain("--auto-connect");
    expect(description).toContain("only browser available");
  });
});

describe("isDaemonConfigRace", () => {
  it("matches the CLI's daemon-configuration refusal", () => {
    expect(
      isDaemonConfigRace(
        // cspell:ignore KXTDQBA XGVK
        "✗ A daemon for session 'ses_01KXTDQBA6YKA952V0XGVK2HM4' started " +
          "concurrently with different daemon configuration. Retry the command " +
          "so agent-browser can restart it with the requested configuration.",
      ),
    ).toBe(true);
  });

  it.each([
    ["✗ Navigation failed: net::ERR_FILE_NOT_FOUND"],
    ["✗ CDP error (Page.navigate): CDP command timed out: Page.navigate."],
    [""],
  ])("does not match unrelated failure %j", (output) => {
    expect(isDaemonConfigRace(output)).toBe(false);
  });
});

describe("scrubHostPaths", () => {
  const opts = {
    homeDir: "/Users/jane",
    taskDirPath: "/Users/jane/tasks/t1",
  };

  it.each([
    {
      expected:
        "Chrome profiles (~/Library/Application Support/Google/Chrome):",
      name: "home-dir paths become ~",
      output:
        "Chrome profiles (/Users/jane/Library/Application Support/Google/Chrome):",
    },
    {
      expected: "Saved to work/screenshots/shot.png",
      name: "task-dir paths become task-relative",
      output: "Saved to /Users/jane/tasks/t1/work/screenshots/shot.png",
    },
    {
      expected: "in .",
      name: "a bare task-dir path becomes .",
      output: "in /Users/jane/tasks/t1",
    },
    {
      expected: "no paths here",
      name: "unrelated output is untouched",
      output: "no paths here",
    },
  ])("$name", ({ expected, output }) => {
    expect(scrubHostPaths(output, opts)).toBe(expected);
  });
});

describe("isExternalBrowserInvocation", () => {
  it.each([
    { args: ["open", "https://example.com"], external: false },
    { args: ["snapshot", "-i"], external: false },
    { args: ["--user-agent", "bot/1.0", "open", "x"], external: false },
    { args: ["--auto-connect", "open", "x"], external: true },
    { args: ["--auto-connect=false", "open", "x"], external: false },
    { args: ["--auto-connect", "false", "open", "x"], external: false },
    { args: ["--cdp", "9222", "snapshot"], external: true },
    { args: ["--provider", "browserbase", "open", "x"], external: true },
    { args: ["-p", "ios", "open", "x"], external: true },
    // Explicitly naming the instrument provider is the task browser.
    { args: ["--provider", "instrument", "open", "x"], external: false },
    // The CLI does not honour an inline value on these flags -- it reads the
    // whole token as the subcommand and fails -- so the invocation reaches no
    // browser at all, and routing it externally would name a target the
    // command never connects to.
    { args: ["--cdp=ws://127.0.0.1:9222/x", "snapshot"], external: false },
    { args: ["--provider=ios", "open", "x"], external: false },
    { args: ["--provider=instrument", "open", "x"], external: false },
    { args: ["--profile", "Default", "open", "x"], external: true },
    { args: ["--state", "state.json", "open", "x"], external: true },
    { args: ["--restore", "shop", "open", "x"], external: true },
    { args: ["--executable-path", "/opt/chrome", "open", "x"], external: true },
    // A non-targeting value flag's value is never read as a flag itself.
    { args: ["--args", "--cdp", "open", "x"], external: false },
    { args: ["--user-agent", "--auto-connect", "open", "x"], external: false },
    // Upstream identity precedence: provider beats launch-state flags, cdp
    // beats provider.
    {
      args: ["--profile", "Default", "--provider", "instrument", "open"],
      external: false,
    },
    {
      args: ["--provider", "instrument", "--cdp", "9222", "get", "url"],
      external: true,
    },
  ])("$args -> external: $external", ({ args, external }) => {
    expect(isExternalBrowserInvocation(args)).toBe(external);
  });
});

describe("isExternalLocalLaunch", () => {
  it.each([
    { args: ["--profile", "Default", "open", "x"], launch: true },
    { args: ["--executable-path", "/opt/chrome", "open", "x"], launch: true },
    { args: ["--state", "state.json", "open", "x"], launch: true },
    { args: ["--restore", "shop", "open", "x"], launch: true },
    // Attached targets: the browser exists already and launch options are moot.
    { args: ["--cdp", "9222", "snapshot"], launch: false },
    { args: ["--auto-connect", "snapshot"], launch: false },
    { args: ["--provider", "browserbase", "open", "x"], launch: false },
    {
      args: ["--profile", "Default", "--cdp", "9222", "snapshot"],
      launch: false,
    },
    // Opting out of auto-connect leaves a launch behind, not an attach.
    {
      args: ["--auto-connect", "false", "--profile", "Default", "open", "x"],
      launch: true,
    },
    // Not external at all.
    { args: ["open", "https://example.com"], launch: false },
    { args: ["--provider", "instrument", "open", "x"], launch: false },
  ])("$args -> local launch: $launch", ({ args, launch }) => {
    expect(isExternalLocalLaunch(args)).toBe(launch);
  });
});
