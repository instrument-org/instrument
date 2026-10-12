import { execa } from "execa";
import { defineCommand } from "just-bash";
import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { dedent, sleep } from "radashi";

import { CHAT_FOLDER_NAMES } from "../../constants";
import { cdpBridgeUrl } from "../../logic/server/cdp-bridge-path";
import { getWorkspaceServerPort } from "../../logic/server/url";
import { MOUNT } from "../../mount-points";
import { type StoreId } from "../../schemas/store-id";
import { type ChatId } from "../../schemas/chat-id";
import { type BrowserConfig } from "../../types";
import { WebSearch } from "../../tools/web-search";
import { absolutePathJoin } from "../absolute-path-join";
import {
  AGENT_BROWSER_IDLE_TIMEOUT_MS,
  AGENT_BROWSER_PATH,
  AGENT_BROWSER_SOCKET_DIR,
  readSessionName,
} from "../agent-browser";
import {
  INSTRUMENT_PROVIDER_NAME,
  instrumentPluginRegistry,
  writeInstrumentProviderPlugin,
} from "../agent-browser-plugin";
import { agentBrowserGuide } from "../agent-browser-guide";
import { recordVisitedHosts } from "../browser-state";
import { ffmpegSubprocessEnv } from "../ffmpeg";
import { virtualizeHostPaths } from "../filter-shell-output";
import { agentSpellingOfFileUrls } from "../local-page-address";
import { askWindow } from "../chat/window-tab";
import { isAtOrUnder } from "../path-containment";
import { taskFsLayout } from "../resolve-workspace-file-path";
import { getDownloadsDir, getScreenshotsDir } from "../chat-dir-utils";
import { chatDir, resolveChat } from "../record-folders";
import { sessionRole } from "../chat/children";
import { heldTabs, updateHeldTabs } from "../held-tabs";
import { getWorkspaceConfig } from "../workspace-config";
import {
  buildWorkspaceFsLayout,
  classifyVirtualPath,
  resolveNativeHostPath,
} from "../workspace-fs-layout";
import {
  agentBrowserFlagName,
  parseAgentBrowserArgs,
} from "./agent-browser-args";
import { rewriteNavigationArgToFileUrl } from "./agent-browser-file-url";
import {
  currentBrowserFollowUp,
  FOLLOW_UP_SNAPSHOT_ARGS,
  FOLLOW_UP_WAIT_ARGS,
} from "./agent-browser-follow-up";
import {
  mountLiteralError,
  privateDirLiteralError,
  resolveCommandContext,
  resolvePathArgs,
  subprocessStdin,
} from "./utils";
import { workDir } from "../work-dir";

const AGENT_BROWSER_SKILL_NAME = "agent-browser";

export const AGENT_BROWSER_COMMAND = {
  name: AGENT_BROWSER_SKILL_NAME,
} as const;

export function agentBrowserCommandDescription() {
  return [
    `Control a browser to navigate the web, interact with pages, and extract content.`,
    `The first agent-browser command in a session returns agent-browser's guide with its output, led by what differs in this app; read it before the next command. \`agent-browser skills get core\` prints it again.`,
    `A bash call whose last page-changing command (open, click, press, select, check, back, ...) is not followed by a read of the page ends with the page's interactive snapshot, or only what changed in it, so act on those refs instead of running \`snapshot -i\` after it.`,
    `IMPORTANT: Never fabricate specific or deep URLs from memory -- they change and training data is stale. Well-known root domains are fine; for anything more specific, use \`${WebSearch.name}\` first to discover the correct URL before opening the browser.`,
    `Drives the in-app browser, which is the only browser available: this build cannot reach the user's own Chrome, their profiles or logins, or any browser running outside the app.`,
    `Do NOT pass session, config, namespace, or plugin flags; those are managed automatically.`,
  ].join("\n");
}

// Flags rejected because the harness owns them: daemon session identity and
// config/plugin-registry discovery. Connection targeting (--cdp,
// --auto-connect, --provider, --profile, --state, --restore*) is refused as a
// reach for a browser outside the app (see isExternalBrowserInvocation).
export const BLOCKED_FLAGS = new Set([
  "--config", // A managed empty config is injected so task-local agent-browser.json (agent-writable, can register plugins) is never discovered.
  "--namespace", // Would move daemon/restore state outside the workspace-owned namespace.
  "--session", // Harness injects this; derived from our session id.
  "--session-name", // Upstream's alias for --session.
]);

// Launch-state flags that imply an external local Chrome launch when no
// connection-identity flag (--cdp, --auto-connect, --provider) is present:
// the in-app browser is a provider connection that ignores local launch
// options, so these only mean something against an external browser.
const EXTERNAL_STATE_FLAGS = new Set([
  "--executable-path",
  "--profile",
  "--restore",
  "--restore-check-fn",
  "--restore-check-text",
  "--restore-check-url",
  "--restore-save",
  "--state",
]);

