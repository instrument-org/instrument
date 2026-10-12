import { fetchModel } from "@instrument-org/ai-gateway";

import { chatModelURI } from "../../chat-settings";
import { getWorkspaceConfig } from "../../workspace-config";
import { type TaskCommandContext } from "./context";

/**
 * The model this conversation's picker is on, which is the one every task it
 * starts or messages runs on. Read at each command rather than kept with the
 * task, so a task the conversation reuses after the user switches models moves
 * with the picker at the next message it is sent.
 */
export async function chatModel(command: string, context: TaskCommandContext) {
  const modelURI = await chatModelURI(context.chatId);
  if (!modelURI) {
    throw new Error(
      `${command}: this conversation has not chosen a model yet, so there is none to run a task on.`,
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
    throw new Error(`${command}: model ${modelURI}: ${result.error.message}`);
  }
  return { model: result.value, modelURI };
}
