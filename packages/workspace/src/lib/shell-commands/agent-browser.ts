import { recordStepPages } from "../transcript/step-facts";
import { APP_NAME } from "@instrument-org/shared";
import { execa } from "execa";
import { defineCommand } from "just-bash";
import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { dedent, sleep } from "radashi";

import { cdpBridgeUrl } from "../../logic/server/cdp-bridge-path";
import { getWorkspaceServerPort } from "../../logic/server/url";
import { type StoreId } from "../../schemas/store-id";
import { type ChatId } from "../../schemas/chat-id";
import { type BrowserConfig } from "../../types";
import { WebSearch } from "../../tools/web-search";
import {
  AGENT_BROWSER_IDLE_TIMEOUT_MS,
  agentBrowserPath,
  AGENT_BROWSER_SOCKET_DIR,
  readSessionName,
} from "../agent-browser";
import {
  INSTRUMENT_PROVIDER_NAME,
  instrumentPluginRegistry,
  writeInstrumentProviderPlugin,
} from "../agent-browser-plugin";
import {
  agentBrowserGuide,
  agentBrowserReferences,
} from "../../model-text/guides/agent-browser-guide";
import { WINDOW_COMMAND } from "../../model-text/commands/window-command";
import { withTcpListenerClosed } from "../native-sandbox";
import { recordVisitedHosts } from "../browser-state";
import { agentSpellingOfFileUrls } from "../local-page-address";
import {
  getAgentBrowserHomeDir,
  getDownloadsDir,
  getScreenshotsDir,
} from "../chat-dir-utils";
import { chatPageTabs } from "../chat/chat-tabs";
import {
  announceChatTab,
  closeChatTab,
  lastActOf,
  tabsActedInBy,
} from "../tab-activity";
import { pageOpenedTabsNote, tabNewsNote } from "./agent-browser-tab-news";
import { getWorkspaceConfig } from "../workspace-config";
import {
  hostPathOf,
  shellPathOfHostSpelling,
  unsandboxedOperandRefusal,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";
import {
  agentBrowserFlagName,
  END_OF_OPTIONS,
  parseAgentBrowserArgs,
} from "./agent-browser-args";
import { rewriteNavigationArgToFileUrl } from "./agent-browser-file-url";
import {
  askForAnswerArgs,
  awaitRunningScript,
  isEval,
} from "./agent-browser-running-script";
import { watchSlowInvocation } from "./agent-browser-slow";
import {
  currentBrowserFollowUp,
  activeTab,
  failureLine,
  FOLLOW_UP_SNAPSHOT_ARGS,
  FOLLOW_UP_TABS_ARGS,
  FOLLOW_UP_WAIT_ARGS,
  isScriptCall,
  liveRegionDocument,
  liveRegionsArgs,
  liveRegionText,
  readsLiveRegionsFirst,
  savedScreenshotPath,
} from "./agent-browser-follow-up";
import {
  DOCUMENT_WAIT_ARGS,
  DOCUMENT_WAIT_TIMEOUT_MS,
  needsLoadedDocument,
  AFTER_ACTION_PAUSE_ARGS,
  AFTER_ACTION_PAUSE_TIMEOUT_MS,
} from "./agent-browser-loading";
import { cutScreenshotNote } from "./agent-browser-screenshot-cut";
import { typedTextRuns } from "./agent-browser-typed-text";
import { cappedWaitResult, capWait, uncappedWait } from "./agent-browser-wait";
import {
  isTabClose,
  jsonWithTabIds,
  newTabLine,
  onlyTabToClose,
  tabClosedOutput,
  tabOutputOf,
  windowTabIdArgIndex,
  withTabIds,
  listsTab,
  withTabLabel,
} from "./agent-browser-tab-ids";
import { recordProgramStart } from "./command-runs";
import { hostPathArgs, resolveCommandContext, subprocessStdin } from "./utils";
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

// Flags rejected because the harness owns what they set: daemon session
// identity, config/plugin-registry discovery, and anything the CLI keeps for
// the session beyond the command that passed it. Connection targeting (--cdp,
// --auto-connect, --provider, --profile, --state, --restore*) is refused as a
// reach for a browser outside the app (see isExternalBrowserInvocation).
export const BLOCKED_FLAGS = new Set([
  "--action-policy", // Kept in the session's settings file until `close`, like --allowed-domains; its path would also be read outside the folder rules.
  "--allowed-domains", // Kept in the session's settings file until `close`, which only the workspace runs, so one command would narrow every later one.
  "--ca-cert", // Trusts a certificate file for the CLI's own requests, read outside the folder rules.
  "--capture", // Records the session as a flow file; `flow` is not available here.
  "--cdp-headers", // Credentials for a --cdp endpoint, which is refused.
  "--config", // A managed empty config is injected so an agent-browser.json in the chat's folder (agent-writable, can register plugins) is never discovered.
  "--confirm-actions", // Kept in the session's settings file until `close`, like --allowed-domains; `confirm` and `deny` are not available here.
  "--namespace", // Would move daemon/restore state outside the workspace-owned namespace.
  "--pin-tab", // Sticky for the session: later commands fail once the person closes the tab, where the workspace picks the tab a session works in.
  "--relaunch", // Drops the daemon's connection to the app's browser and makes another; lifecycle is the workspace's.
  "--session", // Harness injects this; derived from our session id.
  "--session-name", // Upstream's alias for --session.
]);

// Loads a browser extension from a path, which only a browser agent-browser
// launches itself takes: connected to Instrument's, already running, the
// CLI drops it.
const EXTENSION_FLAG = "--extension";

// Registers a script the browser runs in every page, read from a path by the
// CLI outside the sandbox, so the path is held to the folder rules
// (resolveAgentBrowserPathArgs).
const INIT_SCRIPT_FLAG = "--init-script";

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
  "confirm", // Approves an action held by --confirm-actions, which is refused.
  "connect", // Sticky daemon connection state; per-invocation --cdp expresses the same thing without hidden routing state.
  "dashboard", // We have our own UI.
  "deny", // Denies an action held by --confirm-actions, which is refused.
  "doctor", // Diagnoses real Chrome installs, not our Electron bridge.
  "exit", // Upstream's alias for close.
  "flow", // Replays a saved flow file, which can send its requests straight from the CLI, with no page and none of the app's rules.
  "inspect", // Opens Chrome DevTools, which doesn't work against our `<webview>` CDP bridge.
  "install", // Browser binary is bundled with the app.
  "launch", // Daemon pre-launch; a command that needs a page already launches on demand. (`read` never does, with or without this: it is skip-launch upstream.)
  "mcp", // MCP tool hosting is managed outside the in-app browser wrapper.
  "plugin", // Plugin capabilities would bypass workspace policy.
  "plugins", // Upstream's alias for plugin.
  "quit", // Upstream's alias for close.
  "session", // Session metadata is owned by the workspace.
  "state", // Persistence managed by the workspace.
  "stream", // Streaming managed by the workspace.
  "upgrade", // Binary is bundled; agent shouldn't self-update.
]);

