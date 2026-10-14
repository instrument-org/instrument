import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import {
  createMockChatConfig,
  MOCK_WORKSPACE_DIRS,
} from "../../test/helpers/mock-chat-config";
import { browserTargetOf } from "../../types";
import { updateHeldTabs } from "../held-tabs";
import { sessionLayout } from "../session-layout";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import {
  agentBrowserCommandDescription,
  browserFreeReadEnv,
  classifyInvocation,
  createAgentBrowserCommand,
  isBrowserFreeRead,
  isDaemonConfigRace,
  isExternalBrowserInvocation,
  resolveAgentBrowserPathArgs,
} from "./agent-browser";
import {
  BrowserFollowUp,
  withBrowserFollowUp,
} from "./agent-browser-follow-up";

vi.mock("execa");

/**
 * The command as a shell of the session's builds it, its layout read when it
 * runs, after the test has made the chat.
 */
function commandFor(chatId: ChatId, sessionId: StoreId.Session) {
  return {
    execute: async (args: string[], ctx: typeof mockCtx) =>
      createAgentBrowserCommand({
        chatId,
        layout: await sessionLayout({ chatId, sessionId }),
        sessionId,
      }).execute(args, ctx),
  };
}

const mockCtx = createCommandContext({
  cwd: "/",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
});

