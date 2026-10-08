import { diskModelCache } from "@/electron-main/stores/machine/model-cache";
import {
  type AIGatewayModel,
  type AIGatewayProviderConfig,
  chatGPTAccountDefaultModel,
  fetchModelResultsForProviders,
} from "@instrument-org/ai-gateway";
import {
  type AccountCheck,
  checkAccountWithRequest,
  type WorkspaceConfig,
} from "@instrument-org/workspace/electron";

import { captureServerException } from "./capture-server-exception";
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

type CheckConfig = Pick<
  WorkspaceConfig,
  "captureException" | "getAIProviderConfigs" | "modelCache"
>;

/**
 * Whether the ChatGPT account `accountId` can run a turn now. A session that
 * ended or a sign-in that left out the plan answers without a request;
 * otherwise one short request on the plan's everyday model settles it, since
 * only a request says whether the plan is eligible and has usage left.
 */
export async function checkChatGPTAccount(
  accountId: string,
  workspaceConfig: CheckConfig,
): Promise<AccountCheck> {
  await refreshExpiredTokens(accountId);
  const account = chatGPTAccountsStatus().accounts.find(
    (candidate) => candidate.id === accountId,
  );
  const plan = chatGPTAccountPlan(accountId);
  if (!account || account.state === "signed-out") {
    return { state: "signed-out" };
  }
  if (account.state === "plan-disabled") {
    return { plan, state: "not-eligible" };
  }
  const result = await checkWithModel(
    accountId,
    workspaceConfig,
    chatGPTAccountDefaultModel,
  );
  return result.state === "ready" || result.state === "not-eligible"
    ? { ...result, plan }
    : result;
}

/**
 * Whether the Claude account can run a turn now. Claude Code says without a
 * request whether it is signed in to a plan and how much of each usage
 * window is spent; a full window answers `out-of-usage` until it resets.
 * Otherwise one short request settles it.
 */
export async function checkClaudeAccount(
  workspaceConfig: CheckConfig,
): Promise<AccountCheck> {
  const status = await refreshClaudeAccountStatus({ force: true });
  if (status.kind === "not-installed" || status.kind === "signed-out") {
    return { state: "signed-out" };
  }
  if (status.kind === "not-a-plan") {
    return { state: "not-eligible" };
  }
  try {
    const usage = await claudeAccountUsage();
    const spent = usage?.windows.filter((window) => window.used >= 100) ?? [];
    if (spent.length > 0) {
      // The account is usable again only once every full window resets.
      const resetsAt = spent
        .map((window) => window.resetsAt)
        .filter((at) => at !== undefined)
        .sort()
        .at(-1);
      return { resetsAt, state: "out-of-usage" };
    }
  } catch {
    // Usage is a shortcut; the request below answers without it.
  }
  const config = getAIProviderConfigs().find(
    (candidate) => candidate.type === "claude-account",
  );
  if (!config) {
    return { state: "signed-out" };
  }
  const result = await checkWithModel(
    config.id,
    workspaceConfig,
    (models) =>
      models.find((model) => model.tags.includes("default")) ?? models[0],
  );
  return result.state === "ready" || result.state === "not-eligible"
    ? { ...result, plan: status.plan }
    : result;
}

async function checkWithModel(
  configId: string,
  workspaceConfig: CheckConfig,
  choose: (models: AIGatewayModel.Type[]) => AIGatewayModel.Type | undefined,
): Promise<AccountCheck> {
  const config: AIGatewayProviderConfig.Type | undefined =
    getAIProviderConfigs().find((candidate) => candidate.id === configId);
  if (!config) {
    return { state: "signed-out" };
  }
  const [models] = await fetchModelResultsForProviders([config], {
    captureException: captureServerException,
    modelCache: diskModelCache,
  });
  if (!models?.ok) {
    return {
      message: models?.error.message ?? "Couldn't read the account's models",
      state: "unknown",
    };
  }
  const model = choose(models.value);
  if (!model) {
    // A plan that lists no models has none it may use here.
    return { state: "not-eligible" };
  }
  return checkAccountWithRequest({ modelURI: model.uri, workspaceConfig });
}
