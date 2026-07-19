import { execa } from "execa";
import { defineCommand } from "just-bash";
import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { dedent, sleep } from "radashi";

import { TASK_FOLDER_NAMES } from "../../constants";
import { CDP_PAGE_PATH_PREFIX } from "../../logic/server/constants";
import { getWorkspaceServerPort } from "../../logic/server/url";
import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { WebSearch } from "../../tools/web-search";
import { type BrowserTargetId } from "../../types";
import { absolutePathJoin } from "../absolute-path-join";
import {
  AGENT_BROWSER_IDLE_TIMEOUT_MS,
  AGENT_BROWSER_PATH,
  AGENT_BROWSER_SOCKET_DIR,
  externalBrowserSessionName,
} from "../agent-browser";
import {
  INSTRUMENT_PROVIDER_NAME,
  instrumentPluginRegistry,
  writeInstrumentProviderPlugin,
} from "../agent-browser-plugin";
import { recordBrowserUse } from "../browser-state";
import { ffmpegSubprocessEnv } from "../ffmpeg";
import { isTaskId } from "../is-task-id";
import {
  getBrowserSessionDir,
  getDownloadsDir,
  getScreenshotsDir,
  taskDir,
} from "../task-dir-utils";
import { getWorkspaceConfig } from "../workspace-config";
import {
  agentBrowserFlagName,
  parseAgentBrowserArgs,
} from "./agent-browser-args";
import { rewriteNavigationArgToAssetUrl } from "./agent-browser-asset-url";
import {
  resolveCommandContext,
  resolvePathArgs,
  subprocessStdin,
} from "./utils";

const AGENT_BROWSER_SKILL_NAME = "agent-browser";

export const AGENT_BROWSER_COMMAND = {
  description: dedent`
    Control a browser to navigate the web, interact with pages, and extract content.
    IMPORTANT: You MUST load the \`${AGENT_BROWSER_SKILL_NAME}\` skill before using this command. Do not run any agent-browser commands until the skill is loaded.
    IMPORTANT: Never fabricate specific or deep URLs from memory -- they change and training data is stale. Well-known root domains are fine; for anything more specific, use \`${WebSearch.name}\` first to discover the correct URL before opening the browser.
    Defaults to the Instrument-managed task browser. External browsers are selected per invocation: --profile (a local Chrome profile, including the user's logins; list with \`profiles\`), --auto-connect (a Chromium already running with remote debugging), --cdp (an explicit CDP endpoint), --provider (cloud/iOS). The skill covers when each is appropriate.
    Do NOT pass session, config, namespace, or plugin flags; those are managed automatically.
  `.trim(),
  name: AGENT_BROWSER_SKILL_NAME,
} as const;

// Flags rejected because the harness owns them: daemon session identity and
// config/plugin-registry discovery. Connection targeting (--cdp,
// --auto-connect, --provider, --profile, --state, --restore*) passes through
// and routes the invocation to an external browser session instead.
const BLOCKED_FLAGS = new Set([
  "--config", // A managed empty config is injected so task-local agent-browser.json (agent-writable, can register plugins) is never discovered.
  "--namespace", // Would move daemon/restore state outside the workspace-owned namespace.
  "--session", // Harness injects this; derived from our session id.
  "--session-name", // Legacy restore/session key alias.
]);

