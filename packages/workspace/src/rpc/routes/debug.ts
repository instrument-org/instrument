import { AIGatewayModel, AIGatewayModelURI } from "@instrument-org/ai-gateway";
import {
  AIProviderConfigIdSchema,
  OUR_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import ms from "ms";
import { z } from "zod";

import { type AgentName } from "../../agents/types";
import { ActiveReplays } from "../../lib/active-replays";
import { createBashEnv } from "../../lib/create-bash-env";
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
import { resolveTaskProjectFolder } from "../../lib/task-project-folder";
import { getTaskState } from "../../lib/task-record";
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

/**
 * Per stream, so one runaway command cannot pin the message port. Generous
 * enough that a check reads its own output rather than working around this.
 */
const RUN_BASH_STREAM_LIMIT = 256 * 1024;

/**
 * No real caller aborts the oRPC signal (the debug bridge fires and forgets),
 * so the time bound lives here: without one a hung command holds its bash env
 * and any shim subprocess until just-bash's own one-hour execution deadline.
 * Generous next to the agent tool's 30s because a debug check may cold-start
 * uv or pnpm; the cap keeps an override from reopening the hour-long hole.
 */
const RUN_BASH_DEFAULT_TIMEOUT_MS = ms("2 minutes");
const RUN_BASH_MAX_TIMEOUT_MS = ms("10 minutes");

function clampStream(stream: string) {
  return stream.slice(0, RUN_BASH_STREAM_LIMIT);
}

/**
 * Runs one command in a task's real sandbox and hands back the streams
 * unmerged, which is what separates this from the agent's `bash` tool: that
 * tool joins stdout and stderr and truncates the result for a model's context,
 * so a check asking which stream a shim wrote to cannot read its own answer.
 *
 * The mounts, command shims, network policy, and bundled binaries are the
 * running build's, so this reports on a package rather than on a checkout --
 * the difference that decides whether a bundling gap is visible at all.
 *
 * Reachable only from the renderer over the message port, and from outside
 * only through `window.__studioDebug`, which refuses without the Developer
 * Mode preference and needs the app launched with a remote debugging port. No
 * gate here repeats that, because the workspace package has no view of a
 * Studio preference and this transport never reaches the network.
 */
const runBash = base
  .input(
    z.object({
      command: z.string().min(1),
      sessionId: StoreId.SessionSchema,
      taskId: TaskIdSchema,
      timeoutMs: z
        .number()
        .int()
        .min(1)
        .max(RUN_BASH_MAX_TIMEOUT_MS)
        .default(RUN_BASH_DEFAULT_TIMEOUT_MS),
    }),
  )
  .output(
    z.object({
      durationMs: z.number(),
      exitCode: z.number(),
      stderr: z.string(),
      stdout: z.string(),
      truncated: z.boolean(),
    }),
  )
  .handler(async ({ input, signal }) => {
    const taskState = await getTaskState(taskDir(input.taskId));
    const bash = await createBashEnv({
      attachedFolders: taskState.attachedFolders,
      projectFolderName: await resolveTaskProjectFolder(input.taskId),
      sessionId: input.sessionId,
      taskId: input.taskId,
    });

    const startedAt = performance.now();
    const timeout = AbortSignal.timeout(input.timeoutMs);

    try {
      const result = await bash.exec(input.command, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      return {
        durationMs: Math.round(performance.now() - startedAt),
        exitCode: result.exitCode,
        stderr: clampStream(result.stderr),
        stdout: clampStream(result.stdout),
        truncated:
          result.stdout.length > RUN_BASH_STREAM_LIMIT ||
          result.stderr.length > RUN_BASH_STREAM_LIMIT,
      };
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      // just-bash throws for some filesystem failures instead of exiting
      // non-zero. Report it as a failed command so a check reads a result
      // rather than an RPC error.
      return {
        durationMs: Math.round(performance.now() - startedAt),
        exitCode: 1,
        stderr: error instanceof Error ? error.message : String(error),
        stdout: "",
        truncated: false,
      };
    }
  });

export const debug = { replaySession, runBash };