// Subcommands rejected because they don't apply to our proxied target or
// duplicate workspace-managed features. CLI-side check; action-policy only
// gates in-session actions, not these meta-commands.
export const BLOCKED_SUBCOMMANDS = new Set([
  "auth", // Credential vault; we don't expose it.
  "batch", // Each line is parsed as a full command (quoted args or --json stdin), which would bypass this argv-level policy.
  "chat", // Built-in AI REPL; the agent is the AI.
  "close", // Lifecycle managed by the workspace.
  "connect", // Sticky daemon connection state; per-invocation --cdp expresses the same thing without hidden routing state.
  "dashboard", // We have our own UI.
  "doctor", // Diagnoses real Chrome installs, not our Electron bridge.
  "inspect", // Opens Chrome DevTools, which doesn't work against our WebContentsView CDP bridge.
  "install", // Browser binary is bundled with the app.
  "launch", // Daemon pre-launch; a command that needs a page already launches on demand. (`read` never does, with or without this: it is skip-launch upstream.)
  "mcp", // MCP tool hosting is managed outside the in-app browser wrapper.
  "plugin", // Plugin capabilities would bypass workspace policy.
  "session", // Session metadata is owned by the workspace.
  "state", // Persistence managed by the workspace.
  "stream", // Streaming managed by the workspace.
  "upgrade", // Binary is bundled; agent shouldn't self-update.
]);

// Flags silently stripped (with their value arg, including --flag=value form)
// because the harness controls them via env vars and must always win.
const STRIPPED_VALUE_FLAGS = new Set([
  "--download-path", // Sandboxed under the app's tmp dir via AGENT_BROWSER_DOWNLOAD_PATH.
  "--screenshot-dir", // Made app-relative via AGENT_BROWSER_SCREENSHOT_DIR.
]);

// Flags that short-circuit the CLI to print info and exit without needing a
// browser target. Skip target creation and provider/--session injection so
// the agent doesn't accidentally spawn a browser view just by running --help.
const INFO_ONLY_FLAGS = new Set(["--help", "--version", "-h", "-V"]);

// Flags a `read <url>` may carry and still be a plain fetch: they shape the
// request or the rendered output, never the browser. Split the way the CLI
// reads them -- its own read parser sees the first two, the third is global and
// consumed before that parser runs.
const READ_FETCH_FLAGS = new Set(["--outline", "--raw", "--require-md"]);
const READ_FETCH_VALUE_FLAGS = new Set(["--filter", "--llms", "--timeout"]);
const READ_SAFE_GLOBAL_FLAGS = new Set([
  "--content-boundaries",
  "--headers",
  "--json",
  "--max-output",
  "--quiet",
  "--verbose",
]);

// The standard proxy vars the CLI falls back to for `--proxy`, which is launch
// configuration like any other.
const PROXY_ENV_VARS = new Set([
  "ALL_PROXY",
  "all_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
]);

const ADBLOCK_SUBCOMMAND = "adblock";

const SKILLS_SUBCOMMAND = "skills";

/**
 * `agent-browser skills`: the CLI's own guide, answered here so it comes with
 * what differs in this app (`agent-browser-guide.ts`). Only the core guide is
 * offered; the others describe running agent-browser somewhere else.
 */
function skills(
  operands: (string | undefined)[],
  full: boolean,
): { exitCode: number; stderr: string; stdout: string } {
  const [action = "list", ...names] = operands.filter(
    (operand) => operand !== undefined && !operand.startsWith("-"),
  );
  if (action === "list") {
    return {
      exitCode: 0,
      stderr: "",
      stdout:
        "core  The guide to agent-browser in this app. Run `agent-browser skills get core`, with --full for its references.\n",
    };
  }
  if (action === "get" && names.length === 1 && names[0] === "core") {
    return { exitCode: 0, stderr: "", stdout: agentBrowserGuide({ full }) };
  }
  return {
    exitCode: 1,
    stderr:
      "agent-browser: only `skills get core` is available in this app; the other skills describe running agent-browser somewhere else.\n",
    stdout: "",
  };
}

/**
 * `agent-browser adblock [on|off]`: the task's own say over the ad and tracker
 * blocking in the tabs it drives, for a page the block lists broke. Answered
 * here rather than by the CLI, since the blocking lives in the app, not in
 * the browser.
 */
async function adblock(
  browser: BrowserConfig,
  { chatId, sessionId }: { chatId: ChatId; sessionId: StoreId.Session },
  mode: string | undefined,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  if (mode !== undefined && mode !== "on" && mode !== "off") {
    return {
      exitCode: 1,
      stderr: "agent-browser: usage: agent-browser adblock [on|off]\n",
      stdout: "",
    };
  }
  const targets = (await heldTabs(chatId, sessionId)).map((tab) => tab.id);
  if (targets.length === 0) {
    return {
      exitCode: 1,
      stderr:
        "agent-browser: adblock applies to the tabs you have open, and you have none yet. Open the page first.\n",
      stdout: "",
    };
  }
  const { task, workspace } = browser.contentBlocking(
    targets,
    mode === undefined ? undefined : mode === "on",
  );
  const state = !workspace
    ? "Ad blocking is off: the user turned it off for every page."
    : task
      ? "Ad blocking is on in this task's tabs."
      : "Ad blocking is off in this task's tabs, until `agent-browser adblock on` or the app restarts. The user's own setting is unchanged.";
  const reload =
    mode !== undefined && workspace
      ? "\nReload the page (`agent-browser reload`) for the change to apply."
      : "";
  return { exitCode: 0, stderr: "", stdout: `${state}${reload}\n` };
}