// Launch-state flags that imply an external local Chrome launch when no
// connection-identity flag (--cdp, --auto-connect, --provider) is present:
// the task browser is a provider connection that ignores local launch
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
const BLOCKED_SUBCOMMANDS = new Set([
  "auth", // Credential vault; we don't expose it.
  "batch", // Each line is parsed as a full command (quoted args or --json stdin), which would bypass this argv-level policy.
  "chat", // Built-in AI REPL; the agent is the AI.
  "close", // Lifecycle managed by the workspace.
  "connect", // Sticky daemon connection state; per-invocation --cdp expresses the same thing without hidden routing state.
  "dashboard", // We have our own UI.
  "doctor", // Diagnoses real Chrome installs, not our Electron bridge.
  "inspect", // Opens Chrome DevTools, which doesn't work against our WebContentsView CDP bridge.
  "install", // Browser binary is bundled with the app.
  "launch", // Daemon pre-launch; open/read already launch on demand.
  "mcp", // MCP tool hosting is managed outside the in-app browser wrapper.
  "plugin", // Plugin capabilities would bypass workspace policy.
  "session", // Session metadata is owned by the workspace.
  "skills", // Workspace manages skill loading.
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

// cspell:ignore networkidle scrollintoview
const WORKSPACE_HELP = dedent`
  agent-browser - Control the task's managed browser, or an external one.

  IMPORTANT: Load the \`agent-browser\` skill before using this command. It is
  the source of truth for workflow details and command examples.
  By default the workspace manages the browser session, CDP connection,
  profile, state, screenshots, downloads, and lifecycle.

  Core workflow:
    1. agent-browser open <url>
    2. agent-browser snapshot -i
    3. Act on @refs from the snapshot
    4. Re-run snapshot -i after navigation or DOM changes

  Inspecting a file you created:
    agent-browser open output/report.html   Task files load in the browser
    agent-browser open /task/output/x.html  Task-relative, /task/..., /mnt/...,
                                            and file:///task/... all work
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

  External browsers (flags apply per invocation; a bare command targets the
  managed task browser again):
    profiles                    List the user's Chrome profiles
    --profile <name|dir>        Launch Chrome with an existing profile (logins)
    --auto-connect              Connect to a Chromium already running with
                                remote debugging enabled
    --cdp <port|ws-url>         Connect to an explicit CDP endpoint
    --provider <name>           Cloud or iOS browser provider
    --state | --restore <key>   Load or persist storage state

  Load the skill for guidance on when an external browser is appropriate.
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
 * under a different configuration than the invocation asks for: our `--cdp`
 * URL carries the browser target id, which changes whenever the view is
 * recreated, while the daemon outlives a command by its idle timeout. The
 * refusal happens before the command runs, so a retry cannot repeat a page
 * action; it just lets agent-browser restart the daemon on the requested
 * configuration, which is what the CLI's own message asks for.
 */
export function isDaemonConfigRace(output: string): boolean {
  return output.includes(
    "started concurrently with different daemon configuration",
  );
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
  taskId,
}: {
  sessionId: StoreId.Session;
  taskId: TaskId;
}) {
  return defineCommand(AGENT_BROWSER_COMMAND.name, async (args, ctx) => {
    const workspaceConfig = getWorkspaceConfig();
    const serverPort = getWorkspaceServerPort();

    if (!isTaskId(taskId)) {
      return {
        exitCode: 1,
        stderr: "agent-browser: browser is only available in task contexts.\n",
        stdout: "",
      };
    }

    const id = taskId;

    const isWorkspaceHelp = args.some((a) => a === "--help" || a === "-h");
    if (isWorkspaceHelp) {
      return {
        exitCode: 0,
        stderr: "",
        stdout: WORKSPACE_HELP,
      };
    }

    // Matches --flag, --flag=value, and short aliases (-p for --provider).
    const blockedArg = args.find((a) =>
      BLOCKED_FLAGS.has(agentBrowserFlagName(a)),
    );
    if (blockedArg) {
      return {
        exitCode: 1,
        stderr: `agent-browser: flag ${blockedArg} is not allowed. The browser session is managed automatically.\n`,
        stdout: "",
      };
    }

    const { subcommand } = parseAgentBrowserArgs(args);
    if (subcommand && BLOCKED_SUBCOMMANDS.has(subcommand)) {
      return {
        exitCode: 1,
        stderr: `agent-browser: subcommand '${subcommand}' is not available in this environment.\n`,
        stdout: "",
      };
    }

    const isInfoOnly = args.some((a) => {
      const flagName = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
      return INFO_ONLY_FLAGS.has(flagName);
    });

    const { env, taskCwd } = resolveCommandContext(taskId, ctx);
    const strippedArgs = stripHarnessControlledFlags(args);
    // Before resolvePathArgs, which would otherwise turn a `/task/...`
    // navigation target into a host path the browser cannot load.
    const navigationArgs = await rewriteNavigationArgToAssetUrl(
      strippedArgs,
      taskId,
      ctx,
    );
    const resolvedArgs = resolvePathArgs(navigationArgs, taskId, ctx);

    // just-bash sets HOME=/ which is read-only. Most agent-browser writes are
    // already redirected via dedicated env vars (socket dir, screenshot dir,
    // download path); this is a per-task sink for anything that falls back
    // to $HOME, and holds the managed config and provider plugin script.
    const homeDir = absolutePathJoin(
      taskDir(taskId),
      TASK_FOLDER_NAMES.private,
      "agent-browser-home",
    );
    const configPath = path.join(homeDir, "config.json");

    // `profiles` inspects the host's Chrome install (real HOME, no browser
    // needed), so it always routes external even without a targeting flag.
    const isExternal =
      !isInfoOnly &&
      (isExternalBrowserInvocation(resolvedArgs) || subcommand === "profiles");
    const browserFreeRead = !isExternal && isBrowserFreeRead(resolvedArgs);

    const commandArgs: string[] = [];
    let targetId: BrowserTargetId | undefined;
    let pluginRegistry: string | undefined;

    if (isInfoOnly) {
      // Info-only invocations (--help, --version) print and exit without ever
      // touching a browser target, so don't spin up a WebContentsView or attach
      // to the CDP bridge.
      commandArgs.push(...resolvedArgs);
    } else if (isExternal) {
      // External targets run under a sibling daemon session so switching
      // between the task browser and an external browser never tears down the
      // other's connection. External intent is per-invocation: a bare
      // follow-up command routes back to the task browser.
      commandArgs.push(
        "--session",
        externalBrowserSessionName(sessionId),
        ...resolvedArgs,
      );
    } else if (browserFreeRead) {
      // A fetch needs no view either; creating one would leave the user staring
      // at an empty browser panel the agent never navigates. It still needs a
      // daemon, which gets its own session so the browser session's daemon is
      // still only ever started by an invocation carrying the instrument
      // provider: one started without it holds no CDP endpoint and would
      // launch its own browser the next time a command needed a page.
      commandArgs.push("--session", `${sessionId}-read`, ...resolvedArgs);
    } else {
      // Idempotent: createTarget returns the existing view for this
      // (id, sessionId) pair if one is already live, so sub-agents and
      // repeat invocations within the same session reuse the same browsing
      // surface (cookies, page, debugger).
      const partitionDir = getBrowserSessionDir();
      const target = await workspaceConfig.browser.createTarget(
        id,
        sessionId,
        partitionDir,
      );
      targetId = target.targetId;
      await recordBrowserUseBestEffort({ sessionId, taskId });

      const cdpUrl = `ws://127.0.0.1:${serverPort}${CDP_PAGE_PATH_PREFIX}${targetId}`;
      const pluginPath = await writeInstrumentProviderPlugin(homeDir);
      pluginRegistry = instrumentPluginRegistry({ cdpUrl, pluginPath });
      commandArgs.push("--session", sessionId, ...resolvedArgs);
    }

    const screenshotDir = getScreenshotsDir(taskDir(taskId));
    const downloadPath = getDownloadsDir(taskDir(taskId));
    const agentBrowserStateDir = screenshotDir;
    // Relative so agent-browser outputs screenshot paths the agent sees as
    // relative to its cwd (e.g. "work/screenshots/shot.png"), not host
    // absolute.
    const screenshotDirRelative = path.relative(taskCwd, screenshotDir);

    const spawnEnv = {
      ...env,
      // `agent-browser record` spawns a real `ffmpeg` process by bare name,
      // resolved against PATH. The bundled ffmpeg-static binary isn't on the
      // sandbox PATH, so prepend its dir (the in-bash `ffmpeg` command is a
      // just-bash intercept that a separate subprocess can't see).
      ...ffmpegSubprocessEnv(env.PATH),
      // Null out env-var equivalents of harness-owned and connection
      // flags so the user shell can't bypass flag policy. Connection
      // targeting must arrive as CLI flags: session routing (task vs
      // external daemon session) is derived from argv.
      AGENT_BROWSER_AUTO_CONNECT: undefined,
      AGENT_BROWSER_CDP: undefined,
      AGENT_BROWSER_CONFIG: undefined,
      // Uncomment this to enable debug mode.
      // AGENT_BROWSER_DEBUG:
      //   process.env.NODE_ENV === "development" ? "1" : undefined,
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
      // behave as plain node. Inert for the Rust CLI and for Chrome; set
      // only for task-browser invocations so an external
      // --executable-path launch of an Electron-based app is unaffected.
      ELECTRON_RUN_AS_NODE: pluginRegistry ? "1" : undefined,
      // External invocations get the real host HOME: --auto-connect
      // discovers running Chromes via DevToolsActivePort under the real
      // user-data dirs, and --profile resolves named profiles there.
      // Task-browser invocations keep the per-task sink so agent-browser
      // never writes to the host home.
      HOME: isExternal ? (process.env.HOME ?? homeDir) : homeDir,
    };

    let result: Awaited<ReturnType<typeof runAgentBrowser>>;
    try {
      result = await runAgentBrowser({
        args: commandArgs,
        cancelSignal: ctx.signal,
        cwd: taskCwd,
        env: browserFreeRead ? browserFreeReadEnv(spawnEnv) : spawnEnv,
        input: subprocessStdin(ctx.stdin),
        managedConfigPath: isInfoOnly ? undefined : configPath,
        stateDir: agentBrowserStateDir,
      });
    } finally {
      if (targetId) {
        await enrichBrowserState({
          id,
          sessionId,
          targetId,
          taskId,
        });
      }
    }

    const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");

    const exitCode = result.exitCode ?? 1;
    return {
      exitCode,
      stderr: "",
      stdout: combined,
    };
  });
}

