import {
  currentCopy,
  downloadClaudeCode,
  installedCopy,
  wantedRelease,
} from "@/electron-main/lib/claude-code-download";
import { createScopedLogger } from "@/electron-main/lib/electron-logger";
import { publisher } from "@/electron-main/rpc/publisher";
import { focusAppWindow } from "@/electron-main/windows/foreground";
import {
  type AIGatewayProviderConfig,
  claudeCodeEnvironment,
  type ClaudeCodeSignIn,
  fetchClaudePlanUsage,
  startClaudeCodeSignIn,
  UnusableCodeError,
} from "@instrument-org/ai-gateway";
import {
  AI_GATEWAY_API_KEY_NOT_NEEDED,
  AIProviderConfigIdSchema,
  CLAUDE_PLAN_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { execFile, spawn } from "node:child_process";
import {
  access,
  chmod,
  constants,
  mkdir,
  mkdtemp,
  stat,
  writeFile,
} from "node:fs/promises";
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
  /**
   * Anthropic's sign-in page for another device, while a sign-in waits: it
   * ends on a code the person pastes back here.
   */
  signInLink: string | undefined;
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
  signInLink: undefined,
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
export function refreshClaudePlanStatus({
  force = false,
} = {}): Promise<ClaudePlanStatus> {
  if (refreshing) {
    // A forced read follows something that just changed, which a read
    // already under way may have started before.
    return force
      ? refreshing.then(() => refreshClaudePlanStatus({ force: true }))
      : refreshing;
  }
  if (!force && Date.now() - lastRefresh < REFRESH_INTERVAL_MS) {
    return Promise.resolve(status);
  }
  refreshing = readStatus()
    .catch((error: unknown) => {
      // A status Claude Code could not give (it timed out, or would not
      // start) says nothing about the sign-in, so the last one stands.
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
    signInLink: pendingSignIn?.linkForAnotherDevice,
    signingIn: pendingSignIn !== undefined,
  };
}

async function readSignIn(executablePath: string) {
  // Exits 1 when signed out, still printing the JSON.
  const parsed = AuthStatusSchema.parse(
    JSON.parse(await statusOutput(executablePath, ["auth", "status"])),
  );
  if (!parsed.loggedIn) {
    return { executablePath, kind: "signed-out" as const };
  }
  if (parsed.authMethod !== "claude.ai") {
    return {
      authMethod: parsed.authMethod ?? "unknown",
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
    email: parsed.email ?? undefined,
    executablePath,
    kind: "signed-in" as const,
    plan: parsed.subscriptionType ?? undefined,
  };
}

/**
 * What Claude Code prints for a status command. It exits 1 when signed out,
 * still printing the status, so only a timeout or a failure to start is an
 * error here.
 */
async function statusOutput(executablePath: string, args: string[]) {
  try {
    const { stdout } = await run(executablePath, args, {
      env: cliEnv(),
      timeout: 20_000,
    });
    return stdout;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "number" &&
      "stdout" in error &&
      typeof error.stdout === "string"
    ) {
      return error.stdout;
    }
    throw error;
  }
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
    cancelSignIn(pendingSignIn);
    await mkdir(accountDir(), { recursive: true });
    const signIn = await beginSignIn(executablePath);
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

/** Sign-ins a code was pasted into, which a refused code ends. */
const codePasted = new WeakSet<ClaudeCodeSignIn>();

/** Ends a sign-in on purpose, which no new one replaces. */
function cancelSignIn(signIn: ClaudeCodeSignIn | undefined) {
  if (signIn) {
    codePasted.delete(signIn);
    signIn.cancel();
  }
}

/** The sign-in replacing one a refused code ended, while it starts. */
let replacing: Promise<unknown> | undefined;

/**
 * Start Claude Code's sign-in and wait on it in the background, keeping the
 * status's link current. A pasted code Anthropic refuses ends Claude Code's
 * sign-in, and only the process that made a link can redeem its codes, so
 * that one is replaced at once by a new sign-in with a new link, and the
 * person stays on the code field rather than starting over.
 */
async function beginSignIn(executablePath: string) {
  const signIn = await startClaudeCodeSignIn({
    configDir: accountDir(),
    executablePath,
  });
  pendingSignIn = signIn;
  setStatus({
    ...status,
    signInLink: signIn.linkForAnotherDevice,
    signingIn: true,
  });
  const timer = setTimeout(() => {
    cancelSignIn(signIn);
  }, SIGN_IN_TIMEOUT_MS);
  const finish = () => {
    clearTimeout(timer);
    if (pendingSignIn === signIn) {
      pendingSignIn = undefined;
    }
    void refreshClaudePlanStatus({ force: true }).then((after) => {
      if (after.kind === "signed-in") {
        focusAppWindow();
      }
    });
  };
  void signIn.completion.then(finish, (error: unknown) => {
    log.info("Claude sign-in ended without finishing", error);
    if (codePasted.has(signIn) && pendingSignIn === signIn) {
      clearTimeout(timer);
      replacing = beginSignIn(executablePath).catch((restartError: unknown) => {
        log.warn("Couldn't restart Claude sign-in", restartError);
        finish();
      });
      return;
    }
    finish();
  });
  return signIn;
}

/**
 * Hand the waiting sign-in the code Anthropic's page showed on another
 * device. The code goes straight to Claude Code, which alone can exchange it,
 * and is never logged or kept. Answers why it was refused, if it was.
 */
export async function submitClaudeSignInCode(
  pasted: string,
): Promise<{ error: string | undefined }> {
  const signIn = pendingSignIn;
  if (!signIn) {
    return {
      error: "No sign-in is waiting. Press Continue with Claude again.",
    };
  }
  try {
    codePasted.add(signIn);
    await signIn.submitCode(pasted);
    return { error: undefined };
  } catch (error) {
    if (error instanceof UnusableCodeError) {
      return { error: error.message };
    }
    await replacing;
    return {
      error:
        "Claude didn't accept that code. Copy the sign-in link again for a new one, then paste the code it gives you.",
    };
  }
}

/**
 * Sign our copy of Claude Code out of its Claude account, through Claude
 * Code's own sign-out. The person's own Claude Code, which keeps its sign-in
 * elsewhere, stays signed in.
 */
export async function signOutOfClaude() {
  const executablePath = await installedCopy();
  if (executablePath) {
    await run(executablePath, ["auth", "logout"], {
      env: cliEnv(),
      timeout: 15_000,
    }).catch((error: unknown) => {
      log.warn("Claude Code's sign-out failed", error);
    });
  }
  return refreshClaudePlanStatus({ force: true });
}

/** Give up on a sign-in still waiting on the browser. */
export function cancelClaudeSignIn() {
  cancelSignIn(pendingSignIn);
  pendingSignIn = undefined;
  setStatus({ ...status, signInLink: undefined, signingIn: false });
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
      // `start` takes the window title as its first quoted argument, so the
      // line is handed to cmd exactly as written rather than requoted.
      spawn(
        "cmd.exe",
        ["/d", "/s", "/c", `start "" "${executablePath}" auth login`],
        {
          detached: true,
          env,
          stdio: "ignore",
          windowsHide: false,
          windowsVerbatimArguments: true,
        },
      ).unref();
      return { command, opened: true };
    }
    const terminal = await findLinuxTerminal();
    if (!terminal) {
      return { command, opened: false };
    }
    spawn(terminal, ["-e", executablePath, "auth", "login"], {
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
let installing: Promise<void> | undefined;

export function installClaudeCode(): Promise<void> {
  installing ??= runInstall().finally(() => {
    installing = undefined;
  });
  return installing;
}

/**
 * After an app update moved to a newer Claude Code, install it in the
 * background for anyone who has signed in, rather than waiting for them to
 * find the account disconnected.
 */
export async function keepClaudeCodeCurrent() {
  const signedInBefore = await stat(accountDir()).then(
    () => true,
    () => false,
  );
  if (signedInBefore && wantedRelease() && !(await currentCopy())) {
    await installClaudeCode();
  }
}

async function runInstall() {
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

/** The environment our copy runs in for status checks, as for every request. */
function cliEnv() {
  return claudeCodeEnvironment(accountDir());
}

/** A terminal that takes `-e <command>`, from the ones Linux desktops ship. */
async function findLinuxTerminal() {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const name of [
    "x-terminal-emulator",
    "gnome-terminal",
    "konsole",
    "xterm",
  ]) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name);
      if (
        await access(candidate, constants.X_OK).then(
          () => true,
          () => false,
        )
      ) {
        return candidate;
      }
    }
  }
  return undefined;
}