const WORKSPACE_HELP_MANAGED = dedent`
  agent-browser - Control the task's managed browser.

  The \`agent-browser\` skill is the source of truth for workflow details and
  command examples; it comes with the first command of a session.
  The workspace manages the browser session, CDP connection,
  profile, state, screenshots, downloads, and lifecycle.

  Core workflow:
    1. agent-browser open <url>
    2. Act on @refs from the snapshot the result ends with
    3. Each action that changes the page ends with what changed in it;
       run snapshot -i yourself only for what that leaves out

  Inspecting a file you created:
    agent-browser open work/report.html     Task files load in the browser
    agent-browser open ${MOUNT.task}/work/x.html  Task-relative, ${MOUNT.task}/..., ${MOUNT.folders}/...,
                                            and file://${MOUNT.task}/... all work
  Use this to check an HTML deliverable end to end -- rendered layout, interactivity, and console errors -- not just its source.

  Reading page content:
    agent-browser read                 Read the active page as agent-friendly text
    agent-browser read <url>           Fetch a URL as Markdown or readable text
    agent-browser get text body        Fallback for visible page copy

  Use snapshot -i --urls when following links. Never fabricate deep URLs from memory; discover them from search, root pages, provided URLs, or page links.

  Common commands:
    open <url>                  Navigate to a URL
    read [url]                  Read active page text or fetch a URL
    snapshot -i [--urls]        Get interactive refs, optionally with link URLs
    click @ref                  Click an element, scrolling into view first
    fill @ref <text>            Clear and fill an element
    type @ref <text>            Type without clearing
    press <key>                 Press a key
    hover | focus | select      Interact with controls by @ref
    check | uncheck             Toggle checkboxes by @ref
    scrollintoview @ref         Bring an element into view before screenshots
    wait @ref | wait --url ...  Wait for elements, URL patterns, text, or load
    get text body               Read visible page copy
    get text|html|value|attr    Read targeted element details
    get url | get title         Read page metadata
    screenshot [path|@ref]      Capture the page or an element
    is visible|enabled|checked  Check element state
    find role|text|label ...    Use semantic locators as an alternative to refs
    adblock [on|off]            Show or set ad and tracker blocking for this
                                task's tabs (on by default)

  Ads and trackers are blocked in this browser. If a page looks broken --
  a missing button, an empty embed, a checkout or sign-in that never
  loads -- run \`agent-browser adblock off\`, reload, and try again.
  Turn it back on when done.

  Do not pass session, config, namespace, or plugin flags; the workspace
  manages daemon sessions and the plugin registry.
`.trim();

/**
 * The env a browser-free read runs with: launch configuration removed, and only
 * what the fetch itself needs put back.
 *
 * Any launch option the CLI can see on an invocation with no `--cdp` target to
 * attach to is answered by launching a real browser -- so the whole
 * `AGENT_BROWSER_*` namespace goes, wholesale rather than by name, and options
 * upstream adds later are covered by construction. Everything outside that
 * namespace (PATH, TMPDIR, the Windows system vars) is inherited untouched,
 * apart from the proxy vars `--proxy` falls back to.
 */
export function browserFreeReadEnv(env: Record<string, string | undefined>) {
  const inherited = Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => !key.startsWith("AGENT_BROWSER_") && !PROXY_ENV_VARS.has(key),
    ),
  );
  return {
    ...inherited,
    // The daemon this read starts is reaped on the same timer as every other
    // one, and its fingerprint has to match across invocations of its session.
    AGENT_BROWSER_IDLE_TIMEOUT_MS,
    AGENT_BROWSER_SOCKET_DIR,
  };
}

/**
 * Whether an invocation is a `read <url>`, which the CLI answers with an HTTP
 * fetch and a Markdown conversion -- no page, no CDP, no browser.
 *
 * Deliberately exact: subcommand `read`, one positional, and no flag outside
 * the fetch/output sets above. Every other flag is a potential launch option,
 * and a launch option on an invocation with no `--cdp` target makes the CLI
 * start a browser of its own, so an unrecognized one sends the command back to
 * the normal target-backed path instead.
 *
 * `read` without a URL is not this: it reads the active page, which needs the
 * target (as do `--llms` and `--require-md` without a URL, which resolve the
 * active page's URL first).
 */
export function isBrowserFreeRead(args: string[]): boolean {
  const { globalFlags, subArgs, subcommand } = parseAgentBrowserArgs(args);
  if (subcommand !== "read") {
    return false;
  }
  if (globalFlags.some(({ name }) => !READ_SAFE_GLOBAL_FLAGS.has(name))) {
    return false;
  }

  let url: string | undefined;
  for (let i = 1; i < subArgs.length; i++) {
    const arg = subArgs[i]?.value;
    if (arg === undefined) {
      continue;
    }
    if (READ_FETCH_VALUE_FLAGS.has(arg)) {
      // The CLI's read parser takes these values as the next argument only, so
      // a `--flag=value` form falls through and disqualifies the invocation.
      i++;
      continue;
    }
    if (READ_FETCH_FLAGS.has(arg)) {
      continue;
    }
    if (arg.startsWith("-")) {
      return false;
    }
    if (url !== undefined) {
      return false;
    }
    url = arg;
  }

  return url !== undefined;
}

