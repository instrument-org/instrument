import { diskModelCache } from "@/electron-main/stores/machine/model-cache";
import { getDefaultModelURI } from "@/electron-main/stores/workspace/preferences";
import {
  type ConnectOutcome,
  type ConnectProvider,
} from "@/shared/connect-outcome";
import {
  type AIGatewayModel,
  chatGPTAccountDefaultModel,
  fetchModelResultsForProviders,
} from "@instrument-org/ai-gateway";
import {
  type AccountCheck,
  checkAccountWithRequest,
} from "@instrument-org/workspace/electron";

import { captureFor } from "./capture-server-exception";
import {
  chatGPTAccountPlan,
  chatGPTAccountsStatus,
  refreshExpiredTokens,
} from "./chatgpt-account";
import {
  claudeAccountUsage,
  refreshClaudeAccountStatus,
} from "./claude-account";
import { getAIProviderConfigs } from "./get-ai-provider-configs";
import { checkGrokSubscriptions, grokAccountsStatus } from "./grok-account";
import {
  setChatGPTAccountDefaultModel,
  setClaudeAccountDefaultModel,
  setGrokAccountDefaultModel,
} from "./set-default-model";

/** The ways in whose plan the app checks itself; Instrument's comes from billing. */
export type CheckedProvider = Exclude<ConnectProvider, "instrument">;

/**
 * How long a check may take before it answers `timed-out`. Claude's starts
 * Claude Code more than once (status, usage, the request), which alone takes
 * several seconds.
 */
const ACCOUNT_CHECK_DEADLINE_MS = 30_000;

const workspaceConfig = {
  captureException: captureFor("ai-gateway"),
  getAIProviderConfigs,
  modelCache: diskModelCache,
};

/**
 * Whether the account signed in to `provider` can run a turn now, in the
 * words every surface draws from. ChatGPT and Claude spend one short request
 * on the plan (Claude reads its usage windows first, so a spent one answers
 * without it); Grok asks xAI which subscription the account has. `accountId`
 * picks one of several ChatGPT or Grok accounts, the first signed in when left
 * out.
 *
 * Never rejects: `signal` ending it answers `canceled`, the deadline
 * `timed-out`, and anything else unnamed `failed`. The request itself is
 * ended either way, not only its answer dropped.
 */
