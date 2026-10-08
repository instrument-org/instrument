import {
  AIGatewayModelURI,
  fetchAISDKModel,
  fetchModel,
  providerOptionsForModel,
} from "@instrument-org/ai-gateway";
import { generateText } from "ai";
import { z } from "zod";

import { TASK_NAME_MAX_OUTPUT_TOKENS } from "../../lib/llm-token-limits";
import {
  parseSetupTasks,
  SETUP_TASKS_INSTRUCTIONS,
  SetupTasksSchema,
  setupTasksMessage,
} from "../../lib/setup-tasks";
import { getWorkspaceServerURL } from "../../logic/server/url";
import { base, toORPCError } from "../base";

/**
 * A few tasks written for a new person from what fills their week, by the
 * model their way in gives them: the one short call setup spends. A model
 * that answers in any other shape is a parse error, which setup meets with
 * the tasks it wrote ahead of time.
 */
const writeTasks = base
  .input(
    z.object({
      modelURI: AIGatewayModelURI.Schema,
      work: z.array(z.string()).max(20),
      workOther: z.string().max(500),
    }),
  )
  .output(SetupTasksSchema)
  .handler(async ({ context, errors, input, signal }) => {
    const { captureException, getAIProviderConfigs, modelCache } =
      context.workspaceConfig;
    const model = await fetchModel({
      captureException,
      configs: getAIProviderConfigs(),
      modelCache,
      modelURI: input.modelURI,
    });
    if (!model.ok) {
      throw toORPCError(model.error, errors);
    }
    const aiSDKModel = await fetchAISDKModel({
      captureException,
      configs: getAIProviderConfigs(),
      modelCache,
      modelURI: input.modelURI,
      workspaceServerURL: getWorkspaceServerURL(),
    });
    if (!aiSDKModel.ok) {
      throw toORPCError(aiSDKModel.error, errors);
    }
    const result = await generateText({
      abortSignal: signal,
      instructions: SETUP_TASKS_INSTRUCTIONS,
      maxOutputTokens: TASK_NAME_MAX_OUTPUT_TOKENS,
      model: aiSDKModel.value,
      prompt: setupTasksMessage(input),
      providerOptions: providerOptionsForModel(aiSDKModel.value, {
        effort: "low",
        reasoning: model.value.reasoning,
      }),
    });
    const tasks = parseSetupTasks(result.text);
    if (!tasks) {
      throw errors.PARSE_ERROR({ message: "The model's tasks had no shape" });
    }
    return tasks;
  });

export const setup = { writeTasks };
