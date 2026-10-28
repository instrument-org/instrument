import { Bash, createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import {
  createMockChatConfig,
  MOCK_WORKSPACE_DIRS,
} from "../../test/helpers/mock-chat-config";
import {
  agentBrowserRuns,
  answerAgentBrowser,
} from "../../test/helpers/agent-browser-runs";
import { browserTargetOf } from "../../types";
import { updateHeldTabs } from "../held-tabs";
import { sessionLayout } from "../session-layout";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import {
  buildBashFs,
  buildWorkspaceFsLayout,
  shellPath,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";
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
  LIVE_REGION_SETTLE_MS,
  withBrowserFollowUp,
} from "./agent-browser-follow-up";
import { NETWORK_IDLE_GAVE_UP, namedWaitGaveUp } from "./agent-browser-wait";

vi.mock("execa");
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

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

/** What upstream prints for any error that mentions a timeout. */
const upstreamTimeout = {
  exitCode: 1,
  stderr:
    "✗ Operation timed out. The page may still be loading or the element may not exist.\n",
  stdout: "",
};

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

  // Connected to the app's browser, which is already running, the CLI
  // drops an extension.
  it.each([
    [["--extension", "/Users/sam/ext", "open", "https://example.com"]],
    [["open", "https://example.com", "--extension=/Users/sam/ext"]],
  ])("refuses --extension, which has no effect here: %j", async (args) => {
    const result = await command.execute(args, mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "agent-browser: flag --extension has no effect on Instrument's browser: an extension loads only into a browser agent-browser starts itself, and this one is already running.\n",
    );
    expect(await agentBrowserRuns()).toEqual([]);
  });

  it("drives the app's browser with a page init script, its path checked later", () => {
    expect(
      classifyInvocation(
        ["--init-script", "hook.js", "open", "https://x.com"],
        {
          hasNoWindow: false,
        },
      ),
    ).toEqual({ kind: "tabs" });
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
    const driven = browserTargetOf(StoreId.newTabId());

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

    expect(result).toEqual({
      AGENT_BROWSER_IDLE_TIMEOUT_MS: "300000",
      // On Windows the daemon listens on TCP, with no socket folder.
      AGENT_BROWSER_SOCKET_DIR:
        process.platform === "win32" ? undefined : "/tmp/.instrument-browser",
      HOME: "/task/.instrument/agent-browser-home",
      PATH: "/usr/bin",
    });
  });
});

