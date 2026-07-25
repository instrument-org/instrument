import { type CommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import {
  browserFreeReadEnv,
  createAgentBrowserCommand,
  isBrowserFreeRead,
  isDaemonConfigRace,
  isExternalBrowserInvocation,
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
  const taskId = createMockTaskConfig(TaskIdSchema.parse("test"));
  const command = createAgentBrowserCommand({
    sessionId: StoreId.newSessionId(),
    taskId,
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

describe("agent-browser routing", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("routing"));
  const sessionId = StoreId.newSessionId();
  const command = createAgentBrowserCommand({ sessionId, taskId });

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
        "AGENT_BROWSER_IDLE_TIMEOUT_MS": "300000",
        "AGENT_BROWSER_SOCKET_DIR": "/tmp/.instrument-browser",
        "HOME": "/task/.instrument/agent-browser-home",
        "PATH": "/usr/bin",
      }
    `);
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
    { args: ["--cdp=ws://127.0.0.1:9222/x", "snapshot"], external: true },
    { args: ["--provider", "browserbase", "open", "x"], external: true },
    { args: ["--provider=ios", "open", "x"], external: true },
    { args: ["-p", "ios", "open", "x"], external: true },
    // Explicitly naming the instrument provider is the task browser.
    { args: ["--provider", "instrument", "open", "x"], external: false },
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