/**
 * The CLI refuses a command when a daemon is already running for the session
 * under a different configuration than the invocation asks for, which two
 * commands racing to start that session's daemon can trigger. The refusal
 * happens before the command runs, so a retry cannot repeat a page action; it
 * just lets agent-browser restart the daemon on the requested configuration,
 * which is what the CLI's own message asks for.
 */
export function isDaemonConfigRace(output: string): boolean {
  return output.includes(
    "started concurrently with different daemon configuration",
  );
}

/**
 * Subcommands whose operands include a file the browser process reads or
 * writes. Every other subcommand's operands are text the page receives as
 * typed (an `eval` script, a `fill` value, a `wait --fn` body), where a
 * leading `/` is a comment, a regex or a slash command, never a path.
 */
const FILE_OPERAND_SUBCOMMANDS = new Set([
  "diff",
  "download",
  "network",
  "pdf",
  "profiler",
  "record",
  "screenshot",
  "trace",
  "upload",
]);

/**
 * Resolve virtual absolute paths in global flag values and in the operands of
 * subcommands that take a file, then validate and bridge every file operand of
 * `upload`. CDP reports success for missing files, so the wrapper must fail
 * before handing them to the browser process.
 */
export async function resolveAgentBrowserPathArgs(
  args: string[],
  chatId: ChatId,
  ctx: {
    cwd: string;
    fs: {
      exists(path: string): Promise<boolean>;
      resolvePath(cwd: string, path: string): string;
    };
  },
): Promise<{ args: string[] } | { error: string }> {
  const { subArgs, subcommand } = parseAgentBrowserArgs(args);
  const textOperands = new Set(
    subcommand !== undefined && !FILE_OPERAND_SUBCOMMANDS.has(subcommand)
      ? subArgs.slice(1).map(({ index }) => index)
      : [],
  );
  const resolved = args.map((arg, index) =>
    textOperands.has(index)
      ? arg
      : (resolvePathArgs([arg], chatId, ctx)[0] ?? arg),
  );
  if (subcommand !== "upload") {
    return { args: resolved };
  }

  const layout = buildWorkspaceFsLayout({ taskHostRoot: workDir(chatId) });
  for (const { index, value } of subArgs.slice(2)) {
    const virtualPath = ctx.fs.resolvePath(ctx.cwd, value);

    if (isAtOrUnder(MOUNT.folders, virtualPath)) {
      return { error: mountLiteralError("Upload") };
    }

    if (classifyVirtualPath(layout, virtualPath)?.masked !== undefined) {
      return { error: privateDirLiteralError("Upload") };
    }

    if (!isAtOrUnder(MOUNT.task, virtualPath)) {
      return {
        error:
          `Upload file "${virtualPath}" is outside ${MOUNT.task}. ` +
          `Copy the file into the task first and use a task-relative path.`,
      };
    }

    if (!(await ctx.fs.exists(virtualPath))) {
      return { error: `Upload file not found: "${value}".` };
    }

    resolved[index] = resolveNativeHostPath(workDir(chatId), virtualPath);
  }
  return { args: resolved };
}

/**
 * Written to contradict a model that believes otherwise: training data, a
 * stale skill copy on the user's machine, or its own earlier turn in this
 * session. It states the absence, then names the route that does work, so the
 * refusal reads as a redirect rather than a wall to retry against.
 */
function externalBrowserUnavailableMessage() {
  return [
    "agent-browser: external browsers are not available in this build.",
    "There is no access to the user's own Chrome, their profiles or logins, or any browser running outside the app, and no flag or subcommand reaches one. Do not retry with a different targeting flag.",
    "The task's managed browser is the only browser. It keeps cookies and signed-in sessions across a task, so when a page needs an account, open it there and ask the user to sign in -- they can see and use that browser in the app.",
    "",
  ].join("\n");
}

/**
 * What one `agent-browser` invocation is, decided from its arguments alone,
 * before anything runs:
 *
 * - `refuse`: a flag, subcommand or target the app does not allow, with why.
 * - `help`, `adblock`, `skills`: answered here, with no CLI at all.
 * - `info`: `--version` and the like, which print and touch no browser.
 * - `read`: a fetch with no page, on a daemon session of its own.
 * - `headless`: no window to drive (the eval harness), so the CLI starts a
 *   browser of its own.
 * - `tabs`: the chat's tabs in the window, through the CDP endpoint.
 */
export type Invocation =
  | { kind: "adblock"; mode: string | undefined }
  | { kind: "headless" }
  | { kind: "help" }
  | { kind: "info" }
  | { kind: "read" }
  | { kind: "refuse"; stderr: string }
  | { full: boolean; kind: "skills"; words: string[] }
  | { kind: "tabs" };

