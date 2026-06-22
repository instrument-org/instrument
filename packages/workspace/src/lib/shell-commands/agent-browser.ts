import { execa } from "execa";
import { defineCommand, latin1FromBytes } from "just-bash";
import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { dedent } from "radashi";

import { TASK_FOLDER_NAMES } from "../../constants";
import { CDP_PAGE_PATH_PREFIX } from "../../logic/server/constants";
import { getWorkspaceServerPort } from "../../logic/server/url";
import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { WebSearch } from "../../tools/web-search";
import { type BrowserTargetId } from "../../types";
import { absolutePathJoin } from "../absolute-path-join";
import { AGENT_BROWSER_PATH, AGENT_BROWSER_SOCKET_DIR } from "../agent-browser";
import { recordBrowserUse } from "../browser-state";
import {
  beginBrowserCommandObservation,
  type UpsertContextItem,
} from "../capture-browser-screenshot";
import { isTaskId } from "../is-task-id";
import {
  getAgentBrowserStateDir,
  getBrowserSessionDir,
  taskDir,
} from "../task-dir-utils";
import { getWorkspaceConfig } from "../workspace-config";
import { resolveCommandContext, resolvePathArgs } from "./utils";

const AGENT_BROWSER_SKILL_NAME = "agent-browser";

export const AGENT_BROWSER_COMMAND = {
  description: dedent`
    Control a built-in Chromium browser to navigate the web, interact with pages, and extract content.
    IMPORTANT: You MUST load the \`${AGENT_BROWSER_SKILL_NAME}\` skill before using this command. Do not run any agent-browser commands until the skill is loaded.
    IMPORTANT: Never fabricate specific or deep URLs from memory -- they change and training data is stale. Well-known root domains are fine; for anything more specific, use \`${WebSearch.name}\` first to discover the correct URL before opening the browser.
    Do NOT pass connection, provider, profile, or state flags; the browser session is managed automatically.
  `.trim(),
  name: AGENT_BROWSER_SKILL_NAME,
} as const;

// Flags rejected because they would bypass our Electron CDP bridge or load
// data into the wrong browser context.
const BLOCKED_FLAGS = new Set([
  "--auto-connect", // Would discover a real Chrome instance instead of our bridge.
  "--cdp", // Harness injects this; agent override would point at the wrong target.
  "--profile", // Copies a real Chrome profile; meaningless for our proxied target.
  "--provider", // Would launch a cloud browser
  "--session", // Harness injects this; tied to our session id.
  "--state", // Loads cookies/localStorage into a context our bridge doesn't own.
]);

