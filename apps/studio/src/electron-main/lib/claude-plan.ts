import {
  downloadClaudeCode,
  installedCopy,
  wantedRelease,
} from "@/electron-main/lib/claude-code-download";
import { createScopedLogger } from "@/electron-main/lib/electron-logger";
import { publisher } from "@/electron-main/rpc/publisher";
import { focusAppWindow } from "@/electron-main/windows/foreground";
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
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { app, shell } from "electron";
import { z } from "zod";

const log = createScopedLogger("claude-plan");
const run = promisify(execFile);

/** Re-checked at most this often, however often a window takes focus. */
const REFRESH_INTERVAL_MS = 5000;

/** How long a sign-in waits on the browser before its process is let go. */
const SIGN_IN_TIMEOUT_MS = 15 * 60 * 1000;

/** What `claude auth status` prints, read without touching any credential. */
const AuthStatusSchema = z.object({
  authMethod: z.string().optional(),
  email: z.string().nullish(),
  loggedIn: z.boolean(),
  subscriptionType: z.string().nullish(),
});

/**
 * Our copy of Claude Code being installed, or why the last try failed.
 * Undefined while nothing is under way.
 */
export type ClaudeCodeInstall =
  | { failed: string; state: "failed" }
  | { received: number; state: "downloading"; total: number };

export type ClaudePlanStatus = {
  /** Whether this platform has a Claude Code build we can install. */
  canInstall: boolean;
  install: ClaudeCodeInstall | undefined;
  /** A sign-in is open in the browser, waiting on the person. */
  signingIn: boolean;
} & (
  | { kind: "not-installed" }
  | {
      executablePath: string;
      /** Signed in once, but the sign-in has run out and needs doing again. */
      expired?: boolean;
      kind: "signed-out";
    }
  // Signed in, but to an API key or a cloud provider rather than a plan.
  | { authMethod: string; executablePath: string; kind: "not-a-plan" }
  | {
      email: string | undefined;
      executablePath: string;
      kind: "signed-in";
      plan: string | undefined;
    }
);

let status: ClaudePlanStatus = {
  canInstall: false,
  install: undefined,
  kind: "not-installed",
  signingIn: false,
};
let install: ClaudeCodeInstall | undefined;
let pendingSignIn: ClaudeCodeSignIn | undefined;
let lastRefresh = 0;
let refreshing: Promise<ClaudePlanStatus> | undefined;

/**
 * Where our copy of Claude Code keeps its Claude sign-in, as its config
 * folder. Apart from the person's own `~/.claude`, so signing in here never
 * changes which account their own Claude Code uses, and theirs never signs
 * this one out.
 */
function accountDir() {
  return path.join(app.getPath("userData"), "claude-account");
}

export function claudePlanStatus() {
  return status;
}

/**
 * The Claude account's provider config while our copy of Claude Code is
 * signed in to one. It holds no credential: Claude Code keeps the sign-in,
 * and we only drive it.
 */
export function claudePlanProviderConfigs(): AIGatewayProviderConfig.Type[] {
  if (status.kind !== "signed-in") {
    return [];
  }
  return [
    {
      ...CLAUDE_PLAN_PROVIDER_CONFIG,
      apiKey: AI_GATEWAY_API_KEY_NOT_NEEDED,
      configDir: accountDir(),
      executablePath: status.executablePath,
      id: AIProviderConfigIdSchema.parse(CLAUDE_PLAN_PROVIDER_CONFIG.id),
    },
  ];
}

/** Ask our copy of Claude Code who is signed in, unless that was just done. */
export function refreshClaudePlanStatus({ force = false } = {}) {
  if (refreshing) {
    return refreshing;
  }
  if (!force && Date.now() - lastRefresh < REFRESH_INTERVAL_MS) {
    return Promise.resolve(status);
  }
  refreshing = readStatus()
    .catch((error: unknown) => {
      log.warn("Couldn't read Claude Code's status", error);
      return status;
    })
    .then((next) => {
      lastRefresh = Date.now();
      setStatus(next);
      return next;
    })
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
}

function setStatus(next: ClaudePlanStatus) {
  const changed = JSON.stringify(next) !== JSON.stringify(status);
  status = next;
  if (changed) {
    publisher.publish("claude-plan.updated", null);
    publisher.publish("provider-config.updated", null);
  }
}

/** How much of the subscription is used, or nothing while none is signed in. */
export async function claudePlanUsage() {
  if (status.kind !== "signed-in") {
    return null;
  }
  return fetchClaudePlanUsage({
    configDir: accountDir(),
    executablePath: status.executablePath,
  });
}

async function readStatus(): Promise<ClaudePlanStatus> {
  const executablePath = await installedCopy();
  return {
    ...(executablePath
      ? await readSignIn(executablePath)
      : { kind: "not-installed" as const }),
    canInstall: wantedRelease() !== undefined,
    install,
    signingIn: pendingSignIn !== undefined,
  };
}