export function classifyInvocation(
  args: string[],
  { hasNoWindow }: { hasNoWindow: boolean },
): Invocation {
  if (args.some((a) => a === "--help" || a === "-h")) {
    return { kind: "help" };
  }
  // Matches --flag, --flag=value, and short aliases (-p for --provider).
  const blockedArg = args.find((a) =>
    BLOCKED_FLAGS.has(agentBrowserFlagName(a)),
  );
  if (blockedArg) {
    return {
      kind: "refuse",
      stderr: `agent-browser: flag ${blockedArg} is not allowed. The browser session is managed automatically.\n`,
    };
  }
  const { subArgs, subcommand } = parseAgentBrowserArgs(args);
  if (subcommand === ADBLOCK_SUBCOMMAND) {
    return { kind: "adblock", mode: subArgs[1]?.value };
  }
  if (subcommand === SKILLS_SUBCOMMAND) {
    return {
      full: args.includes("--full"),
      kind: "skills",
      words: subArgs.slice(1).map((arg) => arg.value),
    };
  }
  if (subcommand && BLOCKED_SUBCOMMANDS.has(subcommand)) {
    return {
      kind: "refuse",
      stderr: `agent-browser: subcommand '${subcommand}' is not available in this environment.\n`,
    };
  }
  const isInfoOnly = args.some((a) => {
    const flagName = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
    return INFO_ONLY_FLAGS.has(flagName);
  });
  if (isInfoOnly) {
    return { kind: "info" };
  }
  // A reach for a browser outside the app, which there is none of. Refused
  // rather than ignored: dropping the targeting flag and running the command
  // anyway would answer it on the app's browser, and the agent would report
  // acting as the user's signed-in identity while holding a session that was
  // never theirs.
  if (isExternalBrowserInvocation(args) || subcommand === "profiles") {
    return { kind: "refuse", stderr: externalBrowserUnavailableMessage() };
  }
  if (isBrowserFreeRead(args)) {
    return { kind: "read" };
  }
  return hasNoWindow ? { kind: "headless" } : { kind: "tabs" };
}

const DAEMON_RACE_RETRY_DELAY_MS = 250;

interface SpawnAgentBrowserOptions {
  args: string[];
  cancelSignal: AbortSignal | undefined;
  cwd: string;
  env: Record<string, string | undefined>;
  input: Buffer | undefined;
  managedConfigPath: string | undefined;
  stateDir: string;
}