describe("resolveAgentBrowserPathArgs", () => {
  // The chat's folder as this computer spells it, which the daemon is
  // handed, and as the agent's shell does, which differs on Windows.
  const chat = path.resolve("/Users/sam/chat");
  const shell = shellPath(chat);
  const host = (...segments: string[]) => path.join(chat, ...segments);
  let fs = new InMemoryFs();
  let layout: WorkspaceFsLayout;

  beforeEach(async () => {
    createMockChatConfig(ChatIdSchema.parse("paths"));
    layout = buildWorkspaceFsLayout({
      chatHostRoot: WorkDirSchema.parse(chat),
      rules: {
        home: path.resolve("/Users/sam"),
        rules: [],
        dangerouslyAllowEveryFolder: false,
      },
    });
    fs = new InMemoryFs();
    await fs.mkdir(`${shell}/attachments`, { recursive: true });
    await fs.mkdir(`${shell}/work`, { recursive: true });
    await fs.writeFile(`${shell}/attachments/back.png`, "back");
    await fs.writeFile(`${shell}/work/front.png`, "front");
    await fs.writeFile(`${shell}/work/image.png`, "image");
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
        `${shell}/work/image.png`,
      ],
      { cwd: `${shell}/work`, fs },
      layout,
    );

    expect(result).toEqual({
      args: [
        "--json",
        "upload",
        "@e1",
        host("work", "front.png"),
        "--quiet",
        host("attachments", "back.png"),
        host("work", "image.png"),
      ],
    });
  });

  it.each([
    {
      name: "missing file in the chat's folder",
      path: "attachments/missing.png",
    },
    { name: "file URL", path: `file://${shell}/output/x.png` },
  ])("refuses an upload of a $name", async ({ path: operand }) => {
    const result = await resolveAgentBrowserPathArgs(
      ["upload", "@e1", operand],
      { cwd: shell, fs },
      layout,
    );

    expect(result).toEqual({
      // On Windows the ":" past the scheme names a stream, which the rules
      // refuse before anything looks for the file.
      error:
        process.platform === "win32" && operand.startsWith("file:")
          ? expect.stringContaining("by one of its streams")
          : `Upload file not found: "${operand}".`,
    });
  });

  it("leaves non-upload relative arguments unchanged", async () => {
    const result = await resolveAgentBrowserPathArgs(
      ["fill", "@e1", "attachments/image.png"],
      { cwd: shell, fs },
      layout,
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
    const result = await resolveAgentBrowserPathArgs(
      args,
      { cwd: shell, fs },
      layout,
    );

    expect(result).toEqual({ args });
  });

  it("passes a screenshot path through as written", async () => {
    const result = await resolveAgentBrowserPathArgs(
      ["screenshot", `${shell}/work/page.png`],
      { cwd: shell, fs },
      layout,
    );

    expect(result).toEqual({
      args: ["screenshot", host("work", "page.png")],
    });
  });

  it.each([
    [
      ["screenshot", "shot.png"],
      ["screenshot", host("work", "shot.png")],
    ],
    [
      ["screenshot", ".hero", "a.png"],
      ["screenshot", ".hero", host("work", "a.png")],
    ],
    [
      ["record", "start", "out.webm"],
      ["record", "start", host("work", "out.webm")],
    ],
    [
      ["screenshot", "@e2"],
      ["screenshot", "@e2"],
    ],
  ])("resolves %j's file operands only", async (args, expected) => {
    const result = await resolveAgentBrowserPathArgs(
      args,
      { cwd: `${shell}/work`, fs },
      layout,
    );
    expect(result).toEqual({ args: expected });
  });
});

/**
 * The CLI and its browser read and write files as the person, outside the
 * sandbox, so a file operand meets the folder rules before it is handed on:
 * a folder closed in Settings, a read-only one, and a link in the work
 * folder to a closed file, against the work folder the defaults write to.
 */
