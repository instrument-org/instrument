import {
  currentCopy,
  downloadClaudeCode,
  installedCopy,
  wantedRelease,
} from "@/electron-main/lib/claude-code-download";
import { claudeSignInMachine } from "@/electron-main/lib/claude-sign-in";
import { createScopedLogger } from "@/electron-main/lib/electron-logger";
import { noteSignedOut } from "@/electron-main/lib/notices";
import { workspaceMachineDir } from "@/electron-main/lib/get-workspace-folder";
import { publisher } from "@/electron-main/rpc/publisher";
import { focusAppWindow } from "@/electron-main/windows/foreground";
import {
  type AIGatewayProviderConfig,
  claudeCodeEnvironment,
  fetchClaudeAccountUsage,
  startClaudeCodeSignIn,
  UnusableCodeError,
} from "@instrument-org/ai-gateway";
import {
  AI_GATEWAY_API_KEY_NOT_NEEDED,
  AIProviderConfigIdSchema,
  CLAUDE_ACCOUNT_PROVIDER_CONFIG,
  WORKSPACE_MACHINE_ENTRIES,
} from "@instrument-org/shared";
import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { shell } from "electron";
import { createActor, fromPromise, waitFor } from "xstate";
import { z } from "zod";

const log = createScopedLogger("claude-account");
const run = promisify(execFile);

/** Re-checked at most this often, however often a window takes focus. */
const REFRESH_INTERVAL_MS = 5000;

/** How long a refused code waits for the sign-in replacing it to start. */
const REPLACE_WAIT_MS = 30_000;

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