export function createAgentBrowserCommand({
  sessionId,
  chatId,
}: {
  sessionId: StoreId.Session;
  chatId: ChatId;
}) {
  return defineCommand(AGENT_BROWSER_COMMAND.name, async (args, ctx) => {
    const workspaceConfig = getWorkspaceConfig();
    const serverPort = getWorkspaceServerPort();

    const id = chatId;
    const invocation = classifyInvocation(args, {
      hasNoWindow: workspaceConfig.browser.hasNoWindow,
    });
    switch (invocation.kind) {
      case "adblock": {
        return adblock(
          workspaceConfig.browser,
          { chatId: id, sessionId },
          invocation.mode,
        );
      }
      case "help": {
        return { exitCode: 0, stderr: "", stdout: WORKSPACE_HELP_MANAGED };
      }
      case "refuse": {
        return { exitCode: 1, stderr: invocation.stderr, stdout: "" };
      }
      case "skills": {
        return skills(invocation.words, invocation.full);
      }
      default: {
        break;
      }
    }
    const isInfoOnly = invocation.kind === "info";
    const browserFreeRead = invocation.kind === "read";

    const { env, taskCwd } = resolveCommandContext(chatId, ctx);
    const strippedArgs = stripHarnessControlledFlags(args);
    const layout = await taskFsLayout(chatId);
    const navigationArgs = await rewriteNavigationArgToFileUrl(
      strippedArgs,
      layout,
      ctx,
    );
    if ("error" in navigationArgs) {
      return {
        exitCode: 1,
        stderr: `agent-browser: ${navigationArgs.error}\n`,
        stdout: "",
      };
    }
    const bridgedArgs = await resolveAgentBrowserPathArgs(
      navigationArgs.args,
      chatId,
      ctx,
    );
    if ("error" in bridgedArgs) {
      return {
        exitCode: 1,
        stderr: `agent-browser: ${bridgedArgs.error}\n`,
        stdout: "",
      };
    }
    const resolvedArgs = bridgedArgs.args;

    // just-bash sets HOME=/ which is read-only. Most agent-browser writes are
    // already redirected via dedicated env vars (socket dir, screenshot dir,
    // download path); this is a per-task sink for anything that falls back
    // to $HOME, and holds the managed config and provider plugin script.
    const homeDir = absolutePathJoin(
      chatDir(chatId),
      CHAT_FOLDER_NAMES.private,
      "agent-browser-home",
    );
    const configPath = path.join(homeDir, "config.json");

    const commandArgs: string[] = [];
    // A chat's session, which drives the tabs it holds rather than one page.
    const drivesHeldTabs = invocation.kind === "tabs";
    let pluginRegistry: string | undefined;

    if (isInfoOnly) {
      // Info-only invocations (--help, --version) print and exit without ever
      // touching a browser target, so don't spin up a WebContentsView or attach
      // to the CDP bridge.
      commandArgs.push(...resolvedArgs);
    } else if (browserFreeRead) {
      // A fetch needs no view either; creating one would leave the user staring
      // at an empty browser panel the agent never navigates. It still needs a
      // daemon, which gets its own session so the in-app browser's daemon is
      // still only ever started by an invocation that resolves the provider:
      // one started without it holds no CDP endpoint and would launch its own
      // browser the next time a command needed a page.
      commandArgs.push(
        "--session",
        readSessionName(sessionId),
        ...resolvedArgs,
      );
    } else if (invocation.kind === "headless") {
      // No window to drive, so leave the provider unregistered and let the CLI
      // start a browser of its own. It does that correctly, and it is the
      // difference between a task that can open the page it just wrote and one
      // that gets a CDP deserialization error on every attempt. A stock
      // Chromium refuses a `file://` page its scripts, modules, and fetches of
      // the files beside it, which the app's guest allows, so the flag keeps a
      // page the agent opens here working the way it will for the person. It
      // also lets such a page read any file on the machine, with none of the
      // app's folder rules; only the eval harness runs without a window, on a
      // machine holding nobody's files but its own.
      commandArgs.push(
        "--session",
        sessionId,
        "--allow-file-access",
        ...resolvedArgs,
      );
    } else {
      const refused = await refuseBrowserFor(id, sessionId);
      if (refused !== undefined) {
        return { exitCode: 1, stderr: refused, stdout: "" };
      }

      const cdpUrl = cdpBridgeUrl(serverPort, id, sessionId);
      const pluginPath = await writeInstrumentProviderPlugin(homeDir);
      pluginRegistry = instrumentPluginRegistry({ cdpUrl, pluginPath });
      commandArgs.push("--session", sessionId, ...resolvedArgs);
    }

    const screenshotDir = getScreenshotsDir(workDir(chatId));
    const downloadPath = getDownloadsDir(workDir(chatId));
    const agentBrowserStateDir = screenshotDir;
    // Relative so agent-browser outputs screenshot paths the agent sees as
    // relative to its cwd (e.g. "work/screenshots/shot.png"), not host
    // absolute.
    const screenshotDirRelative = path.relative(taskCwd, screenshotDir);

    const spawnEnv = {
      ...env,
      // `agent-browser record` spawns a real `ffmpeg` process by bare name,
      // resolved against PATH. The bundled ffmpeg binary isn't on the sandbox
      // PATH, so prepend its dir (the in-bash `ffmpeg` command is a just-bash
      // intercept that a separate subprocess can't see).
      ...ffmpegSubprocessEnv(env.PATH),
      // Null out env-var equivalents of harness-owned and connection flags so
      // the user shell can't bypass flag policy. Connection targeting must
      // arrive as CLI flags, where they are refused.
      AGENT_BROWSER_AUTO_CONNECT: undefined,
      AGENT_BROWSER_CDP: undefined,
      AGENT_BROWSER_CONFIG: undefined,
      // Uncomment this to enable debug mode.
      // AGENT_BROWSER_DEBUG:
      //   process.env.NODE_ENV === "development" ? "1" : undefined,
      AGENT_BROWSER_EXECUTABLE_PATH: undefined,
      AGENT_BROWSER_DOWNLOAD_PATH: downloadPath, // Passed to Chrome via CDP setDownloadBehavior, which requires an absolute path.
      AGENT_BROWSER_IDLE_TIMEOUT_MS,
      AGENT_BROWSER_NAMESPACE: undefined,
      AGENT_BROWSER_PLUGINS: pluginRegistry,
      AGENT_BROWSER_PROFILE: undefined,
      AGENT_BROWSER_PROVIDER: pluginRegistry
        ? INSTRUMENT_PROVIDER_NAME
        : undefined,
      AGENT_BROWSER_RESTORE: undefined,
      AGENT_BROWSER_RESTORE_CHECK_FN: undefined,
      AGENT_BROWSER_RESTORE_CHECK_TEXT: undefined,
      AGENT_BROWSER_RESTORE_CHECK_URL: undefined,
      AGENT_BROWSER_RESTORE_SAVE: undefined,
      AGENT_BROWSER_SCREENSHOT_DIR: screenshotDirRelative,
      AGENT_BROWSER_SESSION: undefined,
      AGENT_BROWSER_SESSION_NAME: undefined,
      AGENT_BROWSER_SOCKET_DIR,
      AGENT_BROWSER_STATE: undefined,
      // The daemon spawns the provider plugin via process.execPath. In
      // packaged builds that is the Electron binary, which this var makes
      // behave as plain node. Inert for the Rust CLI and for Chrome.
      ELECTRON_RUN_AS_NODE: pluginRegistry ? "1" : undefined,
      // A per-task sink instead of the host home.
      HOME: homeDir,
    };

    const spawnOptions = {
      cwd: taskCwd,
      env: browserFreeRead ? browserFreeReadEnv(spawnEnv) : spawnEnv,
      managedConfigPath: isInfoOnly ? undefined : configPath,
      stateDir: agentBrowserStateDir,
    };
    let result: Awaited<ReturnType<typeof runAgentBrowser>>;
    try {
      result = await runAgentBrowser({
        ...spawnOptions,
        args: commandArgs,
        cancelSignal: ctx.signal,
        input: subprocessStdin(ctx.stdin),
      });
    } finally {
      if (drivesHeldTabs) {
        await recordHeldTabHosts({ sessionId, chatId });
      }
    }

    const scrub = (text: string) =>
      virtualizeHostPaths(agentSpellingOfFileUrls(text, layout), layout);

    const exitCode = result.exitCode ?? 1;

    // A fetch or --help has no page.
    if (!isInfoOnly && !browserFreeRead) {
      // The session and connection flags this invocation was given, ahead of
      // the agent's own arguments, so the snapshot reaches the same page.
      const connectionArgs = commandArgs.slice(
        0,
        commandArgs.length - resolvedArgs.length,
      );
      currentBrowserFollowUp()?.note({
        args: resolvedArgs,
        exitCode,
        snapshot: async (signal) => {
          // A click returns before the page it navigated to has loaded, and a
          // snapshot of a loading document has no controls in it. Resolves at
          // once on a page that is already past loading.
          await runAgentBrowser({
            ...spawnOptions,
            args: [...connectionArgs, ...FOLLOW_UP_WAIT_ARGS],
            cancelSignal: signal,
            input: undefined,
          });
          const snapshot = await runAgentBrowser({
            ...spawnOptions,
            args: [...connectionArgs, ...FOLLOW_UP_SNAPSHOT_ARGS],
            cancelSignal: signal,
            input: undefined,
          });
          return snapshot.exitCode === 0 ? scrub(snapshot.stdout) : undefined;
        },
      });
    }

    return {
      exitCode,
      stderr: scrub(result.stderr),
      stdout: scrub(result.stdout),
    };
  });
}

