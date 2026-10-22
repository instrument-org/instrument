import { checkAccount } from "@/electron-main/lib/account-check";
import { claudeAccountStatusKnown } from "@/electron-main/lib/claude-account";
import { getAllAIProviderConfigs } from "@/electron-main/lib/get-ai-provider-configs";
import {
  getUserDataDir,
  workspaceInAppData,
} from "@/electron-main/lib/get-workspace-folder";
import {
  type NotificationStatus,
  notificationStatus,
} from "@/electron-main/lib/mac-native";
import { getWorkspaceRun } from "@/electron-main/lib/workspace-run";
import {
  readRegistry,
  workspaceHasChats,
} from "@/electron-main/lib/workspaces";
import { workspaceTestedBefore } from "@/electron-main/lib/tested-before";
import { createSetupAccountAnswers } from "@/electron-main/lib/setup-account-answers";
import {
  provideSetupFacts,
  setupStillAsks,
} from "@/electron-main/lib/setup-state";
import { platformApiRpcClient } from "@/electron-main/platform-api/client";
import { getToken, hasToken } from "@/electron-main/platform-api/utils";
import { publisher } from "@/electron-main/rpc/publisher";
import { type ConnectOutcome } from "@/shared/connect-outcome";
import { type SetupFacts } from "@/shared/setup";
import { OUR_PROVIDER_CONFIG } from "@instrument-org/shared";
import { app } from "electron";
import { z } from "zod";

/**
 * Each ChatGPT, Claude and Grok account's last check, for whether setup has
 * a model to run on: an account counts until its check says no plan or
 * signed out.
 */
const accountAnswers = createSetupAccountAnswers({
  check: (input) => {
    const pinned = devAccountCheck();
    return pinned ? Promise.resolve(pinned) : checkAccount(input);
  },
  onChange: () => {
    refreshSetupFacts();
  },
});

/**
 * What setup's launch checks answer in a development build that pins it
 * (`INSTRUMENT_ACCOUNT_CHECK`), so a scenario's stand-in sign-in, whose
 * token any real request refuses, can read as ready or as having no plan.
 */
function devAccountCheck(): ConnectOutcome | undefined {
  const kind = z
    .enum(["no-plan", "out-of-usage", "ready", "signed-out"])
    .safeParse(process.env.INSTRUMENT_ACCOUNT_CHECK);
  return !app.isPackaged && kind.success ? { kind: kind.data } : undefined;
}

/**
 * Hands setup the answer a sign-in's own account check came back with, so
 * setup needn't spend a request of its own on the same account.
 */
export function noteAccountCheckForSetup(input: {
  accountId?: string;
  outcome: ConnectOutcome;
  provider: Parameters<typeof checkAccount>[0]["provider"];
}): void {
  accountAnswers.noteCheck({ ...input, configs: getAllAIProviderConfigs() });
}

/**
 * Checks the accounts already signed in at launch, while setup still asks
 * something, once Claude Code has said whether it is signed in. Never waited
 * on: each answer moves setup when it lands.
 */
function checkAccountsAtLaunch(): void {
  if (!setupStillAsks()) {
    return;
  }
  void claudeAccountStatusKnown()
    .catch(() => undefined)
    .then(() => accountAnswers.checkAll(getAllAIProviderConfigs()));
}

/**
 * The plan the last billing status read found, for the sign-in it was read
 * under. Unknown until a read answers (offline, the API down, a read still
 * out), and then the plan step counts it as no plan: the step is the one
 * place that reads the status again and says what went wrong, and a status
 * that arrives later moves setup past the step.
 */
let planRead: undefined | { hasPlan: boolean; token: string };

/** The sign-in a billing status read last finished for, answered or not. */
let planTriedFor: string | undefined;

/** The notification status last read; `unknown` until the first read answers. */
let notifications: NotificationStatus["status"] = "unknown";

/**
 * The facts as they stand, read from the stores and the disk. Read again
 * only when an input changes (`refreshSetupFacts`), since the window asks
 * on every key press.
 */