// Subcommands rejected because they don't apply to our proxied target or
// duplicate workspace-managed features. CLI-side check; action-policy only
// gates in-session actions, not these meta-commands.
const BLOCKED_SUBCOMMANDS = new Set([
  "auth", // Credential vault; we don't expose it.
  "chat", // Built-in AI REPL; the agent is the AI.
  "close", // Lifecycle managed by the workspace.
  "dashboard", // We have our own UI.
  "doctor", // Diagnoses real Chrome installs, not our Electron bridge.
  "inspect", // Opens Chrome DevTools, which doesn't work against our WebContentsView CDP bridge.
  "launch", // We don't launch; we proxy an existing target.
  "profiles", // Lists real Chrome profiles; N/A.
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
// browser target. Skip target creation / --cdp / --session injection so the
// agent doesn't accidentally spawn a browser view just by running --help.
const INFO_ONLY_FLAGS = new Set(["--help", "--version", "-h", "-V"]);

// Idle ms after which the agent-browser daemon self-terminates. Tuned to
// outlast a single agent-loop tool-call gap (a few seconds) but reap soon
// after the agent moves on. The view itself stays warm; only the daemon dies.
const IDLE_TIMEOUT_MS = "30000";

export function createAgentBrowserCommand({
  sessionId,
  taskId,
  upsertContextItem,
}: {
  sessionId: StoreId.Session;
  taskId: TaskId;
  upsertContextItem: UpsertContextItem;
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

    // Match both --flag and --flag=value forms.
    const blockedArg = args.find((a) => {
      const flagName = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
      return BLOCKED_FLAGS.has(flagName);
    });
    if (blockedArg) {
      return {
        exitCode: 1,
        stderr: `agent-browser: flag ${blockedArg} is not allowed. The browser session is managed automatically.\n`,
        stdout: "",
      };
    }

    const subcommand = args.find((a) => !a.startsWith("-"));
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
    const resolvedArgs = resolvePathArgs(strippedArgs, taskId, ctx);

    // Info-only invocations (--help, --version) print and exit without ever
    // touching a browser target, so don't spin up a WebContentsView or attach
    // to the CDP bridge.
    const commandArgs: string[] = isInfoOnly ? [...resolvedArgs] : [];
    let targetId: BrowserTargetId | undefined;

    if (!isInfoOnly) {
      // Idempotent: createTarget returns the existing view for this
      // (id, sessionId) pair if one is already live, so sub-agents and
      // repeat invocations within the same session reuse the same browsing
      // surface (cookies, page, debugger).
      const partitionDir = getBrowserSessionDir(taskDir(taskId));
      const target = await workspaceConfig.browser.createTarget(
        id,
        sessionId,
        partitionDir,
      );
      targetId = target.targetId;
      await recordBrowserUseBestEffort({ sessionId, taskId });

      const cdpUrl = `ws://127.0.0.1:${serverPort}${CDP_PAGE_PATH_PREFIX}${targetId}`;
      commandArgs.push(
        "--cdp",
        cdpUrl,
        "--session",
        sessionId,
        ...resolvedArgs,
      );
    }

    const tmpDir = absolutePathJoin(taskDir(taskId), TASK_FOLDER_NAMES.tmp);
    const screenshotDir = absolutePathJoin(tmpDir, "agent-browser-screenshots");
    const downloadPath = absolutePathJoin(tmpDir, "agent-browser-downloads");
    const agentBrowserStateDir = getAgentBrowserStateDir(taskDir(taskId));
    // Relative so agent-browser outputs screenshot paths the agent sees as relative
    // to its cwd (e.g. "tmp/agent-browser-screenshots/shot.png"), not host absolute.
    const screenshotDirRelative = path.relative(taskCwd, screenshotDir);
    // just-bash sets HOME=/ which is read-only. Most agent-browser writes are
    // already redirected via dedicated env vars (socket dir, screenshot dir,
    // download path); this is a per-task sink for anything that falls back
    // to $HOME (e.g. ~/.agent-browser/config reads, future writes).
    const homeDir = absolutePathJoin(
      taskDir(taskId),
      TASK_FOLDER_NAMES.private,
      "agent-browser-home",
    );

    // Stored without the `agent-browser` prefix: the context-item kind
    // already discriminates these as agent-browser invocations, so the
    // prefix is dead weight in every record.
    const subcommandText = args.join(" ");

    // Open the observation before invoking the binary so the UI can render
    // a pending card immediately and so a record exists even if execa
    // throws or the process is canceled mid-flight. Info-only invocations
    // (--help, --version) never touch the browser target, so we skip
    // observation entirely; everything else gets a start+end screenshot
    // pair (deduped by content hash on disk).
    const observation = isInfoOnly
      ? undefined
      : await beginBrowserCommandObservation({
          sessionId,
          subcommand: subcommandText,
          taskId: id,
          upsertContextItem,
        });

    let result: Awaited<ReturnType<typeof runAgentBrowser>>;
    try {
      result = await runAgentBrowser({
        args: commandArgs,
        cancelSignal: ctx.signal,
        cwd: taskCwd,
        env: {
          ...env,
          // Null out env-var equivalents of BLOCKED_FLAGS so the user shell
          // can't bypass the rejection above.
          AGENT_BROWSER_AUTO_CONNECT: undefined,
          AGENT_BROWSER_CDP: undefined,
          // Uncomment this to enable debug mode.
          // AGENT_BROWSER_DEBUG:
          //   process.env.NODE_ENV === "development" ? "1" : undefined,
          AGENT_BROWSER_DOWNLOAD_PATH: downloadPath, // Passed to Chrome via CDP setDownloadBehavior, which requires an absolute path.
          AGENT_BROWSER_IDLE_TIMEOUT_MS: IDLE_TIMEOUT_MS,
          AGENT_BROWSER_PROFILE: undefined,
          AGENT_BROWSER_PROVIDER: undefined,
          AGENT_BROWSER_SCREENSHOT_DIR: screenshotDirRelative,
          AGENT_BROWSER_SOCKET_DIR,
          AGENT_BROWSER_STATE: undefined,
          HOME: homeDir,
        },
        input: latin1FromBytes(ctx.stdin) || undefined,
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
    if (observation) {
      // Prefer stderr for the failure message (typical CLI convention);
      // fall back to combined output so the agent always has *some*
      // explanation when the command failed without writing to stderr.
      const failureMessage =
        exitCode === 0
          ? undefined
          : result.stderr || result.stdout || `exit code ${exitCode}`;
      await observation.complete({ error: failureMessage });
    }

    return {
      exitCode,
      stderr: "",
      stdout: combined,
    };
  });
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

async function runAgentBrowser({
  args,
  cancelSignal,
  cwd,
  env,
  input,
  stateDir,
}: {
  args: string[];
  cancelSignal: AbortSignal | undefined;
  cwd: string;
  env: Record<string, string | undefined>;
  input: string | undefined;
  stateDir: string;
}) {
  if (process.platform !== "win32") {
    return await execa(AGENT_BROWSER_PATH, args, {
      cancelSignal,
      cwd,
      env,
      input,
      reject: false,
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
    const child = spawn(AGENT_BROWSER_PATH, args, {
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
