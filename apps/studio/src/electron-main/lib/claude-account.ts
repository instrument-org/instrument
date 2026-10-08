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
  fetchClaudeAccountUsage,
  startClaudeCodeSignIn,
  UnusableCodeError,
} from "@instrument-org/ai-gateway";
import {
  AI_GATEWAY_API_KEY_NOT_NEEDED,
  AIProviderConfigIdSchema,
  CLAUDE_ACCOUNT_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app, shell } from "electron";
import { z } from "zod";

const log = createScopedLogger("claude-account");
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
type ClaudeCodeInstall =
  | { failed: string; state: "failed" }
  | { received: number; state: "downloading"; total: number };

export type ClaudeAccountStatus = {
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

let status: ClaudeAccountStatus = {
  canInstall: false,
  install: undefined,
  kind: "not-installed",
  signInLink: undefined,
  signingIn: false,
};
let install: ClaudeCodeInstall | undefined;
let pendingSignIn: ClaudeCodeSignIn | undefined;
let lastRefresh = 0;
let refreshing: Promise<ClaudeAccountStatus> | undefined;

/**
 * Where our copy of Claude Code keeps its Claude sign-in, as its config
 * folder. Apart from the person's own `~/.claude`, so signing in here never
 * changes which account their own Claude Code uses, and theirs never signs
 * this one out.
 */
function accountDir() {
  return path.join(app.getPath("userData"), "claude-account");
}

export function claudeAccountStatus() {
  return status;
}

/**
 * The Claude account's provider config while our copy of Claude Code is
 * signed in to one. It holds no credential: Claude Code keeps the sign-in,
 * and we only drive it.
 */
export function claudeAccountProviderConfigs(): AIGatewayProviderConfig.Type[] {
  if (status.kind !== "signed-in") {
    return [];
  }
  return [
    {
      ...CLAUDE_ACCOUNT_PROVIDER_CONFIG,
      apiKey: AI_GATEWAY_API_KEY_NOT_NEEDED,
      configDir: accountDir(),
      executablePath: status.executablePath,
      id: AIProviderConfigIdSchema.parse(CLAUDE_ACCOUNT_PROVIDER_CONFIG.id),
    },
  ];
}

/** Ask our copy of Claude Code who is signed in, unless that was just done. */
export function refreshClaudeAccountStatus({
  force = false,
} = {}): Promise<ClaudeAccountStatus> {
  if (refreshing) {
    // A forced read follows something that just changed, which a read
    // already under way may have started before.
    return force
      ? refreshing.then(() => refreshClaudeAccountStatus({ force: true }))
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

function setStatus(next: ClaudeAccountStatus) {
  const changed = JSON.stringify(next) !== JSON.stringify(status);
  status = next;
  if (changed) {
    publisher.publish("claude-account.updated", null);
    publisher.publish("provider-config.updated", null);
  }
}

/** How much of the subscription is used, or nothing while none is signed in. */
export async function claudeAccountUsage() {
  if (status.kind !== "signed-in") {
    return null;
  }
  return fetchClaudeAccountUsage({
    configDir: accountDir(),
    executablePath: status.executablePath,
  });
}

async function readStatus(): Promise<ClaudeAccountStatus> {
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
 * notices it finish and brings the app back to the front. Answers why the
 * sign-in could not start, if it could not.
 */
export async function openClaudeSignIn(): Promise<{
  error: string | undefined;
}> {
  let current = await refreshClaudeAccountStatus({ force: true });
  if (current.kind === "not-installed" && current.canInstall) {
    await installClaudeCode();
    current = status;
  }
  if (current.kind === "not-installed") {
    // The card already says why an install failed.
    return {
      error: current.canInstall
        ? undefined
        : "Claude Code isn't available for this computer.",
    };
  }
  const { executablePath } = current;
  try {
    cancelSignIn(pendingSignIn);
    await mkdir(accountDir(), { recursive: true });
    const signIn = await beginSignIn(executablePath);
    await shell.openExternal(signIn.url);
    return { error: undefined };
  } catch (error) {
    log.warn("Couldn't start Claude sign-in", error);
    return {
      error:
        "Claude Code couldn't start its sign-in. Try again, or restart Instrument if it keeps happening.",
    };
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
    void refreshClaudeAccountStatus({ force: true }).then((after) => {
      if (after.kind === "signed-in") {
        focusAppWindow();
      }
    });
  };
  void signIn.completion.then(() => {
    // Forward at once, while the status is still being read back from
    // Claude Code: that read takes seconds, and the person who just pressed
    // Authorize is looking at the browser until the app comes back.
    focusAppWindow();
    finish();
  }, (error: unknown) => {
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
  return refreshClaudeAccountStatus({ force: true });
}

/** Give up on a sign-in still waiting on the browser. */
export function cancelClaudeSignIn() {
  cancelSignIn(pendingSignIn);
  pendingSignIn = undefined;
  setStatus({ ...status, signInLink: undefined, signingIn: false });
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
    publisher.publish("claude-account.updated", null);
  };
  publish({ received: 0, state: "downloading", total: 0 });
  const installed = await downloadClaudeCode(({ received, total }) => {
    publish({ received, state: "downloading", total });
  });
  if (installed.ok) {
    publish(undefined);
  } else {
    log.warn("Couldn't install Claude Code", installed.error);
    publish({ failed: installed.error.message, state: "failed" });
  }
  await refreshClaudeAccountStatus({ force: true });
}

/** The environment our copy runs in for status checks, as for every request. */
function cliEnv() {
  return claudeCodeEnvironment(accountDir());
}
