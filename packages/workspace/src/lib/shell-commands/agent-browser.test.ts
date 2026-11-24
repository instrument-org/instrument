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
import { agentBrowserSocketDir } from "../agent-browser";
import { publisher } from "../../rpc/publisher";
import { scriptStillRunningMessage } from "../running-page-script";
import { sessionLayout } from "../session-layout";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import {
  buildBashFs,
  buildWorkspaceFsLayout,
  shellPath,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";
import {
  GLOBAL_BOOL_FLAGS,
  GLOBAL_VALUE_FLAGS,
  RESTORE_FLAG,
} from "./agent-browser-args";
import {
  agentBrowserCommandDescription,
  BLOCKED_FLAGS,
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
import {
  DOCUMENT_WAIT_ARGS,
  AFTER_ACTION_PAUSE_ARGS,
} from "./agent-browser-loading";
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

/**
 * Whether a run is one the command adds around the agent's own: the wait for
 * a loading document ahead of it, or the pause after an action.
 */
function isAside(args: string[]) {
  return [DOCUMENT_WAIT_ARGS, AFTER_ACTION_PAUSE_ARGS].some(
    (aside) => args.slice(-aside.length).join("\0") === aside.join("\0"),
  );
}

/** The runs of the CLI without the ones {@link isAside} names. */
async function agentBrowserRunsOfItsOwn() {
  return (await agentBrowserRuns()).filter((run) => !isAside(run.args));
}

/** What upstream prints for an error that mentions a timeout, a load-state wait's aside. */
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

  it.each([...BLOCKED_FLAGS].map((flag) => ({ flag })))(
    "blocks harness-owned flag $flag",
    async ({ flag }) => {
      const result = await command.execute([flag, "value", "open"], mockCtx);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`flag ${flag} is not allowed`);
    },
  );

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

  it.each([
    {
      args: ["window", "new"],
      stderr:
        "agent-browser: `window` is not available in this browser: the windows are Instrument's. Open a tab with `agent-browser tab new <url>`, or put one in front of the user with `instrument window show <url or path>`.\n",
    },
    {
      args: ["--json", "device", "list"],
      stderr:
        "agent-browser: `device` is not available in this browser: it lists iOS simulators for agent-browser's iOS provider, and Instrument's browser is the only one here. `set device <name>` is a different command.\n",
    },
  ])(
    "refuses $args with what to run in its place",
    async ({ args, stderr }) => {
      expect(await command.execute(args, mockCtx)).toEqual({
        exitCode: 1,
        stderr,
        stdout: "",
      });
      expect(await agentBrowserRuns()).toEqual([]);
    },
  );

  it("serves the CLI's core guide, led by what differs in this app", async () => {
    const result = await command.execute(["skills", "get", "core"], mockCtx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^# agent-browser in Instrument\n/);
    expect(result.stdout).toContain("## The core loop");
  });

  it("prints one of the guide's references alone with --ref", async () => {
    const result = await command.execute(
      ["skills", "get", "core", "--ref", "snapshot-refs"],
      mockCtx,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("# agent-browser in Instrument");
    expect(result.stdout).toMatch(/^# /);
    expect(
      await command.execute(
        ["skills", "get", "core", "--ref=references/snapshot-refs.md"],
        mockCtx,
      ),
    ).toEqual(result);
  });

  it.each([
    {
      args: ["skills", "get", "core", "--ref", "authentication"],
      stderr:
        "agent-browser: Reference not found: authentication. Available here: references/instrument.md, references/commands.md, references/snapshot-refs.md, references/trust-boundaries.md.\n",
    },
    {
      args: ["skills", "get", "core", "--ref"],
      stderr:
        "agent-browser: --ref needs a value. Usage: agent-browser skills get core --ref <ref>\n",
    },
    {
      args: ["skills", "get", "core", "--full", "--ref", "commands"],
      stderr:
        "agent-browser: --ref cannot be combined with --full. Usage: agent-browser skills get core --ref <ref>\n",
    },
  ])("refuses $args", async ({ args, stderr }) => {
    expect(await command.execute(args, mockCtx)).toEqual({
      exitCode: 1,
      stderr,
      stdout: "",
    });
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
    { subcommand: "connect" },
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
    /** The chat's tabs, as its window lists them. */
    let chatTabs: string[] = [];
    let stopWindow = () => {};

    afterEach(() => {
      stopWindow();
    });

    beforeEach(() => {
      unblocked.clear();
      chatTabs = [driven];
      stopWindow = publisher.subscribe("window.tab", (ask) => {
        publisher.publish("window.tabDone", {
          id: ask.id,
          requestId: ask.requestId,
          pages: chatTabs.map((id) => ({
            id,
            title: "",
            url: "https://example.com/",
          })),
        });
      });
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
    });

    it("turns blocking off and on for the chat's tabs without spawning the CLI", async () => {
      const off = await command.execute(["adblock", "off"], mockCtx);
      expect(off.stdout).toMatchInlineSnapshot(`
        "Ad blocking is off in this chat's tabs, until \`agent-browser adblock on\` or the app restarts. The user's own setting is unchanged.
        Reload the page (\`agent-browser reload\`) for the change to apply.
        "
      `);
      expect(unblocked.has(driven)).toBe(true);

      const status = await command.execute(["adblock"], mockCtx);
      expect(status.stdout).toContain("off in this chat's tabs");

      const on = await command.execute(["adblock", "on"], mockCtx);
      expect(on.stdout).toMatchInlineSnapshot(`
        "Ad blocking is on in this chat's tabs.
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

    it("asks for a page first when the chat has no tabs", async () => {
      chatTabs = [];
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
    [["--cdp", "9222", "snapshot"], managed, "refuse"],
    // Its path is checked later, against the folder rules.
    [["--init-script", "hook.js", "open", "a.com"], managed, "tabs"],
    [["read", "https://example.com"], managed, "read"],
    [["open", "a.com"], { ...managed, hasNoWindow: true }, "headless"],
    [["open", "a.com"], managed, "tabs"],
    [["tab"], managed, "tabs"],
    [["tab", "keep", "frozen", "tab_01"], managed, "refuse"],
    [["window", "new"], managed, "refuse"],
    [["device", "list"], managed, "refuse"],
    // The setting named alike, which emulates a device in the page.
    [["set", "device", "iPhone 15"], managed, "tabs"],
    // Aliases of commands the app keeps to itself.
    [["quit"], managed, "refuse"],
    [["exit"], managed, "refuse"],
    [["plugins", "list"], managed, "refuse"],
    [["confirm", "c1"], managed, "refuse"],
    [["deny", "c1"], managed, "refuse"],
    [["flow", "run", "checkout"], managed, "refuse"],
    // A global flag's value is not the command.
    [["--input-mode", "human", "close"], managed, "refuse"],
    [["--input-mode", "human", "click", "@e1"], managed, "tabs"],
    [["--capture", "flow", "open", "a.com"], managed, "refuse"],
    [["wait", "#spinner", "--state", "hidden"], managed, "tabs"],
    [["--state", "auth.json", "wait", "#spinner"], managed, "refuse"],
    [["--json", "tab", "--", "keep", "live"], managed, "refuse"],
    // What follows the `--` is the command's data, as it is to the CLI.
    [["type", "@e1", "--", "--allowed-domains"], managed, "tabs"],
    [["fill", "@e1", "--", "--session", "x", "--help"], managed, "tabs"],
    [["type", "@e1", "--", "--extension", "--version"], managed, "tabs"],
    [
      ["--allowed-domains", "a.com", "type", "@e1", "--", "x"],
      managed,
      "refuse",
    ],
    [
      ["type", "@e1", "--allowed-domains", "a.com", "--", "x"],
      managed,
      "refuse",
    ],
    // A `--` a value flag takes is its value, and ends no options.
    [["--user-agent", "--", "--session", "x", "open"], managed, "refuse"],
  ])("%j with %j is %s", (args, config, kind) => {
    expect(classifyInvocation(args, config).kind).toBe(kind);
  });

  // Every global flag the CLI takes, with what the app does with a command
  // that carries it. A flag added to the tables shows up here undecided, as
  // one that passes: refuse it where it selects another browser or
  // connection, or keeps something for the session beyond its command.
  // `--download-path` and `--screenshot-dir` pass with their value dropped.
  it("decides what a command carrying each global flag is", () => {
    const decisions = Object.fromEntries(
      [...GLOBAL_VALUE_FLAGS, ...GLOBAL_BOOL_FLAGS, RESTORE_FLAG]
        .toSorted()
        .map((flag) => [
          flag,
          classifyInvocation(
            GLOBAL_VALUE_FLAGS.has(flag)
              ? [flag, "value", "snapshot"]
              : [flag, "snapshot"],
            managed,
          ).kind,
        ]),
    );
    expect(decisions).toMatchInlineSnapshot(`
      {
        "--action-policy": "refuse",
        "--allow-file-access": "tabs",
        "--allowed-domains": "refuse",
        "--annotate": "tabs",
        "--args": "tabs",
        "--auto-connect": "refuse",
        "--ca-cert": "refuse",
        "--capture": "refuse",
        "--cdp": "refuse",
        "--cdp-headers": "refuse",
        "--color-scheme": "tabs",
        "--config": "refuse",
        "--confirm-actions": "refuse",
        "--confirm-interactive": "tabs",
        "--content-boundaries": "tabs",
        "--debug": "tabs",
        "--device": "tabs",
        "--download-path": "tabs",
        "--enable": "tabs",
        "--engine": "tabs",
        "--executable-path": "refuse",
        "--extension": "refuse",
        "--fix": "tabs",
        "--headed": "tabs",
        "--headers": "tabs",
        "--hide-scrollbars": "tabs",
        "--idle-timeout": "tabs",
        "--ignore-https-errors": "tabs",
        "--init-script": "tabs",
        "--input-mode": "tabs",
        "--json": "tabs",
        "--max-output": "tabs",
        "--model": "tabs",
        "--namespace": "refuse",
        "--no-auto-connect": "tabs",
        "--no-auto-dialog": "tabs",
        "--no-ca-cert": "tabs",
        "--no-pin-tab": "tabs",
        "--no-webmcp": "tabs",
        "--offline": "tabs",
        "--pin-tab": "refuse",
        "--profile": "refuse",
        "--provider": "refuse",
        "--proxy": "tabs",
        "--proxy-bypass": "tabs",
        "--quick": "tabs",
        "--quiet": "tabs",
        "--relaunch": "refuse",
        "--restore": "refuse",
        "--restore-check-fn": "refuse",
        "--restore-check-text": "refuse",
        "--restore-check-url": "refuse",
        "--restore-save": "refuse",
        "--screenshot-dir": "tabs",
        "--screenshot-format": "tabs",
        "--screenshot-quality": "tabs",
        "--session": "refuse",
        "--session-name": "refuse",
        "--state": "refuse",
        "--use-system-ca": "tabs",
        "--user-agent": "tabs",
        "--verbose": "tabs",
        "--webgpu": "tabs",
      }
    `);
  });
});

describe("isBrowserFreeRead", () => {
  it.each([
    { args: ["read", "https://example.com"] },
    { args: ["read", "example.com/docs"] },
    { args: ["read", "--llms", "index", "https://example.com"] },
    { args: ["read", "https://example.com", "--filter", "auth", "--outline"] },
    { args: ["read", "https://example.com", "--headers", '{"A":"b"}'] },
    { args: ["--json", "read", "https://example.com"] },
  ])("treats $args as a fetch that needs no browser", ({ args }) => {
    expect(isBrowserFreeRead(args)).toBe(true);
  });

  it.each([
    // Reads the active page, which only exists in the managed target.
    { args: ["read"] },
    { args: ["read", "--llms", "full"] },
    // Launch configuration: the CLI would answer it with its own browser.
    { args: ["read", "https://example.com", "--headed"] },
    { args: ["read", "https://example.com", "--engine", "firefox"] },
    // Not the read command at all.
    { args: ["open", "https://example.com"] },
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
      AGENT_BROWSER_SOCKET_DIR: agentBrowserSocketDir(process.pid),
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
    {
      args: ["fill", "@e1", "attachments/image.png"],
      name: "a relative path that is not an upload",
    },
  ])("passes $name through as typed", async ({ args }) => {
    const result = await resolveAgentBrowserPathArgs(
      args,
      { cwd: shell, fs },
      layout,
    );

    expect(result).toEqual({ args });
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
    [
      ["screenshot", `${shell}/work/page.png`],
      ["screenshot", host("work", "page.png")],
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
      args: ["upload", "--", "@e1", "../closed/secret.txt"],
      name: "an upload after --",
    },
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
    {
      args: ["cookies", "set", "--curl", "../closed/secret.txt"],
      name: "a file of cookies",
    },
    {
      args: [
        "cookies",
        "set",
        "--domain",
        "x.com",
        "--",
        "--curl",
        "notes.txt",
      ],
      name: "a file of cookies after --, through a link in the work folder",
    },
    {
      args: ["webmcp", "invoke", "echo", "--params", "@../closed/secret.txt"],
      name: "a page tool's input file",
    },
    {
      args: ["webmcp", "invoke", "echo", "@../closed/secret.txt"],
      name: "a page tool's input file after the tool",
    },
    {
      args: ["webmcp", "invoke", "--", "echo", "--frame", "F", "@notes.txt"],
      name: "a page tool's input file past -- and another flag",
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
    // The CLI passes over a `--`, so the file is the word after it.
    { args: ["screenshot", "--", "../closed/page.png"] },
    { args: ["screenshot", "--", "body", "../closed/page.png"] },
    { args: ["screenshot", "body", "--", "../closed/page.png"] },
    { args: ["screenshot", "--full", "--", "body", "--closed/../../closed/p"] },
    { args: ["pdf", "--", "../closed/page"] },
    { args: ["download", "--", "@e1", "../closed/report.csv"] },
    { args: ["download", "@e1", "--", "../closed/report.csv"] },
    { args: ["record", "start", "--", "../closed/take.webm"] },
    { args: ["record", "restart", "--cursor", "--", "../closed/take.webm"] },
    { args: ["trace", "stop", "--", "../closed/trace.json"] },
    { args: ["profiler", "stop", "--", "../closed/profile.json"] },
    { args: ["network", "har", "stop", "--", "../closed/traffic.har"] },
    { args: ["wait", "--download", "../closed/report.csv"] },
    { args: ["wait", "-d", "../closed/report.csv"] },
    // The CLI takes `--timeout` and its value out before it reads the path.
    { args: ["wait", "--download", "--timeout", "5000", "../closed/r.csv"] },
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
    // The `--` stays where it was, and the file after it is the one spelled out.
    [
      ["upload", "--", "@e1", "photo.png"],
      ["upload", "--", "@e1", "<root>/work/photo.png"],
    ],
    [
      ["pdf", "--", "page.pdf"],
      ["pdf", "--", "<root>/work/page.pdf"],
    ],
    [
      ["screenshot", "--", "body", "shot.png"],
      ["screenshot", "--", "body", "<root>/work/shot.png"],
    ],
    [
      ["record", "start", "--", "take.webm", "https://x.com"],
      ["record", "start", "--", "<root>/work/take.webm", "https://x.com"],
    ],
    // Text after the `--` that spells a flag is the page's, not a file.
    [
      ["type", "@e1", "--", "--init-script=hook.js"],
      ["type", "@e1", "--", "--init-script=hook.js"],
    ],
    [
      ["wait", "--download", "report.csv", "--timeout", "5000"],
      ["wait", "--download", "<root>/work/report.csv", "--timeout", "5000"],
    ],
    [
      ["cookies", "set", "--curl", "hook.js", "--domain", "x.com"],
      ["cookies", "set", "--curl", "<root>/work/hook.js", "--domain", "x.com"],
    ],
    [
      ["webmcp", "invoke", "echo", "--params", "@hook.js"],
      ["webmcp", "invoke", "echo", "--params", "@<root>/work/hook.js"],
    ],
    // Words of these commands the CLI opens no file for stay as typed: a
    // wait it answers ahead of the download, a cookie's value and path, a
    // tool's JSON, and a second input, which it refuses unread.
    ...[
      ["wait", "--download"],
      ["wait", "--text", "Done", "--download", "../closed/report.csv"],
      ["cookies", "set", "id", "../closed/secret.txt", "--path", "/api"],
      ["cookies", "get", "--curl", "../closed/secret.txt"],
      ["webmcp", "invoke", "echo", '{"from":"@../closed/secret.txt"}'],
      ["webmcp", "invoke", "echo", "{}", "@../closed/secret.txt"],
      ["webmcp", "list", "@../closed/secret.txt"],
    ].map((args) => [args, args]),
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

    const [run] = await agentBrowserRunsOfItsOwn();
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
      "→ [tab_01M5Q29YA0CTZ3NQY76Z3JQWBF] Jar - https://example.com/jar\n  [tab_01M5Q2CY3JB5G7KJVE1QA1HK0B] Bottle - https://example.com/bottle\n",
    ],
    [
      ["tab", "new", "https://example.com/bottle"],
      "https://example.com/bottle\n",
      "https://example.com/bottle\nOpened as tab tab_01M5Q2CY3JB5G7KJVE1QA1HK0B.\n",
    ],
  ])("names tabs by the window's id after %j", async (args, printed, shown) => {
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

    expect(result.stdout).toBe(shown);
  });

  it.each([
    [
      ["tab", "tab_01M5Q2CY3JB5G7KJVE1QA1HK0B"],
      ["tab", "t2"],
    ],
    [
      ["tab", "close", "tab_01M5Q2CY3JB5G7KJVE1QA1HK0B"],
      ["tab", "close", "t2"],
    ],
  ])("hands agent-browser its own label for %j", async (args, ran) => {
    const json = JSON.stringify({
      data: {
        tabs: [
          { tabId: "t1", targetId: "tab_01M5Q29YA0CTZ3NQY76Z3JQWBF" },
          { tabId: "t2", targetId: "tab_01M5Q2CY3JB5G7KJVE1QA1HK0B" },
        ],
      },
      success: true,
    });
    await answerAgentBrowser((given) => ({
      exitCode: 0,
      stderr: "",
      stdout: given.includes("--json") ? json : "",
    }));

    await command.execute(args, commandCtx);

    const runs = await agentBrowserRuns();
    expect(runs.some((run) => run.args.join(" ").endsWith(ran.join(" ")))).toBe(
      true,
    );
    expect(
      runs.some((run) => run.args.includes("tab_01M5Q2CY3JB5G7KJVE1QA1HK0B")),
    ).toBe(false);
  });

  it("routes a bare command to the in-app browser via the instrument provider", async () => {
    const { args, env } = await spawnedWith(["open", "https://example.com"]);

    expect(args).toContain("--session");
    expect(args[args.indexOf("--session") + 1]).toBe(sessionId);
    expect(env.AGENT_BROWSER_PROVIDER).toBe("instrument");
    expect(env.AGENT_BROWSER_PLUGINS).toContain('"name":"instrument"');
    // Lets the daemon run the plugin under Electron's node on packaged builds.
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("gives the in-app browser its own home, downloads in the chat's work folder, and none of the host's environment", async () => {
    vi.stubEnv("LOCALAPPDATA", String.raw`C:\Users\person\AppData\Local`);

    const { env } = await spawnedWith(["open", "https://example.com"]);

    // Its home holds the plugin it runs, so it is kept out of the chat's folders.
    expect(env.HOME).toBe(
      path.join(MOCK_WORKSPACE_DIRS.machine, "browser", "agent-browser-home"),
    );
    expect(env.AGENT_BROWSER_DOWNLOAD_PATH).toBe(
      path.join(workRoot, "downloads"),
    );
    expect(env.LOCALAPPDATA).toBeUndefined();
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

    await answerAgentBrowser({
      exitCode: 1,
      stderr: "✗ Timed out after 5000ms waiting for load state 'networkidle'\n",
      stdout: "",
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
    "shows a network-idle wait's other failures as they are: $stderr",
    async (answer) => {
      await answerAgentBrowser(answer);
      const result = await command.execute(
        ["wait", "--load", "networkidle"],
        commandCtx,
      );

      expect(result).toEqual(answer);
    },
  );

  // A daemon slower than one 250 ms wait to start (a loaded machine,
  // antivirus on Windows) refused the single retry too (4b561b5d9).
  it("retries a daemon race with backoff until the winner is up", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      let runs = 0;
      await answerAgentBrowser(() =>
        ++runs <= 3
          ? {
              exitCode: 1,
              stderr:
                "✗ A daemon for session 's' started concurrently with different daemon configuration. Retry the command.\n",
              stdout: "",
            }
          : { exitCode: 0, stderr: "", stdout: "Jar\n" },
      );
      let done = false;
      const result = command
        .execute(["get", "title"], commandCtx)
        .finally(() => {
          done = true;
        });
      // The run reads the disk between its waits, so time moves in steps
      // with a turn of the event loop between them.
      while (!done) {
        await vi.advanceTimersByTimeAsync(250);
        await new Promise(setImmediate);
      }

      expect(await result).toMatchObject({ exitCode: 0, stdout: "Jar\n" });
      expect(runs).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

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

    const spawned = (await agentBrowserRunsOfItsOwn()).map((run) => run.args);
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

  it("types text with line breaks as one insertion, each run on the session", async () => {
    await answerAgentBrowser({ exitCode: 0, stderr: "", stdout: "✓ Done\n" });

    const result = await command.execute(
      ["type", "@e5", "First.\n\nSecond.\n"],
      commandCtx,
    );

    const runs = (await agentBrowserRunsOfItsOwn()).map((run) =>
      run.args.slice(run.args.indexOf(sessionId) + 1),
    );
    expect(runs).toStrictEqual([
      ["focus", "@e5"],
      ["keyboard", "inserttext", "First.\n\nSecond."],
      ["press", "Enter"],
    ]);
    expect(result).toStrictEqual({
      exitCode: 0,
      stderr: "",
      stdout: "✓ Done\n",
    });
  });

  it("stops typing at the first run that fails", async () => {
    await answerAgentBrowser((given) =>
      given.includes("focus")
        ? { exitCode: 1, stderr: "✗ Element not found\n", stdout: "" }
        : { exitCode: 0, stderr: "", stdout: "✓ Done\n" },
    );

    const result = await command.execute(["type", "@e9", "a\nb"], commandCtx);

    expect(await agentBrowserRunsOfItsOwn()).toHaveLength(1);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("✗ Element not found\n");
  });

  it("waits for a script the page is still running, and answers with its result", async () => {
    const stillRunning = {
      exitCode: 1,
      stderr: `✗ CDP error (Runtime.evaluate): ${scriptStillRunningMessage({ id: "k3s9x0ab", seconds: 20 })}\n`,
      stdout: "",
    };
    let asked = 0;
    await answerAgentBrowser((given) => {
      if (!given.includes('__instrumentRunningScript("k3s9x0ab")')) {
        return stillRunning;
      }
      asked += 1;
      return asked === 1
        ? stillRunning
        : { exitCode: 0, stderr: "", stdout: '{"pages":90}\n' };
    });

    const result = await command.execute(
      ["eval", "--json", "scanOrders()"],
      commandCtx,
    );

    const runs = (await agentBrowserRunsOfItsOwn()).map((run) =>
      run.args.slice(run.args.indexOf(sessionId) + 1),
    );
    expect(runs).toStrictEqual([
      ["eval", "--json", "scanOrders()"],
      ["eval", "--json", '__instrumentRunningScript("k3s9x0ab")'],
      ["eval", "--json", '__instrumentRunningScript("k3s9x0ab")'],
    ]);
    expect(result).toStrictEqual({
      exitCode: 0,
      stderr: "",
      stdout: '{"pages":90}\n',
    });
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
                  url: "http://x/in",
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

      const calls = (await agentBrowserRunsOfItsOwn()).map((run) => run.args);
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
                  url: "http://x/in",
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
      (await agentBrowserRunsOfItsOwn()).map((run) =>
        run.args.includes("eval") ? "eval" : run.args.at(-1),
      ),
    ).toEqual(["eval", "@e1", "-i", "eval"]);
  });

  it("attaches no message after a click that loaded another page", async () => {
    let evals = 0;
    await answerAgentBrowser((given) => {
      if (!given.includes("eval")) {
        return {
          exitCode: 0,
          stderr: "",
          stdout: '- button "Continue" [ref=e1]\n',
        };
      }
      evals += 1;
      // The reading before the click is of the page it was on; the one after
      // is of a document that began loading during the click.
      const loadedAt = evals === 1 ? 0 : Date.now();
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          data: {
            result: {
              loadedAt,
              url: "http://x/signin",
              regions: [
                {
                  changedAt: loadedAt,
                  read: false,
                  same: false,
                  text: "Sign in or create account",
                },
              ],
            },
          },
          success: true,
        }),
      };
    });
    const followUp = new BrowserFollowUp();

    await withBrowserFollowUp(followUp, () =>
      command.execute(["click", "@e1"], commandCtx),
    );
    const page = await followUp.take(new AbortController().signal);

    expect(page).toMatchObject({ after: "click", kind: "full" });
    expect(page).not.toHaveProperty("said");
    expect(page).not.toHaveProperty("showing");
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

  it("records a failed command and the line it gave for failing", async () => {
    await answerAgentBrowser((given) =>
      given.includes("click")
        ? {
            exitCode: 1,
            stderr: "\u2717 Element ref e621 is stale\nmore detail\n",
            stdout: "",
          }
        : { exitCode: 0, stderr: "", stdout: "" },
    );
    const followUp = new BrowserFollowUp();

    await withBrowserFollowUp(followUp, () =>
      command.execute(["click", "@e621"], commandCtx),
    );

    expect(followUp.takeFailures("")).toEqual({
      failed: [{ command: "click @e621", error: "Element ref e621 is stale" }],
      more: 0,
    });
  });

  /** What each run was given after the session it is on. */
  async function ranOnSession() {
    return (await agentBrowserRuns()).map((run) =>
      run.args.slice(run.args.indexOf(sessionId) + 1),
    );
  }

  function chain(script: string) {
    return sessionLayout({ chatId, sessionId }).then((layout) =>
      new Bash({
        customCommands: [
          createAgentBrowserCommand({ chatId, layout, sessionId }),
        ],
        cwd: commandCtx.cwd,
        fs: commandCtx.fs,
      }).exec(script),
    );
  }

  it("waits for a document the click before it left loading, and gives the page a turn after the click", async () => {
    await answerAgentBrowser({ exitCode: 0, stderr: "", stdout: "✓ Done\n" });

    await chain(
      "agent-browser click @e1410 && agent-browser eval 'document.body.innerText.slice(-5000)'",
    );

    expect(await ranOnSession()).toStrictEqual([
      DOCUMENT_WAIT_ARGS,
      ["click", "@e1410"],
      AFTER_ACTION_PAUSE_ARGS,
      DOCUMENT_WAIT_ARGS,
      ["eval", "document.body.innerText.slice(-5000)"],
    ]);
    expect(DOCUMENT_WAIT_ARGS).toStrictEqual([
      "wait",
      "--load",
      "domcontentloaded",
      "--timeout",
      "5000",
    ]);
  });

  it("runs the command whatever the wait for the document came to", async () => {
    await answerAgentBrowser((given) =>
      given.includes("wait")
        ? {
            exitCode: 1,
            stderr:
              "✗ Timed out after 5000ms waiting for load state 'domcontentloaded'\n",
            stdout: "",
          }
        : { exitCode: 0, stderr: "", stdout: '"Orders placed in 2025"\n' },
    );

    const result = await command.execute(
      ["eval", "document.body.innerText"],
      commandCtx,
    );

    expect(result).toStrictEqual({
      exitCode: 0,
      stderr: "",
      stdout: '"Orders placed in 2025"\n',
    });
  });

  it("gives the page no turn after an action that failed", async () => {
    await answerAgentBrowser((given) =>
      given.includes("click")
        ? { exitCode: 1, stderr: "✗ Element not found\n", stdout: "" }
        : { exitCode: 0, stderr: "", stdout: "✓ Done\n" },
    );

    await command.execute(["click", "@e9"], commandCtx);

    expect(await ranOnSession()).toStrictEqual([
      DOCUMENT_WAIT_ARGS,
      ["click", "@e9"],
    ]);
  });

  it.each([
    [["open", "https://example.com"]],
    [["wait", "2000"]],
    [["get", "url"]],
  ])("adds no run of its own around %j", async (args) => {
    await answerAgentBrowser({ exitCode: 0, stderr: "", stdout: "" });

    await command.execute(args, commandCtx);

    expect(await ranOnSession()).toStrictEqual([args]);
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
    { args: ["--cdp", "9222", "snapshot"] },
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

  it.each([["✗ Navigation failed: net::ERR_FILE_NOT_FOUND"], [""]])(
    "does not match unrelated failure %j",
    (output) => {
      expect(isDaemonConfigRace(output)).toBe(false);
    },
  );
});

describe("isExternalBrowserInvocation", () => {
  it.each([
    { args: ["open", "https://example.com"], external: false },
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
    { args: ["--profile", "Default", "open", "x"], external: true },
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