describe("createAgentBrowserCommand", () => {
  const chatId = ChatIdSchema.parse("test");
  const sessionId = StoreId.newSessionId();
  const command = commandFor(chatId, sessionId);

  beforeEach(() => {
    createMockChatConfig(chatId);
  });

  it("returns managed help with read guidance", async () => {
    const result = await command.execute(["--help"], mockCtx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("agent-browser read");
    expect(result.stdout).toContain(
      "Read the active page as agent-friendly text",
    );
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

  it("serves the CLI's core guide, led by what differs in this app", async () => {
    const result = await command.execute(["skills", "get", "core"], mockCtx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^# agent-browser in Instrument\n/);
    expect(result.stdout).toContain("## The core loop");
  });

  it.each([
    ["skills", "get", "electron"],
    ["skills", "path", "core"],
  ])(
    "refuses %s, which describes running agent-browser elsewhere",
    async (...args) => {
      const result = await command.execute(args, mockCtx);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("only `skills get core`");
    },
  );

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

  describe("adblock", () => {
    const unblocked = new Set<string>();
    let workspaceBlocking = true;
    const driven = browserTargetOf(StoreId.newSessionId());

    beforeEach(async () => {
      unblocked.clear();
      workspaceBlocking = true;
      const config = getWorkspaceConfig();
      setWorkspaceConfig({
        ...config,
        browser: {
          ...config.browser,
          contentBlocking: (targets, blocking) => {
            for (const target of targets) {
              if (blocking === false) {
                unblocked.add(target);
              } else if (blocking === true) {
                unblocked.delete(target);
              }
            }
            return {
              task: targets.every((target) => !unblocked.has(target)),
              workspace: workspaceBlocking,
            };
          },
        },
      });
      await updateHeldTabs(chatId, sessionId, () => [
        { id: driven, inWindow: true, openedBy: "task" },
      ]);
    });

    it("turns blocking off and on for the task without spawning the CLI", async () => {
      const off = await command.execute(["adblock", "off"], mockCtx);
      expect(off.stdout).toMatchInlineSnapshot(`
        "Ad blocking is off in this task's tabs, until \`agent-browser adblock on\` or the app restarts. The user's own setting is unchanged.
        Reload the page (\`agent-browser reload\`) for the change to apply.
        "
      `);
      expect(unblocked.has(driven)).toBe(true);

      const status = await command.execute(["adblock"], mockCtx);
      expect(status.stdout).toContain("off in this task's tabs");

      const on = await command.execute(["adblock", "on"], mockCtx);
      expect(on.stdout).toMatchInlineSnapshot(`
        "Ad blocking is on in this task's tabs.
        Reload the page (\`agent-browser reload\`) for the change to apply.
        "
      `);
      expect(unblocked.has(driven)).toBe(false);
    });

    it("says the user's own setting wins when they turned blocking off", async () => {
      workspaceBlocking = false;
      const result = await command.execute(["adblock", "off"], mockCtx);
      expect(result.stdout).toMatchInlineSnapshot(`
        "Ad blocking is off: the user turned it off for every page.
        "
      `);
    });

    it("asks for a page first when the task has no tabs", async () => {
      await updateHeldTabs(chatId, sessionId, () => []);
      const result = await command.execute(["adblock", "off"], mockCtx);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Open the page first");
    });

    it("refuses a mode it does not know", async () => {
      const result = await command.execute(["adblock", "maybe"], mockCtx);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("adblock [on|off]");
    });
  });
});

describe("classifyInvocation", () => {
  const managed = { hasNoWindow: false };
  it.each([
    [["--help"], managed, "help"],
    [["--session", "x", "open", "a.com"], managed, "refuse"],
    [["adblock", "off"], managed, "adblock"],
    [["skills", "get", "core"], managed, "skills"],
    [["dashboard"], managed, "refuse"],
    [["--version"], managed, "info"],
    [["--profile", "Default", "open", "a.com"], managed, "refuse"],
    [["--cdp", "9222", "snapshot"], managed, "refuse"],
    [["--executable-path", "/x", "open", "a.com"], managed, "refuse"],
    [["read", "https://example.com"], managed, "read"],
    [["open", "a.com"], { ...managed, hasNoWindow: true }, "headless"],
    [["open", "a.com"], managed, "tabs"],
    [["tab"], managed, "tabs"],
  ])("%j is %s", (args, config, kind) => {
    expect(classifyInvocation(args, config).kind).toBe(kind);
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

describe("resolveAgentBrowserPathArgs", () => {
  let fs = new InMemoryFs();

  beforeEach(async () => {
    fs = new InMemoryFs();
    await fs.mkdir("/Users/sam/chat/attachments", { recursive: true });
    await fs.mkdir("/Users/sam/chat/work", { recursive: true });
    await fs.writeFile("/Users/sam/chat/attachments/back.png", "back");
    await fs.writeFile("/Users/sam/chat/work/front.png", "front");
    await fs.writeFile("/Users/sam/chat/work/image.png", "image");
  });

  it("hands upload files to the daemon absolute, against the shell's cwd", async () => {
    const result = await resolveAgentBrowserPathArgs(
      [
        "--json",
        "upload",
        "@e1",
        "front.png",
        "--quiet",
        "../attachments/back.png",
        "/Users/sam/chat/work/image.png",
      ],
      { cwd: "/Users/sam/chat/work", fs },
    );

    expect(result).toEqual({
      args: [
        "--json",
        "upload",
        "@e1",
        "/Users/sam/chat/work/front.png",
        "--quiet",
        "/Users/sam/chat/attachments/back.png",
        "/Users/sam/chat/work/image.png",
      ],
    });
  });

  it.each([
    {
      name: "missing file in the chat's folder",
      path: "attachments/missing.png",
    },
    { name: "file URL", path: "file:///Users/sam/chat/output/x.png" },
  ])("refuses an upload of a $name", async ({ path }) => {
    const result = await resolveAgentBrowserPathArgs(["upload", "@e1", path], {
      cwd: "/Users/sam/chat",
      fs,
    });

    expect(result).toEqual({ error: `Upload file not found: "${path}".` });
  });

  it("leaves non-upload relative arguments unchanged", async () => {
    const result = await resolveAgentBrowserPathArgs(
      ["fill", "@e1", "attachments/image.png"],
      { cwd: "/Users/sam/chat", fs },
    );

    expect(result).toEqual({
      args: ["fill", "@e1", "attachments/image.png"],
    });
  });

  it.each([
    {
      args: ["eval", "// a comment\n(() => /a\\/b/.test('a/b'))()"],
      name: "an eval script opening with a comment",
    },
    { args: ["fill", "@e1", "/help"], name: "a fill value opening with /" },
    {
      args: ["wait", "--fn", "/ready/.test(document.title)"],
      name: "a wait function opening with a regex",
    },
  ])("passes $name through as typed", async ({ args }) => {
    const result = await resolveAgentBrowserPathArgs(args, {
      cwd: "/Users/sam/chat",
      fs,
    });

    expect(result).toEqual({ args });
  });

  it("passes a screenshot path through as written", async () => {
    const result = await resolveAgentBrowserPathArgs(
      ["screenshot", "/Users/sam/chat/work/page.png"],
      { cwd: "/Users/sam/chat", fs },
    );

    expect(result).toEqual({
      args: ["screenshot", "/Users/sam/chat/work/page.png"],
    });
  });

  it.each([
    [
      ["screenshot", "shot.png"],
      ["screenshot", "/Users/sam/chat/work/shot.png"],
    ],
    [
      ["screenshot", ".hero", "a.png"],
      ["screenshot", ".hero", "/Users/sam/chat/work/a.png"],
    ],
    [
      ["record", "start", "out.webm"],
      ["record", "start", "/Users/sam/chat/work/out.webm"],
    ],
    [
      ["screenshot", "@e2"],
      ["screenshot", "@e2"],
    ],
  ])("resolves %j's file operands only", async (args, expected) => {
    const result = await resolveAgentBrowserPathArgs(args, {
      cwd: "/Users/sam/chat/work",
      fs,
    });
    expect(result).toEqual({ args: expected });
  });
});

describe("agent-browser routing", () => {
  const chatId = ChatIdSchema.parse("routing");
  const sessionId = StoreId.newSessionId();
  const command = commandFor(chatId, sessionId);
  const workRoot = `${MOCK_WORKSPACE_DIRS.work}/routing`;
  let commandCtx = mockCtx;

  // Per test, not once at collection: the config is a process singleton, so a
  // describe that sets it in its body loses to whichever describe runs last.
  beforeEach(async () => {
    createMockChatConfig(chatId);
    const fs = new InMemoryFs();
    await fs.mkdir("/Users/sam/chat/attachments", { recursive: true });
    await fs.writeFile("/Users/sam/chat/attachments/image.png", "image");
    commandCtx = { ...mockCtx, cwd: "/Users/sam/chat", fs };
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
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
      ...commandCtx,
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

  it("routes a bare command to the in-app browser via the instrument provider", async () => {
    const { args, env } = await spawnedWith(["open", "https://example.com"]);

    expect(args).toContain("--session");
    expect(args[args.indexOf("--session") + 1]).toBe(sessionId);
    expect(env.AGENT_BROWSER_PROVIDER).toBe("instrument");
    expect(env.AGENT_BROWSER_PLUGINS).toContain('"name":"instrument"');
    // Lets the daemon run the plugin under Electron's node on packaged builds.
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(env.HOME).not.toBe(os.homedir());
  });

  it("passes upload files to the browser absolute", async () => {
    const { args } = await spawnedWith([
      "upload",
      "@e1",
      "attachments/image.png",
    ]);

    expect(args).toContain("/Users/sam/chat/attachments/image.png");
  });

  it("fails before spawning when an upload file is missing", async () => {
    const result = await command.execute(
      ["upload", "@e1", "attachments/missing.png"],
      commandCtx,
    );

    expect(result).toMatchObject({
      exitCode: 1,
      stderr:
        'agent-browser: Upload file not found: "attachments/missing.png".\n',
      stdout: "",
    });
    const { execa } = await import("execa");
    expect(execa).not.toHaveBeenCalled();
  });

  it.each([
    {
      args: ["click", "@e1"],
      name: "a click on the in-app browser",
      snapshotArgs: ["--session", sessionId, "snapshot", "-i", "--delta"],
    },
    {
      args: ["read", "https://example.com"],
      name: "a browser-free read",
      snapshotArgs: undefined,
    },
  ])(
    "follows $name with a snapshot of the same page only when it has one",
    async ({ args, snapshotArgs }) => {
      const { execa } = await import("execa");
      vi.mocked(execa).mockResolvedValue({
        exitCode: 0,
        stderr: "",
        stdout: "unchanged (revision 2)\n",
      } as never);
      const followUp = new BrowserFollowUp();

      await withBrowserFollowUp(followUp, () =>
        command.execute(args, commandCtx),
      );
      const page = await followUp.take(new AbortController().signal);

      const calls = vi.mocked(execa).mock.calls.map((call) => {
        const positional: unknown[] = [...call];
        const spawned = positional[1];
        return Array.isArray(spawned) ? spawned.map(String) : [];
      });
      if (snapshotArgs === undefined) {
        expect(page).toBeUndefined();
        expect(calls).toHaveLength(1);
        return;
      }
      expect(page).toMatchObject({ after: "click", kind: "unchanged" });
      expect(calls).toHaveLength(3);
      expect(calls[1]?.slice(-3)).toEqual([
        "wait",
        "--load",
        "domcontentloaded",
      ]);
      expect(calls[2]?.slice(-snapshotArgs.length)).toEqual(snapshotArgs);
    },
  );

  it("keeps the in-app browser's downloads inside the chat's work folder", async () => {
    const { env } = await spawnedWith(["open", "https://example.com"]);

    expect(env.AGENT_BROWSER_DOWNLOAD_PATH).toBe(`${workRoot}/downloads`);
  });

  it("keeps agent-browser's home, which holds the plugin it runs, out of the chat's folders", async () => {
    const { env } = await spawnedWith(["open", "https://example.com"]);

    expect(env.HOME).toBe(
      `${MOCK_WORKSPACE_DIRS.machine}/browser/agent-browser-home/routing`,
    );
  });

  it("keeps the host environment away from the in-app browser", async () => {
    vi.stubEnv("LOCALAPPDATA", String.raw`C:\Users\person\AppData\Local`);

    const { env } = await spawnedWith(["open", "https://example.com"]);

    expect(env.LOCALAPPDATA).toBeUndefined();
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
    // the in-app browser or re-point the plugin registry.
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

describe("agent-browser and browsers outside the app", () => {
  const chatId = ChatIdSchema.parse("gated");
  const sessionId = StoreId.newSessionId();
  const command = commandFor(chatId, sessionId);

  beforeEach(() => {
    createMockChatConfig(chatId);
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
    "refuses $args instead of answering it on the in-app browser",
    async ({ args }) => {
      const { result, spawned } = await execute(args);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("external browsers are not available");
      // The point of refusing: silently dropping the flag would run the command
      // against a browser that is not the one the agent believes it is on.
      expect(spawned).toBe(false);
    },
  );

  it("still drives the in-app browser", async () => {
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
    // Explicitly naming the instrument provider is the in-app browser.
    { args: ["--provider", "instrument", "open", "x"], external: false },
    // The CLI does not honor an inline value on these flags -- it reads the
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
