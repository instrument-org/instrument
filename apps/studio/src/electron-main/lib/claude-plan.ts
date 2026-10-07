import {
  downloadClaudeCode,
  installedCopy,
  wantedRelease,
} from "@/electron-main/lib/claude-code-download";
import { createScopedLogger } from "@/electron-main/lib/electron-logger";
import { publisher } from "@/electron-main/rpc/publisher";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import {
  type AIGatewayProviderConfig,
  type ClaudeCodeSignIn,
  fetchClaudePlanUsage,
  startClaudeCodeSignIn,
} from "@instrument-org/ai-gateway";
import {
  AI_GATEWAY_API_KEY_NOT_NEEDED,
  AIProviderConfigIdSchema,
  CLAUDE_PLAN_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { execFile, spawn } from "node:child_process";
import { access, chmod, constants, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { shell } from "electron";
import { z } from "zod";

const log = createScopedLogger("claude-plan");
const run = promisify(execFile);

/**
 * The oldest CLI the Agent SDK we build against is known to drive. The SDK and
 * the CLI ship in lockstep, and an older CLI may not understand what it sends.
 */
const MINIMUM_VERSION = [2, 1, 285] as const;

/** Re-checked at most this often, however often a window takes focus. */
const REFRESH_INTERVAL_MS = 5000;

/** What `claude auth status` prints, read without touching any credential. */
const AuthStatusSchema = z.object({
  authMethod: z.string().optional(),
  email: z.string().nullish(),
  loggedIn: z.boolean(),
  subscriptionType: z.string().nullish(),
});

/** Which CLI and config folder to use, when the person chose rather than us finding them. */
export interface ClaudeCodeSetup {
  configDir?: string;
  executablePath?: string;
}

/**
 * Our own copy of Claude Code being installed, or why the last try failed.
 * Undefined while nothing is under way.
 */
export type ClaudeCodeInstall =
  | { failed: string; state: "failed" }
  | { received: number; state: "downloading"; total: number };

export type ClaudePlanStatus = {
  /** Whether this platform has a Claude Code build we can install. */
  canInstall: boolean;
  install: ClaudeCodeInstall | undefined;
  setup: ClaudeCodeSetup;
  /** Whose copy runs: one the person chose, ours, or one found on the system. */
  source: "chosen" | "ours" | "system" | undefined;
} & (
  | { kind: "not-installed" }
  | { executablePath: string; kind: "outdated"; version: string }
  | {
      executablePath: string;
      /** Signed in once, but the sign-in has run out and needs doing again. */
      expired?: boolean;
      kind: "signed-out";
      version: string;
    }
  // Signed in, but to an API key or a cloud provider rather than a plan.
  | {
      authMethod: string;
      executablePath: string;
      kind: "not-a-plan";
      version: string;
    }
  | {
      email: string | undefined;
      executablePath: string;
      kind: "signed-in";
      plan: string | undefined;
      version: string;
    }
);

let status: ClaudePlanStatus = {
  canInstall: false,
  install: undefined,
  kind: "not-installed",
  setup: {},
  source: undefined,
};
let install: ClaudeCodeInstall | undefined;
let lastRefresh = 0;
let refreshing: Promise<ClaudePlanStatus> | undefined;

export function claudePlanStatus() {
  return status;
}

/**
 * The Claude plan's provider config while the CLI is signed in to one. It
 * holds no credential: the CLI keeps the sign-in, and we only drive it.
 */
export function claudePlanProviderConfigs(): AIGatewayProviderConfig.Type[] {
  if (status.kind !== "signed-in") {
    return [];
  }
  return [
    {
      ...CLAUDE_PLAN_PROVIDER_CONFIG,
      apiKey: AI_GATEWAY_API_KEY_NOT_NEEDED,
      configDir: status.setup.configDir,
      executablePath: status.executablePath,
      id: AIProviderConfigIdSchema.parse(CLAUDE_PLAN_PROVIDER_CONFIG.id),
    },
  ];
}

/** Look for the CLI and ask it who is signed in, unless that was just done. */
export function refreshClaudePlanStatus({ force = false } = {}) {
  if (refreshing) {
    return refreshing;
  }
  if (!force && Date.now() - lastRefresh < REFRESH_INTERVAL_MS) {
    return Promise.resolve(status);
  }
  refreshing = readStatus()
    .catch((error: unknown) => {
      log.warn("Couldn't read the Claude Code CLI's status", error);
      return status;
    })
    .then((next) => {
      lastRefresh = Date.now();
      const changed = JSON.stringify(next) !== JSON.stringify(status);
      status = next;
      if (changed) {
        publisher.publish("claude-plan.updated", null);
        publisher.publish("provider-config.updated", null);
      }
      return next;
    })
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
}

function setup(): ClaudeCodeSetup {
  return getMachinePreferences().get("claudeCode");
}

/** Use this CLI and config folder from now on, or the defaults for either left out. */
export function setClaudeCodeSetup(next: ClaudeCodeSetup) {
  getMachinePreferences().set("claudeCode", {
    configDir: expandHome(next.configDir),
    executablePath: expandHome(next.executablePath),
  });
  return refreshClaudePlanStatus({ force: true });
}

/** How much of the plan is used, or nothing while no plan is signed in. */
export async function claudePlanUsage() {
  if (status.kind !== "signed-in") {
    return null;
  }
  return fetchClaudePlanUsage({
    configDir: status.setup.configDir,
    executablePath: status.executablePath,
  });
}

async function readStatus(): Promise<ClaudePlanStatus> {
  const chosen = setup();
  const found = await findExecutable(chosen.executablePath);
  const result = await readCLI(found?.executablePath, chosen);
  return {
    ...result,
    canInstall: wantedRelease() !== undefined,
    install,
    setup: chosen,
    source: found?.source,
  };
}

async function readCLI(
  executablePath: string | undefined,
  chosen: ClaudeCodeSetup,
) {
  if (!executablePath) {
    return { kind: "not-installed" as const };
  }
  const { stdout: versionOutput } = await run(executablePath, ["--version"], {
    env: cliEnv(chosen),
    timeout: 10_000,
  });
  const version = versionOutput.trim().split(/\s+/)[0] ?? "";
  if (!isAtLeast(version, MINIMUM_VERSION)) {
    return { executablePath, kind: "outdated" as const, version };
  }
  // Exits 1 when signed out, still printing the JSON.
  const stdout = await run(executablePath, ["auth", "status"], {
    env: cliEnv(chosen),
    timeout: 10_000,
  }).then(
    (result) => result.stdout,
    (error: unknown) =>
      typeof error === "object" && error !== null && "stdout" in error
        ? String(error.stdout)
        : "",
  );
  const parsed = AuthStatusSchema.safeParse(safeJSON(stdout));
  if (!parsed.success || !parsed.data.loggedIn) {
    return { executablePath, kind: "signed-out" as const, version };
  }
  if (parsed.data.authMethod === "claude.ai" && (await isExpired(executablePath, chosen))) {
    return {
      executablePath,
      expired: true,
      kind: "signed-out" as const,
      version,
    };
  }
  if (parsed.data.authMethod !== "claude.ai") {
    return {
      authMethod: parsed.data.authMethod ?? "unknown",
      executablePath,
      kind: "not-a-plan" as const,
      version,
    };
  }
  return {
    email: parsed.data.email ?? undefined,
    executablePath,
    kind: "signed-in" as const,
    plan: parsed.data.subscriptionType ?? undefined,
    version,
  };
}

/**
 * Whether a claude.ai sign-in has run out. The JSON status still says signed
 * in until a request tries to renew it; the text status says "Expired".
 */
async function isExpired(executablePath: string, chosen: ClaudeCodeSetup) {
  const stdout = await run(executablePath, ["auth", "status", "--text"], {
    env: cliEnv(chosen),
    timeout: 10_000,
  }).then(
    (result) => result.stdout,
    (error: unknown) =>
      typeof error === "object" && error !== null && "stdout" in error
        ? String(error.stdout)
        : "",
  );
  return /\bExpired\b/i.test(stdout);
}

/** How long a sign-in waits on the browser before its process is let go. */
const SIGN_IN_TIMEOUT_MS = 15 * 60 * 1000;

let pendingSignIn: ClaudeCodeSignIn | undefined;

/**
 * Start Claude Code's own sign-in and open Anthropic's page in the browser.
 * The page returns to Claude Code, which stores the sign-in itself; this only
 * notices it finish. Where that cannot start, Claude Code's sign-in opens in a
 * terminal instead. Answers how it went: in the browser, in a terminal, or a
 * command for the person to run where no terminal could be opened.
 */
export async function openClaudeSignIn(): Promise<{
  command: string | undefined;
  opened: boolean;
  via: "browser" | "terminal";
}> {
  const current = await refreshClaudePlanStatus({ force: true });
  if (current.kind === "not-installed") {
    return { command: undefined, opened: false, via: "terminal" };
  }
  try {
    pendingSignIn?.cancel();
    const signIn = await startClaudeCodeSignIn({
      configDir: current.setup.configDir,
      executablePath: current.executablePath,
    });
    pendingSignIn = signIn;
    const timer = setTimeout(() => {
      signIn.cancel();
    }, SIGN_IN_TIMEOUT_MS);
    void signIn.completion
      .catch((error: unknown) => {
        log.info("Claude sign-in ended without finishing", error);
      })
      .finally(() => {
        clearTimeout(timer);
        if (pendingSignIn === signIn) {
          pendingSignIn = undefined;
        }
        void refreshClaudePlanStatus({ force: true });
      });
    await shell.openExternal(signIn.url);
    return { command: undefined, opened: true, via: "browser" };
  } catch (error) {
    log.warn("Couldn't start Claude sign-in in the browser; using a terminal", error);
    return { ...(await openTerminalSignIn(current)), via: "terminal" };
  }
}

/**
 * Open a terminal running the CLI's own sign-in, which finishes in the
 * browser. Answers the command, for a platform where no terminal could be
 * opened and the person has to run it themselves.
 */
async function openTerminalSignIn(current: {
  executablePath: string;
  setup: ClaudeCodeSetup;
}) {
  const env = cliEnv(current.setup);
  const command = current.setup.configDir
    ? `CLAUDE_CONFIG_DIR="${current.setup.configDir}" "${current.executablePath}" auth login`
    : `"${current.executablePath}" auth login`;
  try {
    if (process.platform === "darwin") {
      // A `.command` file opens in the person's own terminal app, with no
      // automation permission to grant.
      const dir = await mkdtemp(path.join(tmpdir(), "claude-sign-in-"));
      const file = path.join(dir, "Sign in to Claude.command");
      await writeFile(file, `#!/bin/sh\nexec env ${command}\n`);
      await chmod(file, 0o755);
      const error = await shell.openPath(file);
      return { command, opened: error === "" };
    }
    if (process.platform === "win32") {
      spawn(
        "cmd.exe",
        ["/c", "start", '""', current.executablePath, "auth", "login"],
        {
          detached: true,
          env,
          stdio: "ignore",
          windowsHide: false,
        },
      ).unref();
      return { command, opened: true };
    }
    spawn(
      "x-terminal-emulator",
      ["-e", current.executablePath, "auth", "login"],
      {
        detached: true,
        env,
        stdio: "ignore",
      },
    )
      .on("error", () => {})
      .unref();
    return { command, opened: true };
  } catch (error) {
    log.warn("Couldn't open a terminal for Claude sign-in", error);
    return { command, opened: false };
  }
}

/**
 * Where people install the CLI, since an app opened from the Dock or Finder
 * gets a PATH without their shell's additions.
 */
function candidatePaths() {
  const home = homedir();
  const fromPath = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  if (process.platform === "win32") {
    const localAppData = path.join(home, "AppData", "Local");
    return [
      path.join(home, ".local", "bin", "claude.exe"),
      path.join(localAppData, "Programs", "claude", "claude.exe"),
      path.join(localAppData, "Microsoft", "WinGet", "Links", "claude.exe"),
      ...fromPath.map((dir) => path.join(dir, "claude.exe")),
    ];
  }
  return [
    path.join(home, ".local", "bin", "claude"),
    path.join(home, ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/usr/bin/claude",
    path.join(home, ".npm-global", "bin", "claude"),
    ...fromPath.map((dir) => path.join(dir, "claude")),
  ];
}

/**
 * The CLI to run: the one the person chose, which is the only one tried when
 * set, since falling back to another would sign in someone they did not pick;
 * else our own copy, which matches the SDK by construction; else one found
 * where people install it.
 */
async function findExecutable(chosen: string | undefined): Promise<
  | { executablePath: string; source: "chosen" | "ours" | "system" }
  | undefined
> {
  if (chosen) {
    return (await isExecutable(chosen))
      ? { executablePath: chosen, source: "chosen" }
      : undefined;
  }
  const ours = await installedCopy();
  if (ours) {
    return { executablePath: ours, source: "ours" };
  }
  for (const candidate of candidatePaths()) {
    if (await isExecutable(candidate)) {
      return { executablePath: candidate, source: "system" };
    }
  }
  return undefined;
}

async function isExecutable(file: string) {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Install our own copy of the Claude Code release this build drives, then
 * look again. Progress and failure ride on the status.
 */
export async function installClaudeCode() {
  if (install?.state === "downloading") {
    return;
  }
  const publish = (next: ClaudeCodeInstall | undefined) => {
    install = next;
    status = { ...status, install };
    publisher.publish("claude-plan.updated", null);
  };
  publish({ received: 0, state: "downloading", total: 0 });
  try {
    await downloadClaudeCode(({ received, total }) => {
      publish({ received, state: "downloading", total });
    });
    publish(undefined);
  } catch (error) {
    log.warn("Couldn't install Claude Code", error);
    publish({
      failed: error instanceof Error ? error.message : String(error),
      state: "failed",
    });
  }
  await refreshClaudePlanStatus({ force: true });
}

/**
 * The environment the CLI runs in for us: the chosen config folder, and no
 * API key that would answer instead of the plan.
 */
function cliEnv(chosen: ClaudeCodeSetup) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) =>
          name !== "ANTHROPIC_API_KEY" && name !== "ANTHROPIC_AUTH_TOKEN",
      ),
    ),
    ...(chosen.configDir ? { CLAUDE_CONFIG_DIR: chosen.configDir } : {}),
  };
}

/** A typed path, with a leading `~` as the shell would read it; blank is none. */
function expandHome(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed === "~" || trimmed.startsWith("~/")
    ? path.join(homedir(), trimmed.slice(1))
    : trimmed;
}

function isAtLeast(version: string, minimum: readonly number[]) {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  for (const [index, wanted] of minimum.entries()) {
    const have = parts[index] ?? 0;
    if (Number.isNaN(have) || have < wanted) {
      return false;
    }
    if (have > wanted) {
      return true;
    }
  }
  return true;
}

function safeJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