describe("agent-browser file operands and the folder rules", () => {
  let root = "";
  let layout: WorkspaceFsLayout;
  let ctx = mockCtx;

  beforeEach(async () => {
    createMockChatConfig(ChatIdSchema.parse("rules"));
    root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "agent-browser-rules-")),
    );
    for (const folder of ["work", "closed", "shelf"]) {
      mkdirSync(path.join(root, folder));
    }
    writeFileSync(path.join(root, "closed", "secret.txt"), "secret");
    writeFileSync(path.join(root, "closed", "baseline.png"), "png");
    writeFileSync(path.join(root, "shelf", "form.pdf"), "pdf");
    writeFileSync(path.join(root, "work", "photo.png"), "png");
    writeFileSync(path.join(root, "closed", "hook.js"), "js");
    writeFileSync(path.join(root, "work", "hook.js"), "js");
    symlinkSync(
      path.join(root, "closed", "secret.txt"),
      path.join(root, "work", "notes.txt"),
    );
    layout = buildWorkspaceFsLayout({
      chatHostRoot: WorkDirSchema.parse(path.join(root, "work")),
      rules: {
        home: root,
        rules: [
          { level: "never", path: path.join(root, "closed"), source: "folder" },
          {
            level: "readOnly",
            path: path.join(root, "shelf"),
            source: "folder",
          },
        ],
        dangerouslyAllowEveryFolder: false,
      },
    });
    ctx = {
      ...mockCtx,
      cwd: shellPath(path.join(root, "work")),
      fs: await buildBashFs(layout, { maxFileReadSize: 1024 * 1024 }),
    };
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  // The daemon is handed host paths, and a note names a path as the agent's
  // shell does, which differs on Windows: both read as <root>, with `/`.
  const resolve = async (args: string[]) => {
    const result = await resolveAgentBrowserPathArgs(args, ctx, layout);
    return "error" in result
      ? { error: result.error.replaceAll(shellPath(root), "<root>") }
      : {
          args: result.args.map((arg) =>
            arg.replaceAll(root, "<root>").replaceAll(path.sep, "/"),
          ),
        };
  };

  it.each([
    { args: ["upload", "@e1", "../closed/secret.txt"], name: "an upload" },
    {
      args: ["upload", "@e1", "notes.txt"],
      name: "an upload through a link in the work folder",
    },
    {
      args: ["diff", "screenshot", "--baseline", "../closed/baseline.png"],
      name: "a diff baseline",
    },
    {
      args: ["--init-script", "../closed/hook.js", "open", "https://x.com"],
      name: "a page init script",
    },
    {
      args: ["open", "https://x.com", "--init-script", "notes.txt"],
      name: "a page init script through a link in the work folder",
    },
    {
      args: ["--init-script=../closed/hook.js", "open", "https://x.com"],
      name: "a page init script spelled with =",
    },
  ])("refuses $name from a closed folder", async ({ args }) => {
    const result = await resolve(args);

    expect(result).toEqual({
      error: expect.stringContaining(
        "is closed in Settings › Permissions. Don't look for another way in; tell the person what you needed it for.",
      ),
    });
  });

  it("names the operand and why, as the shell's other commands do", async () => {
    expect(await resolve(["upload", "@e1", "../closed/secret.txt"]))
      .toMatchInlineSnapshot(`
      {
        "error": "../closed/secret.txt: Permission denied
      "<root>/closed/secret.txt" is closed in Settings › Permissions. Don't look for another way in; tell the person what you needed it for.",
      }
    `);
  });

  it.each([
    { args: ["screenshot", "../closed/page.png"] },
    { args: ["screenshot", "@e1", "../closed/page"] },
    { args: ["pdf", "../closed/page"] },
    { args: ["download", "@e1", "../closed/report.csv"] },
    { args: ["record", "start", "--fps", "10", "../closed/take.webm"] },
    { args: ["trace", "stop", "../closed/trace.json"] },
    { args: ["profiler", "stop", "../closed/profile.json"] },
    { args: ["network", "har", "stop", "../closed/traffic.har"] },
    {
      args: [
        "diff",
        "screenshot",
        "--baseline",
        "photo.png",
        "-o",
        "../closed/d.png",
      ],
    },
  ])("refuses $args writing into a closed folder", async ({ args }) => {
    expect(await resolve(args)).toEqual({
      error: expect.stringContaining("Permission denied"),
    });
  });

  it("refuses a write into a read-only folder", async () => {
    expect(await resolve(["pdf", "../shelf/page.pdf"])).toEqual({
      error: expect.stringContaining("is read-only."),
    });
  });

  // The shell on Windows reads no folder outside the ones it mounts, so an
  // upload finds nothing there to send.
  it.skipIf(process.platform === "win32")(
    "uploads from a read-only folder",
    async () => {
      expect(await resolve(["upload", "@e1", "../shelf/form.pdf"])).toEqual({
        args: ["upload", "@e1", "<root>/shelf/form.pdf"],
      });
    },
  );

  it("refuses a page init script that is not there", async () => {
    expect(
      await resolve(["--init-script", "gone.js", "open", "https://x.com"]),
    ).toEqual({ error: 'Init script not found: "gone.js".' });
  });

  it.each([
    [["screenshot"], ["screenshot"]],
    [
      ["--init-script", "hook.js", "open", "https://x.com"],
      ["--init-script", "<root>/work/hook.js", "open", "https://x.com"],
    ],
    [
      ["--init-script=hook.js", "open", "https://x.com"],
      ["--init-script=<root>/work/hook.js", "open", "https://x.com"],
    ],
    [
      ["screenshot", "shot.png"],
      ["screenshot", "<root>/work/shot.png"],
    ],
    [
      ["download", "@e1", "report.csv"],
      ["download", "@e1", "<root>/work/report.csv"],
    ],
    [
      ["upload", "@e1", "photo.png"],
      ["upload", "@e1", "<root>/work/photo.png"],
    ],
  ])("lets %j work in the work folder", async (args, expected) => {
    expect(await resolve(args)).toEqual({ args: expected });
  });
});