/**
 * True when the invocation targets a browser other than the Instrument task
 * browser. Mirrors upstream connection-identity precedence (cdp >
 * auto-connect > provider > local launch): an explicit `--provider
 * instrument` keeps a mixed invocation like `--profile x --provider
 * instrument` on the task browser, exactly as the CLI itself would resolve
 * it, and a literal `--auto-connect false` opt-out is honored.
 */
export function isExternalBrowserInvocation(args: string[]): boolean {
  let providerName: string | undefined;
  let hasCdp = false;
  let hasAutoConnect = false;
  let hasStateFlag = false;

  for (const { name, value } of targetingFlags(args)) {
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
 * The flags an invocation carries, as the CLI itself reads them: aliases
 * resolved, and a value flag's value never read back as a flag of its own.
 *
 * Inline `--flag=value` forms are folded in on top. The CLI honours
 * `--cdp <value>` but not `--cdp=<value>`, so the inline form never reaches
 * its global-flag parser -- but routing on it anyway beats letting a form
 * technicality decide which daemon session an invocation lands in.
 */
function targetingFlags(args: string[]) {
  const { globalFlags, subArgs } = parseAgentBrowserArgs(args);
  const inlineFlags = subArgs
    .filter(({ value }) => value.startsWith("-") && value.includes("="))
    .map(({ value }) => ({
      name: agentBrowserFlagName(value),
      value: value.slice(value.indexOf("=") + 1),
    }));
  return [...globalFlags, ...inlineFlags];
}

async function enrichBrowserState({
  id,
  sessionId,
  targetId,
  taskId,
}: {
  id: TaskId;
  sessionId: StoreId.Session;
  targetId: BrowserTargetId;
  taskId: TaskId;
}) {
  try {
    const targets = await getWorkspaceConfig().browser.listTargets(id);
    const target = targets.find((t) => t.id === targetId);
    if (target) {
      await recordBrowserUseBestEffort({
        sessionId,
        taskId,
        title: target.title,
        url: target.url,
      });
    }
  } catch (error) {
    getWorkspaceConfig().captureException(error);
  }
}

async function recordBrowserUseBestEffort({
  sessionId,
  taskId,
  title,
  url,
}: {
  sessionId: StoreId.Session;
  taskId: TaskId;
  title?: string;
  url?: string;
}) {
  const result = await recordBrowserUse({
    sessionId,
    taskId,
    title,
    url,
  });
  if (result.isErr()) {
    getWorkspaceConfig().captureException(result.error);
  }
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