async function readSignIn(executablePath: string) {
  // Exits 1 when signed out, still printing the JSON.
  const parsed = AuthStatusSchema.safeParse(
    safeJSON(await statusOutput(executablePath, ["auth", "status"])),
  );
  if (!parsed.success || !parsed.data.loggedIn) {
    return { executablePath, kind: "signed-out" as const };
  }
  if (parsed.data.authMethod !== "claude.ai") {
    return {
      authMethod: parsed.data.authMethod ?? "unknown",
      executablePath,
      kind: "not-a-plan" as const,
    };
  }
  // The JSON still says signed in for a sign-in that has run out, until a
  // request tries to renew it; the text status says "Expired".
  const text = await statusOutput(executablePath, ["auth", "status", "--text"]);
  if (/\bExpired\b/i.test(text)) {
    return { executablePath, expired: true, kind: "signed-out" as const };
  }
  return {
    email: parsed.data.email ?? undefined,
    executablePath,
    kind: "signed-in" as const,
    plan: parsed.data.subscriptionType ?? undefined,
  };
}

async function statusOutput(executablePath: string, args: string[]) {
  return run(executablePath, args, { env: cliEnv(), timeout: 10_000 }).then(
    (result) => result.stdout,
    (error: unknown) =>
      typeof error === "object" && error !== null && "stdout" in error
        ? String(error.stdout)
        : "",
  );
}

/**
 * Sign in to Claude: install our copy of Claude Code if it is not in yet,
 * then start its own sign-in and open Anthropic's page in the browser. The
 * page returns to Claude Code, which stores the sign-in itself; this only
 * notices it finish and brings the app back to the front. Where the browser
 * sign-in cannot start, Claude Code's sign-in opens in a terminal instead.
 */
export async function openClaudeSignIn(): Promise<{
  command: string | undefined;
  opened: boolean;
  via: "browser" | "terminal";
}> {
  let current = await refreshClaudePlanStatus({ force: true });
  if (current.kind === "not-installed" && current.canInstall) {
    await installClaudeCode();
    current = status;
  }
  if (current.kind === "not-installed") {
    return { command: undefined, opened: false, via: "browser" };
  }
  const { executablePath } = current;
  try {
    pendingSignIn?.cancel();
    await mkdir(accountDir(), { recursive: true });
    const signIn = await startClaudeCodeSignIn({
      configDir: accountDir(),
      executablePath,
    });
    pendingSignIn = signIn;
    setStatus({ ...status, signingIn: true });
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
        void refreshClaudePlanStatus({ force: true }).then((after) => {
          if (after.kind === "signed-in") {
            focusAppWindow();
          }
        });
      });
    await shell.openExternal(signIn.url);
    return { command: undefined, opened: true, via: "browser" };
  } catch (error) {
    log.warn(
      "Couldn't start Claude sign-in in the browser; using a terminal",
      error,
    );
    return { ...(await openTerminalSignIn(executablePath)), via: "terminal" };
  }
}

/**
 * Sign in through Claude Code in a terminal instead, for when the browser
 * cannot get back to it: a browser on another device, or a computer that
 * blocks `localhost`. Claude Code then shows Anthropic's page with a code to
 * paste, and takes the code itself, so it never passes through Instrument.
 */
export async function openClaudeTerminalSignIn() {
  cancelClaudeSignIn();
  const current = await refreshClaudePlanStatus({ force: true });
  if (current.kind === "not-installed") {
    return { command: undefined, opened: false };
  }
  await mkdir(accountDir(), { recursive: true });
  return openTerminalSignIn(current.executablePath);
}

/** Give up on a sign-in still waiting on the browser. */
export function cancelClaudeSignIn() {
  pendingSignIn?.cancel();
  pendingSignIn = undefined;
  setStatus({ ...status, signingIn: false });
}

/**
 * Open a terminal running Claude Code's own sign-in, which finishes in the
 * browser. Answers the command, for a platform where no terminal could be
 * opened and the person has to run it themselves.
 */
async function openTerminalSignIn(executablePath: string) {
  const env = cliEnv();
  const command = `CLAUDE_CONFIG_DIR="${accountDir()}" "${executablePath}" auth login`;
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
      spawn("cmd.exe", ["/c", "start", '""', executablePath, "auth", "login"], {
        detached: true,
        env,
        stdio: "ignore",
        windowsHide: false,
      }).unref();
      return { command, opened: true };
    }
    spawn("x-terminal-emulator", ["-e", executablePath, "auth", "login"], {
      detached: true,
      env,
      stdio: "ignore",
    })
      .on("error", () => {})
      .unref();
    return { command, opened: true };
  } catch (error) {
    log.warn("Couldn't open a terminal for Claude sign-in", error);
    return { command, opened: false };
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
 * The environment our copy runs in: its own sign-in folder, and no API key
 * that would answer instead of the subscription.
 */
function cliEnv() {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) =>
          name !== "ANTHROPIC_API_KEY" && name !== "ANTHROPIC_AUTH_TOKEN",
      ),
    ),
    CLAUDE_CONFIG_DIR: accountDir(),
  };
}

function safeJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