describe("agent-browser routing", () => {
  const chatId = ChatIdSchema.parse("routing");
  const sessionId = StoreId.newSessionId();
  const command = commandFor(chatId, sessionId);
  const workRoot = path.join(MOCK_WORKSPACE_DIRS.work, "routing");
  // The folder the shell is in, as this computer spells it and as the shell
  // does, which differs on Windows.
  const chatFolder = path.resolve("/Users/sam/chat");
  let commandCtx = mockCtx;

  // Per test, not once at collection: the config is a process singleton, so a
  // describe that sets it in its body loses to whichever describe runs last.
  beforeEach(async () => {
    createMockChatConfig(chatId);
    const fs = new InMemoryFs();
    await fs.mkdir(`${shellPath(chatFolder)}/attachments`, { recursive: true });
    await fs.writeFile(
      `${shellPath(chatFolder)}/attachments/image.png`,
      "image",
    );
    commandCtx = { ...mockCtx, cwd: shellPath(chatFolder), fs };
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  async function spawnedWith(
    args: string[],
    agentEnv: [string, string][] = [],
  ) {
    await answerAgentBrowser({ exitCode: 0, stderr: "", stdout: "" });

    await command.execute(args, {
      ...commandCtx,
      env: new Map(agentEnv),
    });

    const [run] = await agentBrowserRuns();
    if (!run) {
      throw new Error("agent-browser was never spawned");
    }
    return run;
  }

  // One id per tab: the window's, which `instrument window` and `--tab` take.
  it.each([
    [
      ["tab", "list"],
      "→ [t1] Jar - https://example.com/jar\n  [t2] Bottle - https://example.com/bottle\n",
    ],
    [
      ["tab", "new", "https://example.com/bottle"],
      "https://example.com/bottle\n",
    ],
  ])("names tabs by the window's id after %j", async (args, printed) => {
    const json = JSON.stringify({
      data: {
        tabs: [
          { tabId: "t1", targetId: "tab_01M5Q29YA0CTZ3NQY76Z3JQWBF" },
          {
            active: true,
            tabId: "t2",
            targetId: "tab_01M5Q2CY3JB5G7KJVE1QA1HK0B",
          },
        ],
      },
      success: true,
    });
    await answerAgentBrowser((given) => ({
      exitCode: 0,
      stderr: "",
      stdout: given.includes("--json") ? json : printed,
    }));

    const result = await command.execute(args, commandCtx);

    expect(result.stdout).not.toMatch(/\bt\d\b/);
    expect(result.stdout).toMatchSnapshot();
  });

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

  it("gives a network-idle wait the harness's timeout and reports when the network stayed busy", async () => {
    const { args } = await spawnedWith(["wait", "--load", "networkidle"]);
    expect(args.slice(-5)).toEqual([
      "wait",
      "--load",
      "networkidle",
      "--timeout",
      "5000",
    ]);

    // The run takes the five seconds the cap gives it.
    vi.useFakeTimers({ toFake: ["performance"] });
    try {
      await answerAgentBrowser(() => {
        vi.advanceTimersByTime(5000);
        return upstreamTimeout;
      });
      const result = await command.execute(
        ["wait", "--load", "networkidle"],
        commandCtx,
      );

      expect(result).toEqual({
        exitCode: 0,
        stderr: "",
        stdout: NETWORK_IDLE_GAVE_UP,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    upstreamTimeout,
    {
      exitCode: 1,
      stderr:
        "✗ CDP connection failed: Timeout connecting to CDP at 127.0.0.1:9222\n",
      stdout: "",
    },
  ])(
    "shows a network-idle wait's failure that came back before the cap as it is: $stderr",
    async (answer) => {
      await answerAgentBrowser(answer);
      const result = await command.execute(
        ["wait", "--load", "networkidle"],
        commandCtx,
      );

      expect(result).toEqual(answer);
    },
  );

  it("keeps a named wait's timeout a failure through a chain and says what to do next", async () => {
    await answerAgentBrowser((args) =>
      args.includes("wait")
        ? {
            exitCode: 1,
            stderr: "✗ Wait timed out after 10000ms\n",
            stdout: "",
          }
        : { exitCode: 0, stderr: "", stdout: "✓ Done\n" },
    );
    const bash = new Bash({
      customCommands: [
        createAgentBrowserCommand({
          chatId,
          layout: await sessionLayout({ chatId, sessionId }),
          sessionId,
        }),
      ],
      cwd: commandCtx.cwd,
      fs: commandCtx.fs,
    });

    const result = await bash.exec(
      'agent-browser click @e197 && agent-browser wait --url "**/wiki/MOSFET" && agent-browser get title',
    );

    const spawned = (await agentBrowserRuns()).map((run) => run.args);
    expect(spawned).toHaveLength(2);
    expect(spawned[1]?.slice(-5)).toEqual([
      "wait",
      "--url",
      "**/wiki/MOSFET",
      "--timeout",
      "10000",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("✓ Done\n");
    expect(result.stderr).toBe(
      namedWaitGaveUp({ condition: "**/wiki/MOSFET", kind: "url" }),
    );
  });

  it("passes upload files to the browser absolute", async () => {
    const { args } = await spawnedWith([
      "upload",
      "@e1",
      "attachments/image.png",
    ]);

    expect(args).toContain(path.join(chatFolder, "attachments", "image.png"));
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
    expect(await agentBrowserRuns()).toEqual([]);
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
    "follows $name with a read of the same page only when it has one",
    async ({ args, snapshotArgs }) => {
      await answerAgentBrowser((given) => {
        if (given.includes("list")) {
          return {
            exitCode: 0,
            stderr: "",
            stdout: JSON.stringify({
              data: {
                tabs: [{ active: true, title: "Sign in", url: "http://x/in" }],
              },
            }),
          };
        }
        if (given.includes("eval")) {
          return {
            exitCode: 0,
            stderr: "",
            stdout: JSON.stringify({
              data: {
                result: {
                  loadedAt: 0,
                  regions: [
                    {
                      changedAt: Date.now(),
                      read: true,
                      same: false,
                      text: "That password is wrong.",
                    },
                  ],
                },
              },
              success: true,
            }),
          };
        }
        return { exitCode: 0, stderr: "", stdout: "unchanged (revision 2)\n" };
      });
      const followUp = new BrowserFollowUp();

      await withBrowserFollowUp(followUp, () =>
        command.execute(args, commandCtx),
      );
      const page = await followUp.take(new AbortController().signal);

      const calls = (await agentBrowserRuns()).map((run) => run.args);
      if (snapshotArgs === undefined) {
        expect(page).toBeUndefined();
        expect(calls).toHaveLength(1);
        return;
      }
      expect(page).toMatchObject({
        after: "click",
        kind: "unchanged",
        said: "That password is wrong.",
        title: "Sign in",
        url: "http://x/in",
      });
      // The page's messages are read before the click, then the page after.
      expect(calls).toHaveLength(6);
      expect(calls[0]).toEqual(
        expect.arrayContaining(["--session", sessionId, "--json", "eval"]),
      );
      expect(calls[0]?.at(-1)).toMatch(/\(0, 0\)$/);
      expect(calls[1]?.slice(-2)).toEqual(["click", "@e1"]);
      expect(calls[2]?.slice(-3)).toEqual([
        "wait",
        "--load",
        "domcontentloaded",
      ]);
      expect(calls[3]?.slice(-snapshotArgs.length)).toEqual(snapshotArgs);
      // Together, so either order is the one that happened.
      expect(
        calls
          .slice(4)
          .map((call) => call.slice(0, -1).join(" "))
          .toSorted(),
      ).toEqual([
        expect.stringContaining("--json eval"),
        expect.stringContaining("tab list"),
      ]);
      expect(
        calls
          .slice(4)
          .find((call) => call.includes("eval"))
          ?.at(-1),
      ).toMatch(new RegExp(`\\(\\d+, ${LIVE_REGION_SETTLE_MS}\\)$`));
    },
  );

  it("reads only the page's messages after a call that took its own interactive snapshot", async () => {
    await answerAgentBrowser((given) =>
      given.includes("eval")
        ? {
            exitCode: 0,
            stderr: "",
            stdout: JSON.stringify({
              data: {
                result: {
                  loadedAt: 0,
                  regions: [
                    {
                      changedAt: Date.now(),
                      read: true,
                      same: false,
                      text: "Saved Ada Okafor as contact #1.",
                    },
                  ],
                },
              },
              success: true,
            }),
          }
        : { exitCode: 0, stderr: "", stdout: '- button "Save" [ref=e1]\n' },
    );
    const followUp = new BrowserFollowUp();

    await withBrowserFollowUp(followUp, async () => {
      await command.execute(["click", "@e1"], commandCtx);
      await command.execute(["snapshot", "-i"], commandCtx);
    });

    expect(await followUp.take(new AbortController().signal)).toEqual({
      after: "click",
      kind: "messages",
      said: "Saved Ada Okafor as contact #1.",
      text: "",
    });
    // The reading before the click, the click, the model's snapshot, and the
    // messages after: no second snapshot.
    expect(
      (await agentBrowserRuns()).map((run) =>
        run.args.includes("eval") ? "eval" : run.args.at(-1),
      ),
    ).toEqual(["eval", "@e1", "-i", "eval"]);
  });

  it("attaches the page without its name or message when neither read works", async () => {
    await answerAgentBrowser((given) =>
      given.includes("list") || given.includes("eval")
        ? { exitCode: 1, stderr: "no", stdout: "" }
        : { exitCode: 0, stderr: "", stdout: "unchanged (revision 2)\n" },
    );
    const followUp = new BrowserFollowUp();

    await withBrowserFollowUp(followUp, () =>
      command.execute(["click", "@e1"], commandCtx),
    );

    expect(await followUp.take(new AbortController().signal)).toEqual({
      after: "click",
      kind: "unchanged",
      text: "",
    });
  });

  it("keeps the in-app browser's downloads inside the chat's work folder", async () => {
    const { env } = await spawnedWith(["open", "https://example.com"]);

    expect(env.AGENT_BROWSER_DOWNLOAD_PATH).toBe(
      path.join(workRoot, "downloads"),
    );
  });

  it("keeps agent-browser's home, which holds the plugin it runs, out of the chat's folders", async () => {
    const { env } = await spawnedWith(["open", "https://example.com"]);

    expect(env.HOME).toBe(
      path.join(MOCK_WORKSPACE_DIRS.machine, "browser", "agent-browser-home"),
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
        ["AGENT_BROWSER_INIT_SCRIPTS", "/Users/sam/secrets/hook.js"],
        ["AGENT_BROWSER_EXTENSIONS", "/Users/sam/ext"],
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
    expect(env.AGENT_BROWSER_INIT_SCRIPTS).toBeUndefined();
    expect(env.AGENT_BROWSER_EXTENSIONS).toBeUndefined();
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
    await answerAgentBrowser({ exitCode: 0, stderr: "", stdout: "" });

    const result = await command.execute(args, mockCtx);
    return { result, spawned: (await agentBrowserRuns()).length > 0 };
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
    // An engine picks only what a local launch starts, and the injected
    // provider outranks a local launch upstream, so it stays in the app; with
    // the binary to launch named, it is refused like any other.
    { args: ["--engine", "obscura", "open", "x"], external: false },
    {
      args: ["--engine", "obscura", "--executable-path", "/o", "open", "x"],
      external: true,
    },
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

/**
 * A file named the way Windows names one, which the CLI and the browser open
 * as the path it is rather than as a name in the working folder, so the rules
 * are asked about the file it names. A file this computer does hold is
 * reached in `shell-commands/host-spelled-path.test.ts`, which runs where
 * such a path can be resolved.
 */
describe("agent-browser file operands spelled as the host spells them", () => {
  const platform = process.platform;
  let fs = new InMemoryFs();
  let layout: WorkspaceFsLayout;

  beforeEach(async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    createMockChatConfig(ChatIdSchema.parse("host-spelled"));
    layout = buildWorkspaceFsLayout({
      chatHostRoot: WorkDirSchema.parse(String.raw`C:\Users\sam\chat`),
      rules: {
        home: String.raw`C:\Users\sam`,
        rules: [],
        dangerouslyAllowEveryFolder: false,
      },
    });
    fs = new InMemoryFs();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: platform });
  });

  it("refuses a file outside every folder named by its drive", async () => {
    const result = await resolveAgentBrowserPathArgs(
      ["screenshot", "--path", String.raw`C:\Users\other\shot.png`],
      { cwd: "/c/Users/sam/chat/work", fs },
      layout,
    );

    expect(result).toMatchObject({
      error: expect.stringContaining("/c/Users/other/shot.png"),
    });
  });
});