/** What our copy of Claude Code said at the last status read. */
type ClaudeCodeReading = {
  /** Whether this platform has a Claude Code build we can install. */
  canInstall: boolean;
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

export type ClaudeAccountStatus = ClaudeCodeReading & {
  install: ClaudeCodeInstall | undefined;
  /**
   * Anthropic's sign-in page for another device, while a sign-in waits: it
   * ends on a code the person pastes back here.
   */
  signInLink: string | undefined;
  /**
   * Claude Code stored a sign-in, and the account is being read back from it.
   * Still `signingIn`, so the app holds rather than showing the account as it
   * was before.
   */
  finishing: boolean;
  /** A sign-in is open in the browser, waiting on the person, or finishing. */
  signingIn: boolean;
};

let reading: ClaudeCodeReading = { canInstall: false, kind: "not-installed" };
let install: ClaudeCodeInstall | undefined;
let lastRefresh = 0;
let refreshing: Promise<ClaudeAccountStatus> | undefined;
let finishing = false;

const signIn = createActor(
  claudeSignInMachine.provide({
    actions: {
      cancelSignIn: (_, { signIn: running }) => {
        running?.cancel();
      },
      ended: () => {
        void refreshClaudeAccountStatus({ force: true }).then((after) => {
          finishing = false;
          announce();
          if (after.kind === "signed-in") {
            focusAppWindow();
          }
        });
      },
      // Forward at once, while the status is still being read back from
      // Claude Code: that read takes seconds, and the person who just pressed
      // Authorize is looking at the browser until the app comes back.
      landed: () => {
        finishing = true;
        focusAppWindow();
      },
    },
    actors: {
      completion: fromPromise(({ input }) =>
        input.signIn.completion.catch((error: unknown) => {
          log.info("Claude sign-in ended without finishing", error);
          throw error;
        }),
      ),
      restart: fromPromise(async ({ input, signal }) => {
        const replacement = await startClaudeCodeSignIn({
          configDir: accountDir(),
          executablePath: input.executablePath,
        }).catch((error: unknown) => {
          log.warn("Couldn't restart Claude sign-in", error);
          throw error;
        });
        // Canceled while it started: nothing is waiting on it.
        if (signal.aborted) {
          replacement.cancel();
        }
        return replacement;
      }),
    },
  }),
);
signIn.start();
/** The status as last announced, to announce only a change. */
let announced = JSON.stringify(claudeAccountStatus());
signIn.subscribe({
  error: (error: unknown) => {
    log.warn("Claude sign-in stopped", error);
  },
  next: () => {
    announce();
  },
});

/**
 * Where our copy of Claude Code keeps its Claude sign-in, as its config
 * folder: the workspace's folder on this computer, beside its other keys.
 * Apart from the person's own `~/.claude`, so signing in here never changes
 * which account their own Claude Code uses, and theirs never signs this one
 * out.
 */
function accountDir() {
  return path.join(
    workspaceMachineDir(),
    WORKSPACE_MACHINE_ENTRIES.claudeAccount,
  );
}

/** The CLI's last reading, with the install and sign-in under way now. */
export function claudeAccountStatus(): ClaudeAccountStatus {
  const snapshot = signIn.getSnapshot();
  return {
    ...reading,
    finishing,
    install,
    signInLink: snapshot.context.signIn?.linkForAnotherDevice,
    signingIn: finishing || !snapshot.matches("idle"),
  };
}

/**
 * The Claude account's provider config while our copy of Claude Code is
 * signed in to one. It holds no credential: Claude Code keeps the sign-in,
 * and we only drive it.
 */
export function claudeAccountProviderConfigs(): AIGatewayProviderConfig.Type[] {
  if (reading.kind !== "signed-in") {
    return [];
  }
  return [
    {
      ...CLAUDE_ACCOUNT_PROVIDER_CONFIG,
      apiKey: AI_GATEWAY_API_KEY_NOT_NEEDED,
      configDir: accountDir(),
      executablePath: reading.executablePath,
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
    return Promise.resolve(claudeAccountStatus());
  }
  refreshing = readStatus()
    .then((next) => {
      // Only from a reading Claude Code gave, and a sign-out the person asked
      // for reads as signed out without `expired`.
      noteSignedOut(
        CLAUDE_ACCOUNT_PROVIDER_CONFIG.type,
        next.kind === "signed-out" && next.expired
          ? [{ id: CLAUDE_ACCOUNT_PROVIDER_CONFIG.id }]
          : [],
      );
      return next;
    })
    .catch((error: unknown) => {
      // A status Claude Code could not give (it timed out, or would not
      // start) says nothing about the sign-in, so the last one stands.
      log.warn("Couldn't read Claude Code's status", error);
      return reading;
    })
    .then((next) => {
      lastRefresh = Date.now();
      reading = next;
      announce();
      return claudeAccountStatus();
    })
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
}

/**
 * Settles once the first status read has, whatever it found. Until then the
 * Claude account has no provider config, which a model list would read as
 * signed out; after it, the status kept is current enough to list from.
 */
export function claudeAccountStatusKnown(): Promise<unknown> {
  return lastRefresh > 0 ? Promise.resolve() : refreshClaudeAccountStatus();
}

/** Tell the windows and the model list the status changed, if it did. */
function announce() {
  const next = JSON.stringify(claudeAccountStatus());
  if (next !== announced) {
    announced = next;
    publisher.publish("claude-account.updated", null);
    publisher.publish("provider-config.updated", null);
  }
}

/** How much of the subscription is used, or nothing while none is signed in. */
export async function claudeAccountUsage() {
  if (reading.kind !== "signed-in") {
    return null;
  }
  return fetchClaudeAccountUsage({
    configDir: accountDir(),
    executablePath: reading.executablePath,
  });
}

async function readStatus(): Promise<ClaudeCodeReading> {
  const executablePath = await installedCopy();
  return {
    ...(executablePath
      ? await readSignIn(executablePath)
      : { kind: "not-installed" as const }),
    canInstall: wantedRelease() !== undefined,
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
async function openClaudeSignIn(): Promise<{
  error: string | undefined;
}> {
  let current = await refreshClaudeAccountStatus({ force: true });
  if (current.kind === "not-installed" && current.canInstall) {
    await installClaudeCode();
    current = claudeAccountStatus();
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
    signIn.send({ type: "cancel" });
    await mkdir(accountDir(), { recursive: true });
    const started = await startClaudeCodeSignIn({
      configDir: accountDir(),
      executablePath,
    });
    signIn.send({ executablePath, signIn: started, type: "started" });
    await shell.openExternal(started.url);
    return { error: undefined };
  } catch (error) {
    log.warn("Couldn't start Claude sign-in", error);
    return {
      error:
        "Claude Code couldn't start its sign-in. Try again, or restart Instrument if it keeps happening.",
    };
  }
}

/**
 * Sign in to Claude and wait for it to end: at once when Claude Code is
 * signed in already, otherwise once the browser sign-in finishes, is
 * canceled or runs out, with the account read back from Claude Code. Answers
 * why the sign-in could not start, if it could not.
 */
export async function signInToClaude(): Promise<{
  error: string | undefined;
  status: ClaudeAccountStatus;
}> {
  const before = await refreshClaudeAccountStatus({ force: true });
  if (before.kind === "signed-in") {
    return { error: undefined, status: before };
  }
  const { error } = await openClaudeSignIn();
  const status = claudeAccountStatus();
  if (error !== undefined || status.kind === "not-installed") {
    return {
      error:
        error ??
        (status.install?.state === "failed"
          ? `Claude Code didn't install: ${status.install.failed}`
          : "Claude Code didn't install."),
      status,
    };
  }
  await waitFor(signIn, (snapshot) => snapshot.matches("idle"), {
    timeout: Infinity,
  });
  return {
    error: undefined,
    status: await refreshClaudeAccountStatus({ force: true }),
  };
}

/**
 * Hand the waiting sign-in the code Anthropic's page showed on another
 * device. The code goes straight to Claude Code, which alone can exchange it,
 * and is never logged or kept. Answers why it was refused, if it was.
 */
export async function submitClaudeSignInCode(
  pasted: string,
): Promise<{ error: string | undefined }> {
  const snapshot = signIn.getSnapshot();
  const waiting = snapshot.matches("waiting")
    ? snapshot.context.signIn
    : undefined;
  if (!waiting) {
    return {
      error: "No sign-in is waiting. Press Continue with Claude again.",
    };
  }
  try {
    signIn.send({ type: "codePasted" });
    await waiting.submitCode(pasted);
    return { error: undefined };
  } catch (error) {
    if (error instanceof UnusableCodeError) {
      return { error: error.message };
    }
    // A refused code ends the process; answer once its replacement, and the
    // new link, are in.
    await waitFor(
      signIn,
      (next) => !next.matches("replacing") && next.context.signIn !== waiting,
      { timeout: REPLACE_WAIT_MS },
    ).catch(() => undefined);
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
  signIn.send({ type: "cancel" });
}

/**
 * Install our own copy of the Claude Code release this build drives, then
 * look again. Progress and failure ride on the status.
 */
let installing: Promise<void> | undefined;

function installClaudeCode(): Promise<void> {
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
    // Progress is the windows' alone; the model list has nothing new in it.
    announced = JSON.stringify(claudeAccountStatus());
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