function readSetupFacts(): SetupFacts {
  const token = getToken();
  const configs = getAllAIProviderConfigs();
  const account = {
    hasInstrumentAccount: hasToken(),
    hasInstrumentPlan:
      token !== undefined && planRead?.token === token && planRead.hasPlan,
    isCheckingPlan: token !== undefined && planTriedFor !== token,
    hasOwnAI: accountAnswers.hasUsableAI(
      configs.filter(({ type }) => type !== OUR_PROVIDER_CONFIG.type),
    ),
    hasUsableAI: accountAnswers.hasUsableAI(configs),
    notificationsAskable:
      notifications === "not-asked" || notifications === "provisional",
  };
  // Before the folder step places it: no folder, so nothing in one.
  const run = getWorkspaceRun();
  if (run.kind === "unplaced") {
    return {
      ...account,
      folderSettled: false,
      hasChats: false,
      hasWorkspace: false,
      lostFolder: run.lost ?? null,
      testedBefore: false,
    };
  }
  const { workspace } = run;
  return {
    ...account,
    folderSettled:
      workspace.pinned || !workspaceInAppData() || hasPendingMove(workspace.id),
    hasChats: workspaceHasChats(workspace.path),
    hasWorkspace: true,
    lostFolder: null,
    testedBefore: testedBefore(workspace),
  };
}

/**
 * Whether a tester used the workspace, read once per workspace: no chat a
 * process starts changes the answer, and the facts are read again on every
 * sign-in change.
 */
const testedBeforeByPath = new Map<string, boolean>();

function testedBefore(workspace: {
  machineDir: string;
  path: string;
}): boolean {
  let answer = testedBeforeByPath.get(workspace.path);
  if (answer === undefined) {
    answer = workspaceTestedBefore({
      machineDir: workspace.machineDir,
      workspacePath: workspace.path,
    });
    testedBeforeByPath.set(workspace.path, answer);
  }
  return answer;
}

/**
 * A move of the workspace recorded and waiting on the restart that makes
 * it, which settles the folder as surely as the move having been made.
 */
function hasPendingMove(workspaceId: string): boolean {
  return readRegistry(getUserDataDir()).workspaces.some(
    (entry) => entry.id === workspaceId && entry.pendingMove !== undefined,
  );
}

/** Reads the billing status for the sign-in there is now, if any. */
async function refreshPlanFact(): Promise<void> {
  const token = getToken();
  if (!token) {
    planRead = undefined;
    return;
  }
  try {
    const status = await platformApiRpcClient.billing.status.call();
    planRead = {
      hasPlan:
        status.subscription !== undefined || status.trial.state === "active",
      token,
    };
  } catch {
    // Unknown: offline, or the API answered nothing usable.
  } finally {
    planTriedFor = token;
  }
}

async function refreshNotificationFact(): Promise<void> {
  try {
    notifications = (await notificationStatus()).status;
  } catch {
    notifications = "unknown";
  }
}

/**
 * How long the first read waits on the facts main can't read at once
 * before setup answers with what it has. Long enough for Claude Code to
 * answer on a typical launch, so a Claude-only person doesn't read as new;
 * whatever lands later moves setup on through `setup.updated`.
 */
const SETTLE_DEADLINE_MS = 3000;

let settled: Promise<void> | undefined;

let facts: SetupFacts | undefined;

/** Reads the facts again and tells setup's readers. */
export function refreshSetupFacts(): void {
  facts = readSetupFacts();
  publisher.publish("setup.updated", null);
}

/** Reads the slow facts once, publishing as each lands, up to the deadline. */
function settle(): Promise<void> {
  settled ??= (async () => {
    checkAccountsAtLaunch();
    const reads = Promise.all(
      [
        claudeAccountStatusKnown(),
        refreshPlanFact(),
        refreshNotificationFact(),
      ].map((read) => read.then(refreshSetupFacts, refreshSetupFacts)),
    );
    await Promise.race([
      reads,
      new Promise((resolve) => setTimeout(resolve, SETTLE_DEADLINE_MS)),
    ]);
  })();
  return settled;
}

/** Reads the notification status again, after something may have changed it. */
export async function refreshNotificationsForSetup(): Promise<void> {
  await refreshNotificationFact();
  refreshSetupFacts();
}

/**
 * Hands setup its facts, and from then on reads setup again whenever one of
 * them changes. A move of the workspace says so itself (`workspaces.move`).
 */
export function startSetupFacts(): void {
  for (const event of [
    "chatgpt-account.updated",
    "claude-account.updated",
    "grok-account.updated",
    "provider-config.updated",
  ] as const) {
    publisher.subscribe(event, refreshSetupFacts);
  }
  publisher.subscribe("session.apiBearerToken.updated", () => {
    refreshSetupFacts();
    void refreshPlanFact().then(refreshSetupFacts);
  });
  provideSetupFacts({ read: () => (facts ??= readSetupFacts()), settle });
}
