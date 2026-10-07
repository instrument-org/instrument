import { createScopedLogger } from "@/electron-main/lib/electron-logger";
import { publisher } from "@/electron-main/rpc/publisher";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import {
  type AIGatewayProviderConfig,
  fetchClaudePlanUsage,
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

export type ClaudePlanStatus = { setup: ClaudeCodeSetup } & (
  | { kind: "not-installed" }
  | { executablePath: string; kind: "outdated"; version: string }
  | { executablePath: string; kind: "signed-out"; version: string }
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

let status: ClaudePlanStatus = { kind: "not-installed", setup: {} };
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
  const result = await readCLI(chosen);
  return { ...result, setup: chosen };
}

async function readCLI(chosen: ClaudeCodeSetup) {
  const executablePath = await findExecutable(chosen.executablePath);
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
 * Open a terminal running the CLI's own sign-in, which finishes in the
 * browser. Anthropic's flow from end to end: we never see the result, only
 * read who is signed in afterwards. Answers the command, for a platform where
 * no terminal could be opened and the person has to run it themselves.
 */
export async function openClaudeSignIn() {
  const current = await refreshClaudePlanStatus({ force: true });
  if (current.kind === "not-installed") {
    return { command: undefined, opened: false };
  }
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

async function findExecutable(chosen: string | undefined) {
  // A path the person chose is the only one tried: falling back to another
  // install would sign in someone they did not pick.
  for (const candidate of chosen ? [chosen] : candidatePaths()) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here.
    }
  }
  return undefined;
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