/**
 * True when the invocation targets a browser other than the Instrument task
 * browser. Mirrors upstream connection-identity precedence (cdp >
 * auto-connect > provider > local launch): an explicit `--provider
 * instrument` keeps a mixed invocation like `--profile x --provider
 * instrument` on the in-app browser, exactly as the CLI itself would resolve
 * it, and a literal `--auto-connect false` opt-out is honored.
 */
export function isExternalBrowserInvocation(args: string[]): boolean {
  // Reads the flags the CLI will actually consume as globals, so an inline
  // `--cdp=9222` -- which upstream does not honor, leaving it to be read as
  // the subcommand -- does not route anywhere the CLI would not go.
  const { globalFlags } = parseAgentBrowserArgs(args);
  let providerName: string | undefined;
  let hasCdp = false;
  let hasAutoConnect = false;
  let hasStateFlag = false;
  for (const { name, value } of globalFlags) {
    switch (name) {
      case "--auto-connect": {
        if (value !== "false") {
          hasAutoConnect = true;
        }
        break;
      }
      case "--cdp": {
        hasCdp = true;
        break;
      }
      case "--provider": {
        providerName = value;
        break;
      }
      default: {
        if (EXTERNAL_STATE_FLAGS.has(name)) {
          hasStateFlag = true;
        }
      }
    }
  }
  if (hasCdp || hasAutoConnect) {
    return true;
  }
  if (providerName !== undefined) {
    return providerName.toLowerCase() !== INSTRUMENT_PROVIDER_NAME;
  }
  return hasStateFlag;
}

/**
 * The hosts of the pages in the tabs a chat's task holds, recorded as the
 * sites its work used: read after the command, so a tab it just opened and a
 * page it just reached are both there.
 */
async function recordHeldTabHosts({
  sessionId,
  chatId,
}: {
  sessionId: StoreId.Session;
  chatId: ChatId;
}) {
  const { browser } = getWorkspaceConfig();
  try {
    const urls = (await heldTabs(chatId, sessionId)).flatMap((tab) => {
      const url = browser.getTargetUrl(tab.id);
      return url ? [url] : [];
    });
    const result = await recordVisitedHosts({ sessionId, chatId, urls });
    if (result.isErr()) {
      getWorkspaceConfig().captureException(result.error);
    }
  } catch (error) {
    getWorkspaceConfig().captureException(error);
  }
}

/**
 * Why a chat or task cannot browse right now, or nothing when it can. Each
 * drives the tabs of the chat it holds: tabs the conversation handed it,
 * which are the user's and outlive the task, and tabs it opened itself, each
 * opened behind whatever the user has up, so every page the agent works in
 * is one the user can find in the chat's tabs and none is put in front of
 * them. A page the user has open is handed to a task (`task new --tab`).
 */
