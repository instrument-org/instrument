import {
  type AIGatewayModel,
  type AIGatewayModelURI,
  fetchModel,
} from "@instrument-org/ai-gateway";

import { completeModelURI, ownModelParams } from "../../chat/models";
import { getWorkspaceConfig } from "../../workspace-config";
import { TASK_COMMAND } from "../task-command";
import { type TaskCommandContext } from "./context";

/**
 * The model a command names, as `author/id` the way `task models` prints it
 * or as a whole URI. A bare name is completed on the conversation's own
 * provider, the only one a task may run on.
 */
export async function resolveModel(
  rawName: string,
  context: TaskCommandContext,
) {
  let modelURI: AIGatewayModelURI.Type;
  try {
    modelURI = completeModelURI(rawName, await requireOwnModelParams(context));
  } catch (error) {
    throw new Error(
      `"${rawName}" is not a model: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const workspaceConfig = getWorkspaceConfig();
  const result = await fetchModel({
    captureException: workspaceConfig.captureException,
    configs: workspaceConfig.getAIProviderConfigs(),
    modelCache: workspaceConfig.modelCache,
    modelURI,
  });
  if (!result.ok) {
    throw new Error(`model ${rawName}: ${result.error.message}`);
  }
  return { model: result.value, modelURI };
}

/**
 * The provider this conversation runs on, as the parameters its model URIs
 * carry: the only provider it may put a task on.
 */
export async function requireOwnModelParams(context: TaskCommandContext) {
  const params = await ownModelParams(context.chatId);
  if (params === undefined) {
    throw new Error(
      "this conversation has not chosen a model yet, so it has no provider to run a task on.",
    );
  }
  return params;
}

/**
 * Refuses a model from any other provider. Another provider is another account
 * and another bill, spent without anything here reporting the difference until
 * it had been. The user is still free to move a task to any model themselves.
 */
export async function requireOwnProvider(
  model: AIGatewayModel.Type,
  context: TaskCommandContext,
) {
  const { providerConfigId } = await requireOwnModelParams(context);
  if (model.params.providerConfigId !== providerConfigId) {
    throw new Error(
      `${model.uri} is not on this conversation's provider, and a task runs on no other. \`${TASK_COMMAND.name} models\` lists every model you can hand one.`,
    );
  }
}
