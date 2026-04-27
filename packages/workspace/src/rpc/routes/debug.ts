import { AIGatewayModel, AIGatewayModelURI } from "@instrument-org/ai-gateway";
import {
  AIProviderConfigIdSchema,
  OUR_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import { type AgentName } from "../../agents/types";
import { ActiveReplays } from "../../lib/active-replays";
import { createAppConfig } from "../../lib/app-config/create";
import { getCurrentDate } from "../../lib/get-current-date";
import { getProjectManifest } from "../../lib/project-manifest";
import {
  createReplaySession,
  executeSessionReplay,
  prepareProjectReplay,
  type ReplayMessage,
} from "../../lib/session-replay";
import { type SpawnAgentFunction } from "../../lib/spawn-agent";
import { Store } from "../../lib/store";
import { StoreId } from "../../schemas/store-id";
import { ProjectSubdomainSchema } from "../../schemas/subdomains";
import { base, toORPCError } from "../base";
import { publisher } from "../publisher";

const REPLAY_SESSION_NAME_PREFIX = "Replay";

const replaySession = base
  .input(
    z.object({
      delayMs: z.number().int().min(0).default(0),
      mode: z.enum(["new-project", "new-session"]).default("new-project"),
      sessionId: StoreId.SessionSchema,
      subdomain: ProjectSubdomainSchema,
    }),
  )
  .output(
    z.object({
      sessionId: StoreId.SessionSchema,
      subdomain: ProjectSubdomainSchema,
    }),
  )
  .handler(async ({ context, errors, input, signal }) => {
    const { delayMs, mode, sessionId, subdomain } = input;
    const { workspaceConfig } = context;

    const sourceAppConfig = createAppConfig({ subdomain, workspaceConfig });

    const messagesResult = await Store.getMessagesWithParts(
      { appConfig: sourceAppConfig, sessionId },
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

    let targetAppConfig = sourceAppConfig;
    let newSessionId: StoreId.Session;
    let replayMessages: ReplayMessage[];

    if (mode === "new-project") {
      const sourceManifest = await getProjectManifest(sourceAppConfig.appDir);
      const sourceProjectName = sourceManifest?.name ?? subdomain;

      const prepareResult = await prepareProjectReplay({
        sessionNamePrefix: REPLAY_SESSION_NAME_PREFIX,
        signal,
        sourceMessages,
        sourceProjectName,
        workspaceConfig,
      });
      if (prepareResult.isErr()) {
        workspaceConfig.captureException(prepareResult.error);
        throw toORPCError(prepareResult.error, errors);
      }

      targetAppConfig = prepareResult.value.projectConfig;
      newSessionId = prepareResult.value.sessionId;
      replayMessages = prepareResult.value.replayMessages;

      publisher.publish("project.updated", {
        subdomain: targetAppConfig.subdomain,
      });
    } else {
      const sessionResult = await createReplaySession({
        appConfig: sourceAppConfig,
        sessionNamePrefix: REPLAY_SESSION_NAME_PREFIX,
        signal,
        sourceMessages,
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
    ActiveReplays.register(
      newSessionId,
      abortController,
      targetAppConfig.subdomain,
    );
    publisher.publish("replay.changed", {
      isActive: true,
      sessionId: newSessionId,
      subdomain: targetAppConfig.subdomain,
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
        targetAppConfig,
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
      appConfig: targetAppConfig,
      delayMs,
      model,
      replayMessages,
      sessionId: newSessionId,
      signal: abortController.signal,
      spawnAgent,
    }).then(() => {
      if (ActiveReplays.isActive(newSessionId)) {
        ActiveReplays.cancel(newSessionId);
        publisher.publish("replay.changed", {
          isActive: false,
          sessionId: newSessionId,
          subdomain: targetAppConfig.subdomain,
        });
      }
    });

    workspaceConfig.captureEvent("session.replay_started");

    return {
      sessionId: newSessionId,
      subdomain: targetAppConfig.subdomain,
    };
  });

const cancelReplay = base
  .input(
    z.object({
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.void())
  .handler(({ input }) => {
    const subdomain = ActiveReplays.getSubdomain(input.sessionId);
    ActiveReplays.cancel(input.sessionId);
    if (subdomain) {
      publisher.publish("replay.changed", {
        isActive: false,
        sessionId: input.sessionId,
        subdomain,
      });
    }
  });

const replayStatus = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .output(z.object({ isActive: z.boolean() }))
  .handler(({ input }) => {
    return { isActive: ActiveReplays.isActive(input.sessionId) };
  });

const live = {
  replayStatus: base
    .input(z.object({ sessionId: StoreId.SessionSchema }))
    .output(eventIterator(z.object({ isActive: z.boolean() })))
    .handler(async function* ({ context, input, signal }) {
      yield call(replayStatus, input, { context, signal });

      for await (const payload of publisher.subscribe("replay.changed", {
        signal,
      })) {
        if (payload.sessionId === input.sessionId) {
          yield { isActive: payload.isActive };
        }
      }
    }),
  replayStatusBySubdomain: base
    .input(z.object({ subdomain: ProjectSubdomainSchema }))
    .output(
      eventIterator(
        z.object({ activeSessionIds: z.array(StoreId.SessionSchema) }),
      ),
    )
    .handler(async function* ({ input, signal }) {
      yield {
        activeSessionIds: ActiveReplays.getActiveSessionIds(input.subdomain),
      };

      for await (const payload of publisher.subscribe("replay.changed", {
        signal,
      })) {
        if (payload.subdomain === input.subdomain) {
          yield {
            activeSessionIds: ActiveReplays.getActiveSessionIds(
              input.subdomain,
            ),
          };
        }
      }
    }),
};

export const debug = { cancelReplay, live, replaySession };
