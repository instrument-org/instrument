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
import {
  getResolvedWorkspace,
  readRegistry,
  workspaceHasChats,
} from "@/electron-main/lib/workspaces";
import { provideSetupFacts } from "@/electron-main/lib/setup-state";
import { platformApiRpcClient } from "@/electron-main/platform-api/client";
import { getToken, hasToken } from "@/electron-main/platform-api/utils";
import { publisher } from "@/electron-main/rpc/publisher";
import { type SetupFacts } from "@/shared/setup";

/**
 * Whether a way to run models is connected: a key, the Instrument sign-in,
 * or a ChatGPT, Claude or Grok account. Connected is all it checks; the
 * account check (ready or out of usage, not "no paid plan") replaces this.
 */
function hasConnectedAI(): boolean {
  return getAllAIProviderConfigs().length > 0;
}

/**
 * The plan the last billing status read found, for the sign-in it was read
 * under. Unknown until a read answers (offline, the API down, a read still
 * out), and then the plan step counts it as no plan: the step is the one
 * place that reads the status again and says what went wrong, and a status
 * that arrives later moves setup past the step.
 */
let planRead: undefined | { hasPlan: boolean; token: string };

/** The notification status last read; `unknown` until the first read answers. */
let notifications: NotificationStatus["status"] = "unknown";

/**
 * The facts as they stand, read from the stores and the disk. Read again
 * only when an input changes (`refreshSetupFacts`), since the window asks
 * on every key press.
 */
function readSetupFacts(): SetupFacts {
  const workspace = getResolvedWorkspace();
  const token = getToken();
  return {
    folderSettled:
      workspace.pinned || !workspaceInAppData() || hasPendingMove(workspace.id),
    hasInstrumentAccount: hasToken(),
    hasInstrumentPlan:
      token !== undefined && planRead?.token === token && planRead.hasPlan,
    hasUsableAI: hasConnectedAI(),
    notificationsAskable:
      notifications === "not-asked" || notifications === "provisional",
    usedBefore: workspaceHasChats(workspace.path),
  };
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