async function refuseBrowserFor(
  id: ChatId,
  sessionId: StoreId.Session,
): Promise<string | undefined> {
  const held = await heldTabs(id, sessionId);
  if (held.length === 0) {
    // None yet: agent-browser asks a browser with no pages for one, which
    // the endpoint makes as a page with no tab until it goes somewhere.
    return undefined;
  }
  const { browser } = getWorkspaceConfig();
  const answer = await askWindow({
    action: { kind: "list" },
    askedBy: id,
    group: resolveChat(id),
  });
  if (!answer?.tabs) {
    // No window answered; nothing is known to be gone.
    return undefined;
  }
  const listed = new Set(answer.tabs.map((tab) => tab.id));
  // A tab is still held while the window lists it, its page discarded or
  // not (it comes back as it is attached to); a page with no tab while its
  // guest is up.
  const kept = held.filter((tab) =>
    tab.inWindow ? listed.has(tab.id) : browser.getTargetMeta(tab.id) !== null,
  );
  if (kept.length < held.length) {
    await updateHeldTabs(id, sessionId, (tabs) =>
      tabs.filter((tab) => kept.some((alive) => alive.id === tab.id)),
    );
  }
  if (kept.length > 0) {
    return undefined;
  }
  // A page with no tab that went with a relaunch was never the user's to see.
  const closed = held.filter((tab) => tab.inWindow);
  // A task handed tabs works in those alone; the chat, which gets them back
  // when the task finishes, goes on with a new one.
  if (
    sessionRole(id, sessionId) === "task" &&
    closed.some((tab) => tab.openedBy === "handed")
  ) {
    // The user closed the tabs, or the window they were in, since the task
    // was handed them.
    return "agent-browser: the tab this task was handed is closed, so there is no page to act on. Say so and finish with what you have.\n";
  }
  if (closed.length > 0) {
    // The session's own tabs, closed by the user or by the conversation:
    // said once, so it knows the pages it was on are gone rather than
    // finding a blank one, and the next command opens a new tab.
    return "agent-browser: the tabs you opened were closed by the user or the conversation, and the pages in them are gone. The next command opens a new tab; start again from the page's address.\n";
  }
  return undefined;
}

async function runAgentBrowser(options: SpawnAgentBrowserOptions) {
  const first = await spawnAgentBrowser(options);
  if (
    first.exitCode === 0 ||
    !isDaemonConfigRace([first.stdout, first.stderr].join("\n"))
  ) {
    return first;
  }

  // Let the daemon that won the race finish starting; retrying into its
  // startup window would be refused for the same reason.
  await sleep(DAEMON_RACE_RETRY_DELAY_MS);
  return await spawnAgentBrowser(options);
}

async function spawnAgentBrowser({
  args,
  cancelSignal,
  cwd,
  env,
  input,
  managedConfigPath,
  stateDir,
}: SpawnAgentBrowserOptions) {
  const managedArgs = managedConfigPath
    ? ["--config", managedConfigPath, ...args]
    : args;

  if (managedConfigPath) {
    await fs.mkdir(path.dirname(managedConfigPath), { recursive: true });
    await fs.writeFile(managedConfigPath, "{}\n");
  }

  if (process.platform !== "win32") {
    return await execa(AGENT_BROWSER_PATH, managedArgs, {
      cancelSignal,
      cwd,
      env,
      input,
      reject: false,
      // Keep the final newline; the interpreter concatenates each command's
      // output, so dropping it runs this command's last line into the next.
      // Set here rather than via execShim because the Windows branch below
      // reads the two streams back from files and has no merged stream to
      // return, so both paths keep stdout and stderr separate.
      stripFinalNewline: false,
    });
  }

  await fs.mkdir(stateDir, { recursive: true });
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const stdoutPath = path.join(stateDir, `command-output-${runId}.stdout.log`);
  const stderrPath = path.join(stateDir, `command-output-${runId}.stderr.log`);
  const stdoutFd = fsSync.openSync(stdoutPath, "w");
  const stderrFd = fsSync.openSync(stderrPath, "w");

  try {
    // On Windows, most agent-browser commands otherwise appear to take ~30s to
    // resolve even though the CDP work is already done. agent-browser starts a
    // detached daemon that can keep inherited stdout/stderr pipe handles alive;
    // waiting directly on the CLI process exit avoids treating pipe EOF as part
    // of command completion.
    const child = spawn(AGENT_BROWSER_PATH, managedArgs, {
      cwd,
      env,
      stdio: ["pipe", stdoutFd, stderrFd],
      windowsHide: true,
    });
    fsSync.closeSync(stdoutFd);
    fsSync.closeSync(stderrFd);

    const exitCode = await new Promise<number | undefined>(
      (resolve, reject) => {
        const abort = () => {
          child.kill();
        };

        cancelSignal?.addEventListener("abort", abort, { once: true });
        child.once("error", (error) => {
          cancelSignal?.removeEventListener("abort", abort);
          reject(error);
        });
        child.once("exit", (code) => {
          cancelSignal?.removeEventListener("abort", abort);
          resolve(code ?? undefined);
        });

        if (input === undefined) {
          child.stdin?.end();
        } else {
          child.stdin?.end(input);
        }
      },
    );

    const [stdout, stderr] = await Promise.all([
      fs.readFile(stdoutPath, "utf8").catch(() => ""),
      fs.readFile(stderrPath, "utf8").catch(() => ""),
    ]);

    return { exitCode, stderr, stdout };
  } finally {
    await Promise.all([
      fs.rm(stdoutPath, { force: true }),
      fs.rm(stderrPath, { force: true }),
    ]);
  }
}

function stripHarnessControlledFlags(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (STRIPPED_VALUE_FLAGS.has(arg)) {
      i++;
      continue;
    }
    const eqIdx = arg.indexOf("=");
    if (eqIdx > 0 && STRIPPED_VALUE_FLAGS.has(arg.slice(0, eqIdx))) {
      continue;
    }
    out.push(arg);
  }
  return out;
}
