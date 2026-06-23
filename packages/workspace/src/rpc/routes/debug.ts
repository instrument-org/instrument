import { AIGatewayModel, AIGatewayModelURI } from "@instrument-org/ai-gateway";
import {
  AIProviderConfigIdSchema,
  OUR_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { z } from "zod";

import { type AgentName } from "../../agents/types";
import { ActiveReplays } from "../../lib/active-replays";
import { getCurrentDate } from "../../lib/get-current-date";
import {
  createReplaySession,
  executeSessionReplay,
  prepareTaskReplay,
  type ReplayMessage,
} from "../../lib/session-replay";
import { type SpawnAgentFunction } from "../../lib/spawn-agent";
import { Store } from "../../lib/store";
import { taskDir } from "../../lib/task-dir-utils";
import { getTaskSettings } from "../../lib/task-settings";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { base, toORPCError } from "../base";
import { publisher } from "../publisher";

const REPLAY_SESSION_NAME_PREFIX = "Replay";

const replaySession = base
  .input(
    z.object({
      delayMs: z.number().int().min(0).default(0),
      id: TaskIdSchema,
      mode: z.enum(["new-task", "new-session"]).default("new-task"),
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(
    z.object({
      id: TaskIdSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .handler(async ({ context, errors, input, signal }) => {
    const { delayMs, id, mode, sessionId } = input;
    const { workspaceConfig } = context;

    const sourceTaskId = id;

    const messagesResult = await Store.getMessagesWithParts(
      { sessionId, taskId: sourceTaskId },
      { signal },
    );
    if (messagesResult.isErr()) {
      throw toORPCError(messagesResult.error, errors);
    }
    const sourceMessages = messagesResult.value;

    const canonicalId = AIGatewayModel.CanonicalIdSchema.parse("replay-stub");
    const providerConfigId = AIProviderConfigIdSchema.parse("replay-stub");
    const model = AIGatewayModel.Schema.parse({
      author: "replay",
      canonicalId,
      features: [],
      name: "Replay Stub",
      params: { provider: OUR_PROVIDER_CONFIG.type, providerConfigId },
      providerId: AIGatewayModel.ProviderIdSchema.parse("replay-stub"),
      providerName: "Replay",
      tags: [],
      uri: AIGatewayModelURI.fromModel({
        author: "replay",
        canonicalId,
        params: { provider: OUR_PROVIDER_CONFIG.type, providerConfigId },
      }),
    });

    let targetTaskId = sourceTaskId;
    let newSessionId: StoreId.Session;
    let replayMessages: ReplayMessage[];

    if (mode === "new-task") {
      const sourceSettings = await getTaskSettings(taskDir(sourceTaskId));
      const sourceTaskName = sourceSettings?.name ?? id;

      const prepareResult = await prepareTaskReplay({
        sessionNamePrefix: REPLAY_SESSION_NAME_PREFIX,
        signal,
        sourceMessages,
        sourceTaskName,
        workspaceConfig,
      });
      if (prepareResult.isErr()) {
        workspaceConfig.captureException(prepareResult.error);
        throw toORPCError(prepareResult.error, errors);
      }

      targetTaskId = prepareResult.value.taskId;
      newSessionId = prepareResult.value.sessionId;
      replayMessages = prepareResult.value.replayMessages;

      publisher.publish("task.updated", {
        id: targetTaskId,
      });
    } else {
      const sessionResult = await createReplaySession({
        sessionNamePrefix: REPLAY_SESSION_NAME_PREFIX,
        signal,
        sourceMessages,
        taskId: sourceTaskId,
      });
      if (sessionResult.isErr()) {
        workspaceConfig.captureException(sessionResult.error);
        throw toORPCError(sessionResult.error, errors);
      }

      newSessionId = sessionResult.value.sessionId;
      replayMessages = sessionResult.value.replayMessages;
    }

    const agentName: AgentName = "main";
    const abortController = new AbortController();
    ActiveReplays.register(newSessionId, abortController, targetTaskId);
    publisher.publish("replay.changed", {
      id: targetTaskId,
      isActive: true,
      sessionId: newSessionId,
    });

    const spawnAgent: SpawnAgentFunction = ({ signal: subSignal }) => {
      const subSessionId = StoreId.newSessionId();
      const now = getCurrentDate();
      const messageId = StoreId.newMessageId();
      const partId = StoreId.newPartId();
      void Store.saveMessageWithParts(
        {
          id: messageId,
          metadata: {
            createdAt: now,
            finishReason: "stop",
            modelId: "replay-stub",
            providerId: "replay",
            sessionId: newSessionId,
            synthetic: true,
          },
          parts: [
            {
              metadata: {
                createdAt: now,
                id: partId,
                messageId,
                sessionId: newSessionId,
              },
              text: "[Replay] Sub-agent tasks are not replayed.",
              type: "text",
            },
          ],
          role: "assistant",
        },
        targetTaskId,
      );
      return {
        completion: new Promise((resolve) => {
          subSignal.addEventListener("abort", () => {
            resolve({ isOk: () => false } as never);
          });
        }),
        sessionId: subSessionId,
      };
    };

    void executeSessionReplay({
      agentName,
      delayMs,
      model,
      replayMessages,
      sessionId: newSessionId,
      signal: abortController.signal,
      spawnAgent,
      taskId: targetTaskId,
    }).then(() => {
      if (ActiveReplays.isActive(newSessionId)) {
        ActiveReplays.cancel(newSessionId);
        publisher.publish("replay.changed", {
          id: targetTaskId,
          isActive: false,
          sessionId: newSessionId,
        });
      }
    });

    workspaceConfig.captureEvent("session.replay_started");

    return {
      id: targetTaskId,
      sessionId: newSessionId,
    };
  });

export const debug = { replaySession };