// Subcommands refused with what to run in their place, or why there is
// nothing to run.
const REDIRECTED_SUBCOMMANDS = new Map([
  // `device list` lists the iOS simulators on this computer, for the iOS
  // provider, which is a browser outside the app.
  [
    "device",
    `agent-browser: \`device\` is not available in this browser: it lists iOS simulators for agent-browser's iOS provider, and ${APP_NAME}'s browser is the only one here. \`set device <name>\` is a different command.\n`,
  ],
  // `window new` asks the daemon for a browser window of its own, where the
  // windows are the app's and the person's.
  [
    "window",
    `agent-browser: \`window\` is not available in this browser: the windows are ${APP_NAME}'s. Open a tab with \`agent-browser tab new <url>\`, or put one in front of the user with \`${WINDOW_COMMAND.name} show <url or path>\`.\n`,
  ],
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
 * offered; the others describe running agent-browser somewhere else. Its
 * words are read the way the CLI reads them: `--full` adds the references,
 * and `--ref <name>` (or `--ref=<name>`, any number of times) prints
 * references alone and goes with neither `--full` nor a second skill.
 */
function skills(words: string[]): {
  exitCode: number;
  stderr: string;
  stdout: string;
} {
  const fail = (message: string) => ({
    exitCode: 1,
    stderr: `agent-browser: ${message}\n`,
    stdout: "",
  });
  const operands: string[] = [];
  const references: string[] = [];
  let full = false;
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? "";
    if (word === "--ref") {
      const name = words[++i];
      if (name === undefined) {
        return fail(
          "--ref needs a value. Usage: agent-browser skills get core --ref <ref>",
        );
      }
      references.push(name);
    } else if (word.startsWith("--ref=")) {
      references.push(word.slice("--ref=".length));
    } else if (word === "--full") {
      full = true;
    } else if (!word.startsWith("-")) {
      operands.push(word);
    }
  }
  const [action = "list", ...names] = operands;
  if (action === "list") {
    return {
      exitCode: 0,
      stderr: "",
      stdout:
        "core  The guide to agent-browser in this app. Run `agent-browser skills get core`, with --ref <name> for one of its references or --full for all of them.\n",
    };
  }
  if (action !== "get" || names.length !== 1 || names[0] !== "core") {
    return fail(
      "only `skills get core` is available in this app; the other skills describe running agent-browser somewhere else.",
    );
  }
  if (references.length === 0) {
    return { exitCode: 0, stderr: "", stdout: agentBrowserGuide({ full }) };
  }
  if (full) {
    return fail(
      "--ref cannot be combined with --full. Usage: agent-browser skills get core --ref <ref>",
    );
  }
  const found = agentBrowserReferences(references);
  return "error" in found
    ? fail(`${found.error}.`)
    : { exitCode: 0, stderr: "", stdout: found.text };
}

/**
 * `agent-browser adblock [on|off]`: the agent's own say over the ad and
 * tracker blocking in its chat's tabs, for a page the block lists broke. Answered
 * here rather than by the CLI, since the blocking lives in the app, not in
 * the browser.
 */
async function adblock(
  browser: BrowserConfig,
  chatId: ChatId,
  mode: string | undefined,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  if (mode !== undefined && mode !== "on" && mode !== "off") {
    return {
      exitCode: 1,
      stderr: "agent-browser: usage: agent-browser adblock [on|off]\n",
      stdout: "",
    };
  }
  const targets = ((await chatPageTabs(chatId)) ?? []).map(
    (tab) => tab.targetId,
  );
  if (targets.length === 0) {
    return {
      exitCode: 1,
      stderr:
        "agent-browser: adblock applies to this chat's tabs, and it has none yet. Open the page first.\n",
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
      ? "Ad blocking is on in this chat's tabs."
      : "Ad blocking is off in this chat's tabs, until `agent-browser adblock on` or the app restarts. The user's own setting is unchanged.";
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
    agent-browser open site/report.html     Chat files load in the browser
    agent-browser open /full/path/x.html    A relative path, a full path, or a
                                            file:// URL of either all work
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
 *
 * `cookies`, `wait` and `webmcp` name a file among such text (a cookie's
 * value, a `--fn` body, a tool's JSON), so they are left out of this set:
 * `fileOperandsOf` picks their one file and the rest stays as typed.
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

type Operand = { index: number; value: string };
/** `prefix` is the part of the argument before the path, for `--flag=<path>`. */
type FileOperand = { index: number; op: "read" | "write"; prefix?: string };

/**
 * The operands of a file subcommand that name a file, and whether the
 * browser process reads or writes it, picked out the way the CLI's own
 * parser picks them (`cli/src/commands.rs` upstream; keep in step when the
 * pinned version moves). `operands` are the subcommand's own, after it.
 *
 * A file is counted among the positionals `positionalsOf` gives, which
 * passes over the `--` the CLI passes over, so the argument checked is the one
 * the CLI opens. `diff` reads its flags wherever they are and takes no `--`.
 */
function fileOperandsOf(
  subcommand: string | undefined,
  operands: Operand[],
): FileOperand[] {
  const writes = (operand: Operand | undefined): FileOperand[] =>
    operand ? [{ index: operand.index, op: "write" }] : [];
  const [first, second] = operands;
  switch (subcommand) {
    case "cookies": {
      // `cookies set --curl <file>`: the CLI itself reads the word after the
      // first `--curl`, wherever that is, a `--` ahead of it included.
      const curl = operands.findIndex(({ value }) => value === "--curl");
      const file = operands[curl + 1];
      return first?.value === "set" && curl !== -1 && file
        ? [{ index: file.index, op: "read" }]
        : [];
    }
    case "diff": {
      // `--baseline <file>` is read, `--output <file>` written.
      return operands.flatMap((operand, i): FileOperand[] => {
        const next = operands[i + 1];
        if (!next) {
          return [];
        }
        if (operand.value === "-b" || operand.value === "--baseline") {
          return [{ index: next.index, op: "read" }];
        }
        return operand.value === "-o" || operand.value === "--output"
          ? writes(next)
          : [];
      });
    }
    case "download": {
      return writes(positionalsOf(operands)[1]);
    }
    case "network": {
      return first?.value === "har" && second?.value === "stop"
        ? writes(positionalsOf(operands.slice(2))[0])
        : [];
    }
    case "pdf": {
      return writes(positionalsOf(operands)[0]);
    }
    case "profiler":
    case "trace": {
      return first?.value === "stop"
        ? writes(positionalsOf(operands.slice(1))[0])
        : [];
    }
    case "record": {
      if (first?.value !== "start" && first?.value !== "restart") {
        return [];
      }
      return writes(
        positionalsOf(operands.slice(1), {
          bool: ["--contact-sheet", "--cursor"],
          valued: ["--contact-sheet-threshold", "--fps"],
        })[0],
      );
    }
    case "screenshot": {
      const positionals = positionalsOf(operands, {
        bool: ["--full", "--if-changed", "-f"],
        valued: ["--threshold"],
      });
      if (positionals.length > 1) {
        return writes(positionals[1]);
      }
      const [only] = positionals;
      return only && isScreenshotPath(only.value) ? writes(only) : [];
    }
    case "wait": {
      // `wait --download <path>` moves the finished download to the path.
      // The CLI takes `--timeout` and `--state` out with their values, then
      // answers the first of these it finds, and reads the download flag
      // only when none is there.
      const words = WAIT_VALUE_FLAGS.reduce((rest, flag) => {
        const at = rest.findIndex(({ value }) => value === flag);
        return at === -1 ? rest : rest.toSpliced(at, 2);
      }, operands);
      if (words.some(({ value }) => WAIT_FLAGS_AHEAD_OF_DOWNLOAD.has(value))) {
        return [];
      }
      const download = words.findIndex(
        ({ value }) => value === "--download" || value === "-d",
      );
      const saved = words[download + 1];
      return download !== -1 && saved && !saved.value.startsWith("--")
        ? writes(saved)
        : [];
    }
    case "webmcp": {
      return webmcpParamsFile(operands);
    }
    case "upload": {
      // The CLI drops a `--` ahead of the selector when something follows it,
      // and sends every word after the selector as a file.
      const words =
        first?.value === END_OF_OPTIONS && operands.length > 1
          ? operands.slice(1)
          : operands;
      return words.slice(1).map(({ index }) => ({ index, op: "read" }));
    }
    default: {
      return [];
    }
  }
}

/** What `wait` takes out of its words, each with its value, before reading the rest. */
const WAIT_VALUE_FLAGS = ["--timeout", "--state"];

/** The waits the CLI answers ahead of `--download` when a command names both. */
const WAIT_FLAGS_AHEAD_OF_DOWNLOAD = new Set([
  "--fn",
  "--load",
  "--text",
  "--url",
  "-f",
  "-l",
  "-t",
  "-u",
]);

const WEBMCP_INVOKE_VALUE_FLAGS = new Set(["--frame", "--params", "--timeout"]);

/**
 * The file `webmcp invoke <tool>` reads its tool's input from: `@<file>` as
 * the word after the tool or as the value of `--params`, read by the CLI
 * itself. Only the first input counts, since the CLI refuses a second before
 * it opens anything. The CLI drops a `--` after `invoke` when something
 * follows it, and stops at any other word opening with `-` it does not know.
 */
function webmcpParamsFile(operands: Operand[]): FileOperand[] {
  const words =
    operands[1]?.value === END_OF_OPTIONS && operands.length > 2
      ? operands.toSpliced(1, 1)
      : operands;
  if (words[0]?.value !== "invoke") {
    return [];
  }
  for (let i = 2; i < words.length; i++) {
    const word = words[i];
    if (!word || word.value === "--detach") {
      continue;
    }
    const takesValue = WEBMCP_INVOKE_VALUE_FLAGS.has(word.value);
    const value = takesValue ? words[++i] : word;
    if (!value || value.value.startsWith("-")) {
      return [];
    }
    if (takesValue && word.value !== "--params") {
      continue;
    }
    return value.value.startsWith("@")
      ? [{ index: value.index, op: "read", prefix: "@" }]
      : [];
  }
  return [];
}

/**
 * The page init scripts an invocation names, which the browser reads: the
 * value after `--init-script`, and one spelled `--init-script=<path>`, which
 * the CLI does not take for the flag today and is held as one all the same.
 */
function initScriptOperands(
  args: string[],
  {
    endOfOptions,
    globalFlags,
  }: Pick<
    ReturnType<typeof parseAgentBrowserArgs>,
    "endOfOptions" | "globalFlags"
  >,
): FileOperand[] {
  const prefix = `${INIT_SCRIPT_FLAG}=`;
  return [
    ...globalFlags.flatMap(({ name, valueIndex }): FileOperand[] =>
      name === INIT_SCRIPT_FLAG && valueIndex !== undefined
        ? [{ index: valueIndex, op: "read" }]
        : [],
    ),
    ...args
      .slice(0, endOfOptions)
      .flatMap((arg, index): FileOperand[] =>
        arg.startsWith(prefix) ? [{ index, op: "read", prefix }] : [],
      ),
  ];
}

/**
 * The operands that are not a flag or a flag's value, as the CLI's scanner
 * (`ArgScanner`) counts them: the first `--` is not one, and every operand
 * after it is, a flag's name included.
 */
function positionalsOf(
  operands: Operand[],
  flags: { bool: string[]; valued: string[] } = { bool: [], valued: [] },
): Operand[] {
  const positionals: Operand[] = [];
  let optionsEnded = false;
  for (let i = 0; i < operands.length; i++) {
    const operand = operands[i];
    if (!operand) {
      continue;
    }
    if (optionsEnded) {
      positionals.push(operand);
    } else if (operand.value === END_OF_OPTIONS) {
      optionsEnded = true;
    } else if (flags.valued.includes(operand.value)) {
      i++;
    } else if (!flags.bool.includes(operand.value)) {
      positionals.push(operand);
    }
  }
  return positionals;
}

/** Whether `screenshot`'s only operand is the file it writes rather than a selector. */
function isScreenshotPath(value: string): boolean {
  const relative = value.startsWith("./") || value.startsWith("../");
  const selector = !relative && /^[.#@]/.test(value);
  return (
    !selector &&
    (relative || value.includes("/") || /\.(?:png|jpe?g|webp)$/.test(value))
  );
}

/**
 * Spell the file operands of subcommands that take a file, and the page
 * init scripts, as the host does, refuse one the folder rules keep from the
 * agent, and check every file `upload` sends and every init script exists.
 * The CLI and the browser it drives run outside the sandbox, so the rules
 * are asked here, as `rg` and `du` ask them of theirs. CDP reports success
 * for missing files, so the wrapper must fail before handing them to the
 * browser process.
 */
export async function resolveAgentBrowserPathArgs(
  args: string[],
  ctx: {
    cwd: string;
    fs: {
      exists(path: string): Promise<boolean>;
      resolvePath(cwd: string, path: string): string;
    };
  },
  layout: WorkspaceFsLayout,
): Promise<{ args: string[] } | { error: string }> {
  const parsed = parseAgentBrowserArgs(args);
  const { subArgs, subcommand } = parsed;
  const textOperands = new Set(
    subcommand !== undefined && !FILE_OPERAND_SUBCOMMANDS.has(subcommand)
      ? subArgs.slice(1).map(({ index }) => index)
      : [],
  );
  const initScripts = initScriptOperands(args, parsed);
  const commandFiles = fileOperandsOf(subcommand, subArgs.slice(1));
  const fileOperands = [...commandFiles, ...initScripts];
  const pathOf = ({ index, prefix = "" }: FileOperand) =>
    (args[index] ?? "").slice(prefix.length);
  const hostCwd = hostPathOf(ctx.fs.resolvePath(ctx.cwd, "."));
  // A file named the way this computer names one is the file the CLI opens,
  // so it meets the rules its shell spelling meets and reaches the CLI as
  // the path it named rather than as a name in the working folder.
  const shellPathOf = (named: string) =>
    shellPathOfHostSpelling(named, { hostCwd }) ??
    ctx.fs.resolvePath(ctx.cwd, named);
  for (const operand of fileOperands) {
    const named = pathOf(operand);
    const refusal = unsandboxedOperandRefusal(
      layout,
      shellPathOf(named),
      operand.op,
    );
    if (refusal !== undefined) {
      return { error: `${named}: Permission denied\n${refusal}` };
    }
  }
  for (const operand of initScripts) {
    const named = pathOf(operand);
    if (!(await ctx.fs.exists(shellPathOf(named)))) {
      return { error: `Init script not found: "${named}".` };
    }
  }
  const byIndex = new Map(
    fileOperands.map((operand) => [operand.index, operand]),
  );
  // The daemon outlives the shell's `cd` and resolves a relative path
  // against the folder it was launched in, so a file operand goes to it
  // absolute.
  const resolved = args.map((arg, index) => {
    const operand = byIndex.get(index);
    if (operand) {
      return `${operand.prefix ?? ""}${hostPathOf(shellPathOf(pathOf(operand)))}`;
    }
    return textOperands.has(index) ? arg : (hostPathArgs([arg])[0] ?? arg);
  });
  if (subcommand !== "upload") {
    return { args: resolved };
  }

  for (const operand of commandFiles) {
    const named = pathOf(operand);
    if (!(await ctx.fs.exists(shellPathOf(named)))) {
      return { error: `Upload file not found: "${named}".` };
    }
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
  | { kind: "skills"; words: string[] }
  | { kind: "tabs" };

export function classifyInvocation(
  args: string[],
  { hasNoWindow }: { hasNoWindow: boolean },
): Invocation {
  const { endOfOptions, subArgs, subcommand } = parseAgentBrowserArgs(args);
  // What follows the `--` is the subcommand's data, which the CLI reads no
  // flag from: `type @e1 -- --session` types the words.
  const options = args.slice(0, endOfOptions);
  if (options.some((a) => a === "--help" || a === "-h")) {
    return { kind: "help" };
  }
  // Matches --flag, --flag=value, and short aliases (-p for --provider).
  const blockedArg = options.find((a) =>
    BLOCKED_FLAGS.has(agentBrowserFlagName(a)),
  );
  if (blockedArg) {
    return {
      kind: "refuse",
      stderr: `agent-browser: flag ${blockedArg} is not allowed. The browser session is managed automatically.\n`,
    };
  }
  if (options.some((a) => agentBrowserFlagName(a) === EXTENSION_FLAG)) {
    return {
      kind: "refuse",
      stderr: `agent-browser: flag ${EXTENSION_FLAG} has no effect on ${APP_NAME}'s browser: an extension loads only into a browser agent-browser starts itself, and this one is already running.\n`,
    };
  }
  if (subcommand === ADBLOCK_SUBCOMMAND) {
    return { kind: "adblock", mode: subArgs[1]?.value };
  }
  if (subcommand === SKILLS_SUBCOMMAND) {
    return { kind: "skills", words: subArgs.slice(1).map((arg) => arg.value) };
  }
  if (subcommand && BLOCKED_SUBCOMMANDS.has(subcommand)) {
    return {
      kind: "refuse",
      stderr: `agent-browser: subcommand '${subcommand}' is not available in this environment.\n`,
    };
  }
  const redirect =
    subcommand === undefined
      ? undefined
      : REDIRECTED_SUBCOMMANDS.get(subcommand);
  if (redirect !== undefined) {
    return { kind: "refuse", stderr: redirect };
  }
  if (isTabKeep(subcommand, subArgs)) {
    return {
      kind: "refuse",
      stderr:
        "agent-browser: `tab keep` is not available in this browser: every tab stays live while an agent works in it, and a tab the user shares cannot be frozen.\n",
    };
  }
  const isInfoOnly = options.some((a) => {
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

/**
 * Whether an invocation is `tab keep`, which sets how a background tab runs
 * (live, throttled or frozen). The app keeps focus emulation on for every tab
 * an agent drives and shares each tab with the person, so the mode is not the
 * agent's to set. The CLI drops a `--` ahead of the word, so one is passed
 * over here too.
 */
function isTabKeep(
  subcommand: string | undefined,
  subArgs: { value: string }[],
): boolean {
  const [first, second] = subArgs.slice(1).map(({ value }) => value);
  return subcommand === "tab" && (first === "--" ? second : first) === "keep";
}

/**
 * The waits before each retry of a command refused for a daemon started
 * concurrently, doubling while another command's daemon is still coming up:
 * one slow to start (a loaded machine, antivirus scanning it on Windows)
 * would refuse a single retry for the same reason.
 */
const DAEMON_RACE_RETRY_DELAYS_MS = [250, 500, 1000, 2000];

/**
 * How long the read of the page's messages before an action may take. It is
 * a few milliseconds on a page that answers; the action waits on it, so a
 * page that does not answer costs no more than this.
 */
const LIVE_REGION_READ_TIMEOUT_MS = 2000;

/**
 * How long past its own timeout the wait for a loading document may run
 * before it is stopped, for the CLI to start and report.
 */
const DOCUMENT_WAIT_GRACE_MS = 1000;

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
  callPartId,
  chatId,
  layout,
  sessionId,
}: {
  /** The shell call it runs in, whose facts name the sites it reached. */
  callPartId?: StoreId.Part;
  chatId: ChatId;
  /** The layout of the shell it runs in, which its paths resolve against. */
  layout: WorkspaceFsLayout;
  sessionId: StoreId.Session;
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
        return adblock(workspaceConfig.browser, id, invocation.mode);
      }
      case "help": {
        return { exitCode: 0, stderr: "", stdout: WORKSPACE_HELP_MANAGED };
      }
      case "refuse": {
        return { exitCode: 1, stderr: invocation.stderr, stdout: "" };
      }
      case "skills": {
        return skills(invocation.words);
      }
      default: {
        break;
      }
    }
    const isInfoOnly = invocation.kind === "info";
    const browserFreeRead = invocation.kind === "read";

    const { env, hostCwd } = resolveCommandContext(chatId, ctx);
    const strippedArgs = stripHarnessControlledFlags(args);
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
      ctx,
      layout,
    );
    if ("error" in bridgedArgs) {
      return {
        exitCode: 1,
        stderr: `agent-browser: ${bridgedArgs.error}\n`,
        stdout: "",
      };
    }
    const cappedWait = uncappedWait(bridgedArgs.args);
    const resolvedArgs = capWait(bridgedArgs.args, cappedWait);

    // The home folder is read-only to native commands. Most agent-browser writes are
    // already redirected via dedicated env vars (socket dir, screenshot dir,
    // download path); this is the sink for anything that falls back
    // to $HOME, and holds the managed config and provider plugin script.
    const homeDir = getAgentBrowserHomeDir();
    const configPath = path.join(homeDir, "config.json");

    const commandArgs: string[] = [];
    // A session of a chat, which drives the chat's tabs rather than one page.
    const drivesChatTabs = invocation.kind === "tabs";
    let pluginRegistry: string | undefined;

    if (isInfoOnly) {
      // Info-only invocations (--help, --version) print and exit without ever
      // touching a browser target, so don't spin up a `<webview>` guest or attach
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
      const cdpUrl = cdpBridgeUrl(serverPort, id, sessionId);
      const pluginPath = await writeInstrumentProviderPlugin(homeDir);
      pluginRegistry = instrumentPluginRegistry({ cdpUrl, pluginPath });
      commandArgs.push("--session", sessionId, ...resolvedArgs);
    }

    const screenshotDir = getScreenshotsDir(workDir(chatId));
    const downloadPath = getDownloadsDir(workDir(chatId));
    const agentBrowserStateDir = screenshotDir;

    const spawnEnv = {
      // `agent-browser record` starts `ffmpeg` by bare name, which the
      // command env's PATH resolves to the bundled build.
      ...env,
      // Null out env-var equivalents of harness-owned and connection flags so
      // the user shell can't bypass flag policy. Connection targeting must
      // arrive as CLI flags, where they are refused.
      AGENT_BROWSER_ACTION_POLICY: undefined,
      AGENT_BROWSER_ALLOWED_DOMAINS: undefined,
      AGENT_BROWSER_AUTO_CONNECT: undefined,
      AGENT_BROWSER_CA_CERT: undefined,
      AGENT_BROWSER_CAPTURE: undefined,
      AGENT_BROWSER_CDP: undefined,
      AGENT_BROWSER_CDP_HEADERS: undefined,
      AGENT_BROWSER_CONFIG: undefined,
      AGENT_BROWSER_CONFIRM_ACTIONS: undefined,
      // Uncomment this to enable debug mode.
      // AGENT_BROWSER_DEBUG:
      //   process.env.NODE_ENV === "development" ? "1" : undefined,
      AGENT_BROWSER_EXECUTABLE_PATH: undefined,
      AGENT_BROWSER_EXTENSIONS: undefined,
      AGENT_BROWSER_FLOWS_DIR: undefined,
      AGENT_BROWSER_DOWNLOAD_PATH: downloadPath, // Passed to Chrome via CDP setDownloadBehavior, which requires an absolute path.
      AGENT_BROWSER_IDLE_TIMEOUT_MS,
      AGENT_BROWSER_INIT_SCRIPTS: undefined,
      AGENT_BROWSER_NAMESPACE: undefined,
      // With no window to drive the CLI starts a Chrome of its own, and would
      // otherwise fetch Chrome's release feed to compare its version, then
      // tell the agent to run `install`, which is refused.
      AGENT_BROWSER_NO_VERSION_CHECK: "1",
      AGENT_BROWSER_PIN_TAB: undefined,
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
      // Absolute: the daemon resolves a relative one against the folder it
      // was launched in, which a later `cd` does not move.
      AGENT_BROWSER_SCREENSHOT_DIR: screenshotDir,
      AGENT_BROWSER_SESSION: undefined,
      AGENT_BROWSER_SESSION_NAME: undefined,
      AGENT_BROWSER_SOCKET_DIR,
      AGENT_BROWSER_STATE: undefined,
      // The daemon spawns the provider plugin via process.execPath. In
      // packaged builds that is the Electron binary, which this var makes
      // behave as plain node. Inert for the Rust CLI and for Chrome.
      ELECTRON_RUN_AS_NODE: pluginRegistry ? "1" : undefined,
      // The workspace's own sink instead of the host home.
      HOME: homeDir,
    };

    const spawnOptions = {
      cwd: hostCwd,
      env: browserFreeRead ? browserFreeReadEnv(spawnEnv) : spawnEnv,
      managedConfigPath: isInfoOnly ? undefined : configPath,
      stateDir: agentBrowserStateDir,
    };
    // The session and connection flags this invocation was given, ahead of
    // the agent's own arguments, so a read of the page reaches the same one.
    const connectionArgs = commandArgs.slice(
      0,
      commandArgs.length - resolvedArgs.length,
    );
    // A tab named by the window's id, which `tab <id>` and `tab close <id>`
    // take only as agent-browser's own label for it.
    const tabIdIndex =
      isInfoOnly || browserFreeRead
        ? undefined
        : windowTabIdArgIndex(resolvedArgs);
    const closesTab = drivesChatTabs && isTabClose(resolvedArgs);
    if (tabIdIndex !== undefined || closesTab) {
      const listTabs = () =>
        runAgentBrowser({
          ...spawnOptions,
          args: [...connectionArgs, "tab", "list", "--json"],
          cancelSignal: ctx.signal,
          input: undefined,
        });
      let listed = await listTabs();
      // A tab of the chat's opened since this session's agent-browser
      // connected is announced only now that the agent names it, since
      // agent-browser makes a tab it discovers its active one.
      const named =
        tabIdIndex === undefined ? undefined : resolvedArgs[tabIdIndex];
      if (
        listed.exitCode === 0 &&
        named !== undefined &&
        !listsTab(listed.stdout, named) &&
        (await announceChatTab({ chatId, sessionId }, named))
      ) {
        listed = await listTabs();
      }
      // agent-browser refuses to close the only tab it has, so one an agent
      // opened is closed in the window for it. Nothing is left to read after,
      // and agent-browser makes a blank tab when its next command comes.
      const only =
        closesTab && listed.exitCode === 0
          ? onlyTabToClose(resolvedArgs, listed.stdout)
          : undefined;
      if (
        only !== undefined &&
        (await closeChatTab({ chatId, sessionId }, only))
      ) {
        currentBrowserFollowUp()?.clear();
        return {
          exitCode: 0,
          stderr: "",
          stdout: tabClosedOutput(resolvedArgs, only),
        };
      }
      if (listed.exitCode === 0 && tabIdIndex !== undefined) {
        commandArgs.splice(
          connectionArgs.length,
          resolvedArgs.length,
          ...withTabLabel(resolvedArgs, tabIdIndex, listed.stdout),
        );
      }
    }
    const drivesPage = !isInfoOnly && !browserFreeRead;
    // A run of the CLI the command adds around the agent's own, bounded, and
    // whose outcome the agent's command does not depend on.
    const runAside = (asideArgs: string[], timeoutMs: number) =>
      runAgentBrowser({
        ...spawnOptions,
        args: [...connectionArgs, ...asideArgs],
        cancelSignal: AbortSignal.any([
          ...(ctx.signal ? [ctx.signal] : []),
          AbortSignal.timeout(timeoutMs),
        ]),
        input: undefined,
      }).catch(() => undefined);
    if (drivesPage && needsLoadedDocument(resolvedArgs)) {
      await runAside(
        DOCUMENT_WAIT_ARGS,
        DOCUMENT_WAIT_TIMEOUT_MS + DOCUMENT_WAIT_GRACE_MS,
      );
    }
    const followUp =
      isInfoOnly || browserFreeRead ? undefined : currentBrowserFollowUp();
    // What the page's live regions say before an action, for the follow-up
    // to tell what the action changed in them, and the document they are in,
    // for it to tell the action loaded another. A page that cannot be read
    // leaves the follow-up without that reading, which it says.
    const before =
      followUp !== undefined && readsLiveRegionsFirst(resolvedArgs)
        ? await runAgentBrowser({
            ...spawnOptions,
            args: [
              ...connectionArgs,
              ...liveRegionsArgs({ settleMs: 0, since: 0 }),
            ],
            cancelSignal: AbortSignal.any([
              ...(ctx.signal ? [ctx.signal] : []),
              AbortSignal.timeout(LIVE_REGION_READ_TIMEOUT_MS),
            ]),
            input: undefined,
          }).then(
            (reading) =>
              reading.exitCode === 0
                ? liveRegionDocument(reading.stdout)
                : undefined,
            () => undefined,
          )
        : undefined;
    // Typed text with line breaks inside it, which goes in as one insertion
    // rather than with an Enter press per line.
    const typedRuns =
      isInfoOnly || browserFreeRead ? undefined : typedTextRuns(resolvedArgs);
    let result: Awaited<ReturnType<typeof runAgentBrowser>>;
    // When the command began, which the follow-up reads the page's messages
    // from.
    const startedAtEpoch = Date.now();
    try {
      if (typedRuns === undefined) {
        result = await runAgentBrowser({
          ...spawnOptions,
          args: commandArgs,
          cancelSignal: ctx.signal,
          input: subprocessStdin(ctx.stdin),
        });
        if (isEval(resolvedArgs)) {
          result = await awaitRunningScript({
            ask: (script) =>
              runAgentBrowser({
                ...spawnOptions,
                args: [
                  ...connectionArgs,
                  ...askForAnswerArgs(resolvedArgs, script),
                ],
                cancelSignal: ctx.signal,
                input: undefined,
              }),
            first: result,
            signal: ctx.signal,
          });
        }
      } else {
        // Each in turn, stopping at the first that fails, whose output is
        // the command's; otherwise the last one's is.
        result = { exitCode: 0, stderr: "", stdout: "" };
        for (const run of typedRuns) {
          result = await runAgentBrowser({
            ...spawnOptions,
            args: [...connectionArgs, ...run],
            cancelSignal: ctx.signal,
            input: undefined,
          });
          if (result.exitCode !== 0) {
            break;
          }
        }
      }
    } finally {
      if (drivesChatTabs) {
        await recordDrivenTabHosts({
          callPartId,
          chatId,
          sessionId,
          since: startedAtEpoch,
        });
      }
    }

    const scrub = (text: string) => agentSpellingOfFileUrls(text, layout);

    const exitCode = result.exitCode ?? 1;

    if (drivesPage && exitCode === 0 && readsLiveRegionsFirst(resolvedArgs)) {
      await runAside(AFTER_ACTION_PAUSE_ARGS, AFTER_ACTION_PAUSE_TIMEOUT_MS);
    }

    // What a screenshot as large as one gets leaves out.
    let screenshotNote: string | undefined;
    // A fetch or --help has no page.
    if (!isInfoOnly && !browserFreeRead) {
      const screenshot =
        exitCode === 0 &&
        parseAgentBrowserArgs(resolvedArgs).subcommand === "screenshot"
          ? savedScreenshotPath(result.stdout)
          : undefined;
      if (screenshot !== undefined) {
        const saved = path.resolve(hostCwd, screenshot);
        currentBrowserFollowUp()?.noteScreenshot(saved);
        screenshotNote = await cutScreenshotNote(saved);
      }
      followUp?.note({
        args: resolvedArgs,
        ...(before ? { before } : {}),
        exitCode,
        startedAt: startedAtEpoch,
        read: async (signal, { messages: reading, snapshot: snapshots }) => {
          const run = (readArgs: string[]) =>
            runAgentBrowser({
              ...spawnOptions,
              args: [...connectionArgs, ...readArgs],
              cancelSignal: signal,
              input: undefined,
            });
          const messages = async () => {
            if (reading === undefined) {
              return {};
            }
            const { settleMs, since } = reading;
            const live = await run(liveRegionsArgs({ settleMs, since }));
            const { said, showing } = liveRegionText(
              live.exitCode === 0 ? live.stdout : "",
              since,
              reading.before,
            );
            return {
              ...(said === undefined ? {} : { said: scrub(said) }),
              ...(showing === undefined ? {} : { showing: scrub(showing) }),
            };
          };
          if (!snapshots) {
            return { ...(await messages()), snapshot: "" };
          }
          // A click returns before the page it navigated to has loaded, and a
          // snapshot of a loading document has no controls in it. Resolves at
          // once on a page that is already past loading.
          await run(FOLLOW_UP_WAIT_ARGS);
          const snapshot = await run(FOLLOW_UP_SNAPSHOT_ARGS);
          if (snapshot.exitCode !== 0) {
            return undefined;
          }
          // Together, since neither decides whether there is an attachment
          // and one page's worth of either is a line of text.
          const [tabs, said] = await Promise.all([
            run(FOLLOW_UP_TABS_ARGS),
            messages(),
          ]);
          return {
            ...said,
            snapshot: scrub(snapshot.stdout),
            ...activeTab(tabs.exitCode === 0 ? tabs.stdout : ""),
          };
        },
      });
    }

    // The labels agent-browser prints for tabs are its own; each tab is
    // named instead by the id `instrument window` takes.
    let stdout = result.stdout;
    const tabOutput =
      exitCode === 0 && !browserFreeRead
        ? tabOutputOf(resolvedArgs)
        : undefined;
    if (tabOutput === "list-json") {
      stdout = jsonWithTabIds(stdout);
    } else if (tabOutput !== undefined) {
      const listed = await runAgentBrowser({
        ...spawnOptions,
        args: [
          ...commandArgs.slice(0, commandArgs.length - resolvedArgs.length),
          "tab",
          "list",
          "--json",
        ],
        cancelSignal: ctx.signal,
        input: undefined,
      });
      if (listed.exitCode === 0) {
        stdout =
          tabOutput === "list"
            ? withTabIds(stdout, listed.stdout)
            : `${stdout}${stdout === "" || stdout.endsWith("\n") ? "" : "\n"}${newTabLine(listed.stdout)}`;
      }
    }

    // Who else acted in the tabs this command drove since this session's
    // last command there: every session of a chat drives every tab of it.
    // And the popups its pages opened, each a new tab of the chat.
    const notes = [
      screenshotNote,
      ...(drivesChatTabs
        ? [
            pageOpenedTabsNote(sessionId),
            await tabNewsNote({ chatId, sessionId }),
          ]
        : []),
    ].filter((note) => note !== undefined);
    for (const note of notes) {
      // A script reads the command's own output; the note waits for the
      // end of the bash call.
      if (isScriptCall()) {
        currentBrowserFollowUp()?.noteNews(note);
        continue;
      }
      stdout = `${stdout}${stdout === "" || stdout.endsWith("\n") ? "" : "\n"}${note}`;
    }

    const output = {
      exitCode,
      stderr: scrub(result.stderr),
      stdout: scrub(stdout),
    };
    const answer = cappedWait ? cappedWaitResult(cappedWait, output) : output;
    // For the end of the bash call to name, when the call's output does not
    // show it, as when the command's output went to /dev/null.
    if (answer.exitCode !== 0) {
      currentBrowserFollowUp()?.noteFailure(
        resolvedArgs,
        failureLine(answer.stderr, answer.stdout),
      );
    }
    return answer;
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
 * The hosts of the pages in the tabs a command of a chat's session drove,
 * recorded as the sites its work used: read after the command, so a tab it
 * just opened and a page it just reached are both there.
 */
async function recordDrivenTabHosts({
  callPartId,
  chatId,
  sessionId,
  since,
}: {
  callPartId: StoreId.Part | undefined;
  chatId: ChatId;
  sessionId: StoreId.Session;
  since: number;
}) {
  const { browser } = getWorkspaceConfig();
  try {
    const urls = tabsActedInBy(sessionId)
      .filter((targetId) => (lastActOf(targetId, sessionId) ?? 0) >= since)
      .flatMap((targetId) => {
        const url = browser.getTargetUrl(targetId);
        return url ? [url] : [];
      });
    if (callPartId !== undefined) {
      recordStepPages(callPartId, sessionId, urls);
    }
    const result = await recordVisitedHosts({ sessionId, chatId, urls });
    if (result.isErr()) {
      getWorkspaceConfig().captureException(result.error);
    }
  } catch (error) {
    getWorkspaceConfig().captureException(error);
  }
}

async function runAgentBrowser(options: SpawnAgentBrowserOptions) {
  let result = await spawnAgentBrowser(options);
  for (const delay of DAEMON_RACE_RETRY_DELAYS_MS) {
    if (
      result.exitCode === 0 ||
      !isDaemonConfigRace([result.stdout, result.stderr].join("\n"))
    ) {
      break;
    }
    // Let the daemon that won the race finish starting; retrying into its
    // startup window would be refused for the same reason.
    await sleep(delay);
    result = await spawnAgentBrowser(options);
  }
  return result;
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
  // It drives the app's own browser, so the folder rules do not wrap it. The
  // one thing its profile closes is a listening port: the daemon it starts
  // otherwise serves upstream's dashboard on loopback, which answers any
  // process on the computer and relays commands to the browser, and which
  // nothing here uses (`stream`, `dashboard` and `chat` are all refused).
  recordProgramStart(agentBrowserPath(), "skipped");

  if (managedConfigPath) {
    await fs.mkdir(path.dirname(managedConfigPath), { recursive: true });
    await fs.writeFile(managedConfigPath, "{}\n");
  }

  const { subcommand } = parseAgentBrowserArgs(args);

  if (process.platform !== "win32") {
    const held = withTcpListenerClosed(agentBrowserPath(), managedArgs);
    const subprocess = execa(held.file, held.args, {
      cancelSignal,
      cwd,
      env,
      // The env is built whole; nothing else of the app's own reaches the
      // CLI.
      extendEnv: false,
      input,
      reject: false,
      // Keep the final newline; the interpreter concatenates each command's
      // output, so dropping it runs this command's last line into the next.
      // Set here rather than via execShim because the Windows branch below
      // reads the two streams back from files and has no merged stream to
      // return, so both paths keep stdout and stderr separate.
      stripFinalNewline: false,
    });
    const settled = watchSlowInvocation(subcommand, subprocess);
    try {
      return await subprocess;
    } finally {
      settled();
    }
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
    const child = spawn(agentBrowserPath(), managedArgs, {
      cwd,
      env,
      stdio: ["pipe", stdoutFd, stderrFd],
      windowsHide: true,
    });
    fsSync.closeSync(stdoutFd);
    fsSync.closeSync(stderrFd);

    const settled = watchSlowInvocation(subcommand, child);
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
    ).finally(settled);

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
  const { endOfOptions } = parseAgentBrowserArgs(args);
  const out: string[] = [];
  for (let i = 0; i < endOfOptions; i++) {
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
  return [...out, ...args.slice(endOfOptions)];
}