export async function checkAccount({
  accountId,
  deadlineMs = ACCOUNT_CHECK_DEADLINE_MS,
  provider,
  signal,
}: {
  accountId?: string;
  deadlineMs?: number;
  provider: CheckedProvider;
  signal?: AbortSignal;
}): Promise<ConnectOutcome> {
  const deadline = AbortSignal.timeout(deadlineMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    return await untilAborted(
      CHECKS[provider]({ accountId, signal: combined }),
      combined,
    );
  } catch (error) {
    if (signal?.aborted) {
      return { kind: "canceled" };
    }
    if (deadline.aborted) {
      return { kind: "timed-out" };
    }
    return {
      kind: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Checks the account, then makes its model the default when it is worth
 * running on: always once it is ready (as each provider's own rule says),
 * and only when nothing is chosen yet for an answer that may still turn out
 * fine (out of usage, timed out, failed). An account with no usable plan, or
 * one signed out, never becomes the default.
 */
export async function connectAccount(input: {
  accountId?: string;
  provider: CheckedProvider;
  signal?: AbortSignal;
}): Promise<{ modelName?: string; outcome: ConnectOutcome }> {
  const outcome = await checkAccount(input);
  const worthDefault =
    outcome.kind === "ready" ||
    ((outcome.kind === "out-of-usage" ||
      outcome.kind === "timed-out" ||
      outcome.kind === "failed") &&
      getDefaultModelURI() === undefined);
  if (!worthDefault) {
    return { outcome };
  }
  const modelName = await chooseDefaultModel(input).catch(() => undefined);
  return { modelName, outcome };
}

function chooseDefaultModel({
  accountId,
  provider,
}: {
  accountId?: string;
  provider: CheckedProvider;
}) {
  switch (provider) {
    case "chatgpt": {
      const id = accountId ?? firstChatGPTAccount()?.id;
      return id
        ? setChatGPTAccountDefaultModel({ accountId: id })
        : Promise.resolve(undefined);
    }
    case "claude": {
      return setClaudeAccountDefaultModel();
    }
    case "grok": {
      const id = accountId ?? firstGrokAccount()?.id;
      return id
        ? setGrokAccountDefaultModel({ accountId: id })
        : Promise.resolve(undefined);
    }
  }
}

type Check = (input: {
  accountId?: string;
  signal: AbortSignal;
}) => Promise<ConnectOutcome>;

const CHECKS: Record<CheckedProvider, Check> = {
  chatgpt: checkChatGPT,
  claude: checkClaude,
  grok: checkGrok,
};

/**
 * A session that ended, or a sign-in that left plan access out (the person
 * unchecked it on OpenAI's page, so `declined`), answers without a request;
 * otherwise one short request on the plan's everyday model settles it, since
 * only a request says whether the plan is eligible and has usage left.
 */
async function checkChatGPT({ accountId, signal }: Parameters<Check>[0]) {
  const id = accountId ?? firstChatGPTAccount()?.id;
  if (!id) {
    return { kind: "signed-out" } as const;
  }
  await untilAborted(refreshExpiredTokens(id), signal);
  const account = chatGPTAccountsStatus().accounts.find(
    (candidate) => candidate.id === id,
  );
  if (!account || account.state === "signed-out") {
    return { kind: "signed-out" } as const;
  }
  if (account.state === "plan-disabled") {
    return { kind: "declined" } as const;
  }
  return withPlan(
    await checkWithModel(id, signal, chatGPTAccountDefaultModel),
    chatGPTAccountPlan(id),
  );
}

/**
 * Claude Code says without a request whether it is signed in to a plan and
 * how much of each usage window is spent; a full window answers
 * `out-of-usage` until the last full one resets. Otherwise one short request
 * settles it.
 */
async function checkClaude({ signal }: Parameters<Check>[0]) {
  const status = await untilAborted(
    refreshClaudeAccountStatus({ force: true }),
    signal,
  );
  if (status.kind === "not-installed" || status.kind === "signed-out") {
    return { kind: "signed-out" } as const;
  }
  if (status.kind === "not-a-plan") {
    return { kind: "no-plan" } as const;
  }
  // Usage is a shortcut; the request below answers without it.
  const usage = await untilAborted(claudeAccountUsage(), signal).catch(() => {
    signal.throwIfAborted();
    return null;
  });
  const spent = usage?.windows.filter((window) => window.used >= 100) ?? [];
  if (spent.length > 0) {
    // Usable again only once every full window resets.
    const resetsAt = spent
      .map((window) => window.resetsAt)
      .filter((at) => at !== undefined)
      .toSorted()
      .at(-1);
    return { kind: "out-of-usage", ...(resetsAt && { resetsAt }) } as const;
  }
  const config = getAIProviderConfigs().find(
    (candidate) => candidate.type === "claude-account",
  );
  if (!config) {
    return { kind: "signed-out" } as const;
  }
  return withPlan(
    await checkWithModel(
      config.id,
      signal,
      (models) =>
        models.find((model) => model.tags.includes("default")) ?? models[0],
    ),
    status.plan,
  );
}

/**
 * xAI names the account's subscription when asked, so Grok answers without
 * spending a request: no paid Grok plan is `no-plan`. A failed ask
 * leaves the last answer, read here.
 */
async function checkGrok({ accountId, signal }: Parameters<Check>[0]) {
  const id = accountId ?? firstGrokAccount()?.id;
  if (!id) {
    return { kind: "signed-out" } as const;
  }
  await untilAborted(checkGrokSubscriptions({ accountId: id }), signal);
  const account = grokAccountsStatus().accounts.find(
    (candidate) => candidate.id === id,
  );
  return grokOutcome(account);
}

/** What a Grok account's state says, in the shared words. */
function grokOutcome(
  account:
    | ReturnType<typeof grokAccountsStatus>["accounts"][number]
    | undefined,
): ConnectOutcome {
  switch (account?.state) {
    case "no-subscription": {
      return { kind: "no-plan" };
    }
    case "signed-in": {
      return { kind: "ready", ...(account.plan && { plan: account.plan }) };
    }
    default: {
      return { kind: "signed-out" };
    }
  }
}

async function checkWithModel(
  configId: string,
  signal: AbortSignal,
  choose: (models: AIGatewayModel.Type[]) => AIGatewayModel.Type | undefined,
): Promise<ConnectOutcome> {
  const config = getAIProviderConfigs().find(
    (candidate) => candidate.id === configId,
  );
  if (!config) {
    return { kind: "signed-out" };
  }
  const [models] = await untilAborted(
    fetchModelResultsForProviders([config], {
      captureException: workspaceConfig.captureException,
      modelCache: diskModelCache,
    }),
    signal,
  );
  if (!models?.ok) {
    return {
      kind: "failed",
      message: models?.error.message ?? "Couldn't read the account's models",
    };
  }
  const model = choose(models.value);
  if (!model) {
    // A plan that lists no models has none it may use here.
    return { kind: "no-plan" };
  }
  return fromAccountCheck(
    await checkAccountWithRequest({
      modelURI: model.uri,
      signal,
      workspaceConfig,
    }),
  );
}

/** The workspace's answer about a plan account, in the shared words. */
function fromAccountCheck(check: AccountCheck): ConnectOutcome {
  switch (check.state) {
    case "not-eligible": {
      return { kind: "no-plan", ...(check.plan && { plan: check.plan }) };
    }
    case "out-of-usage": {
      return {
        kind: "out-of-usage",
        ...(check.resetsAt && { resetsAt: check.resetsAt }),
      };
    }
    case "ready": {
      return { kind: "ready", ...(check.plan && { plan: check.plan }) };
    }
    case "signed-out": {
      return { kind: "signed-out" };
    }
    case "unknown": {
      return { kind: "failed", message: check.message };
    }
  }
}

function withPlan(outcome: ConnectOutcome, plan: string | undefined) {
  return plan && (outcome.kind === "ready" || outcome.kind === "no-plan")
    ? { ...outcome, plan }
    : outcome;
}

function firstChatGPTAccount() {
  return chatGPTAccountsStatus().accounts.find(
    (account) => account.state !== "signed-out",
  );
}

function firstGrokAccount() {
  return grokAccountsStatus().accounts.find(
    (account) => account.state !== "signed-out",
  );
}

/**
 * `promise`, or the signal's reason once it ends first: for the steps that
 * take no signal of their own (Claude Code's status and usage, the model
 * list), whose answer is then dropped.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("The account check was ended", { cause: signal.reason });
}
