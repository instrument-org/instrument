import { AIGatewayModel, AIGatewayModelURI } from "@instrument-org/ai-gateway";
import {
  AIProviderConfigIdSchema,
  OUR_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { ok, type Result, safeTry } from "neverthrow";

import { mainAgent } from "../agents/main";
import { publisher } from "../rpc/publisher";
import { type Session } from "../schemas/session";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { SubdomainPartSchema } from "../schemas/subdomain-part";
import { type TaskId } from "../schemas/task-id";
import { type WorkspaceConfig } from "../types";
import { ActiveReplays } from "./active-replays";
import {
  TUTORIAL_TASK_REPLAY,
  type TutorialTaskWriteFileStep,
} from "./data/tutorial-task-replay";
import { initializeTask } from "./initialize-task";
import { newTaskId } from "./new-task-id";
import { runToolCall } from "./run-tool-call";
import { type SpawnAgentFunction } from "./spawn-agent";
import { Store } from "./store";
import { taskDir } from "./task-dir-utils";
import { setTaskState } from "./task-record";

const DEFAULT_REPLAY_TIMING = {
  assistantStartDelayMs: 1500,
  stepDelayMs: 1000,
  textChunkDelayMs: 24,
  toolInputDurationMs: 4000,
} satisfies TutorialTaskReplayTiming;

interface TutorialTaskReplayTiming {
  assistantStartDelayMs: number;
  stepDelayMs: number;
  textChunkDelayMs: number;
  toolInputDurationMs: number;
}

interface TutorialTaskWriteFileInput {
  content: string;
  explanation: string;
  filePath: string;
}

type TutorialTaskWriteFileInputAvailablePart = Extract<
  SessionMessagePart.ToolPartInputAvailable,
  { type: "tool-write_file" }
>;

type TutorialTaskWriteFileInputStreamingPart = Extract<
  SessionMessagePart.ToolPartInputStreaming,
  { type: "tool-write_file" }
>;

export async function startTutorialTaskReplay({
  delayMs,
  signal,
  timing,
  workspaceConfig,
}: {
  delayMs?: number;
  signal?: AbortSignal;
  timing?: Partial<TutorialTaskReplayTiming>;
  workspaceConfig: WorkspaceConfig;
}) {
  const setupResult = await safeTry(async function* () {
    const { task } = TUTORIAL_TASK_REPLAY;
    const taskId = await newTaskId({
      preferredFolderName: SubdomainPartSchema.parse(task.folderName),
      workspaceConfig,
    });

    const taskResult = yield* await initializeTask(
      {
        initialSettings: { name: task.title },
        taskId,
        workspaceConfig,
      },
      { signal },
    );

    await setTaskState(taskDir(taskResult.taskId), {
      showTutorial: true,
    });

    const sessionId = StoreId.newSessionId();
    const now = new Date();
    const sessionResult = yield* Store.saveSession(
      {
        createdAt: now,
        id: sessionId,
        title: task.title,
        updatedAt: now,
      } satisfies Session.Type,
      taskResult.taskId,
      { signal },
    );

    return ok({
      id: taskResult.taskId,
      sessionId: sessionResult.id,
      taskId: taskResult.taskId,
    });
  });

  if (setupResult.isErr()) {
    return setupResult;
  }

  const { id, sessionId, taskId } = setupResult.value;
  const controller = new AbortController();

  ActiveReplays.register(sessionId, controller, id);
  publishReplayChanged({ id, isActive: true, sessionId });
  const completion = runTutorialTaskReplay({
    sessionId,
    signal: controller.signal,
    taskId,
    timing: getReplayTiming({ delayMs, timing }),
    workspaceConfig,
  });

  return ok({ completion, id, sessionId });
}

async function delay({
  delayMs,
  signal,
}: {
  delayMs: number;
  signal: AbortSignal;
}) {
  if (signal.aborted || delayMs === 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function getReplayTiming({
  delayMs,
  timing,
}: {
  delayMs: number | undefined;
  timing: Partial<TutorialTaskReplayTiming> | undefined;
}) {
  const fallbackDelayMs = delayMs ?? DEFAULT_REPLAY_TIMING.stepDelayMs;
  return {
    assistantStartDelayMs:
      timing?.assistantStartDelayMs ??
      delayMs ??
      DEFAULT_REPLAY_TIMING.assistantStartDelayMs,
    stepDelayMs: timing?.stepDelayMs ?? fallbackDelayMs,
    textChunkDelayMs:
      timing?.textChunkDelayMs ??
      delayMs ??
      DEFAULT_REPLAY_TIMING.textChunkDelayMs,
    toolInputDurationMs:
      timing?.toolInputDurationMs ??
      delayMs ??
      DEFAULT_REPLAY_TIMING.toolInputDurationMs,
  } satisfies TutorialTaskReplayTiming;
}

function getStreamingContentChunks(content: string) {
  const chunks: string[] = [];
  let end = 0;

  while (end < content.length) {
    const target = Math.min(content.length, end + 220);
    let nextEnd = target;

    if (target < content.length) {
      const paragraphBreak = content.lastIndexOf("\n\n", target);
      const wordBreak = content.lastIndexOf(" ", target);
      if (paragraphBreak > end + 80) {
        nextEnd = paragraphBreak + 2;
      } else if (wordBreak > end + 80) {
        nextEnd = wordBreak + 1;
      }
    }

    end = nextEnd;
    chunks.push(content.slice(0, end));
  }

  return chunks.length > 0 ? chunks : [content];
}

function publishReplayChanged({
  id,
  isActive,
  sessionId,
}: {
  id: TaskId;
  isActive: boolean;
  sessionId: StoreId.Session;
}) {
  publisher.publish("replay.changed", { id, isActive, sessionId });
}

function replayModel() {
  const canonicalId = AIGatewayModel.CanonicalIdSchema.parse(
    "tutorial-task-replay",
  );
  const providerConfigId = AIProviderConfigIdSchema.parse(
    "tutorial-task-replay",
  );
  return AIGatewayModel.Schema.parse({
    author: "replay",
    canonicalId,
    features: [],
    name: "Tutorial Task Replay",
    params: { provider: OUR_PROVIDER_CONFIG.type, providerConfigId },
    providerId: AIGatewayModel.ProviderIdSchema.parse("tutorial-task-replay"),
    providerName: "Replay",
    tags: [],
    uri: AIGatewayModelURI.fromModel({
      author: "replay",
      canonicalId,
      params: { provider: OUR_PROVIDER_CONFIG.type, providerConfigId },
    }),
  });
}

function replaySpawnAgent(): ReturnType<SpawnAgentFunction> {
  const completion: ReturnType<SpawnAgentFunction>["completion"] = new Promise(
    () => {
      // Sub-agent tasks are not part of this hand-authored replay.
    },
  );
  return {
    completion,
    sessionId: StoreId.newSessionId(),
  };
}

async function runTutorialTaskReplay({
  sessionId,
  signal,
  taskId,
  timing,
  workspaceConfig,
}: {
  sessionId: StoreId.Session;
  signal: AbortSignal;
  taskId: TaskId;
  timing: TutorialTaskReplayTiming;
  workspaceConfig: WorkspaceConfig;
}) {
  // External calls (runToolCall, mainAgent.onFinish) that must complete even
  // when the user stops mid-replay use this signal, which is never aborted.
  const noAbort = new AbortController().signal;

  try {
    const [userStep, introStep, writeGuideFileStep, completionStep] =
      TUTORIAL_TASK_REPLAY.steps;
    const userMessageId = await saveUserMessage({
      sessionId,
      taskId,
      text: userStep.text,
    });
    await mainAgent.onStart({
      sessionId,
      signal: noAbort,
      taskId,
    });

    try {
      const introMessageId = StoreId.newMessageId();
      const introMessageCreatedAt = new Date();
      await saveAssistantMessage({
        createdAt: introMessageCreatedAt,
        finishReason: "unknown",
        messageId: introMessageId,
        sessionId,
        taskId,
      });
      await delay({ delayMs: timing.assistantStartDelayMs, signal });

      await streamAssistantText({
        createdAt: introMessageCreatedAt,
        messageId: introMessageId,
        sessionId,
        signal,
        taskId,
        text: introStep.text,
        textChunkDelayMs: timing.textChunkDelayMs,
      });

      const toolMessageId = await runWriteGuideFileTool({
        noAbort,
        sessionId,
        signal,
        step: writeGuideFileStep,
        stepDelayMs: timing.stepDelayMs,
        taskId,
        toolInputDurationMs: timing.toolInputDurationMs,
      });

      await streamAssistantText({
        messageId: toolMessageId,
        sessionId,
        signal,
        taskId,
        text: completionStep.text,
        textChunkDelayMs: timing.textChunkDelayMs,
      });
    } finally {
      await mainAgent.onFinish({
        model: replayModel(),
        parentMessageId: userMessageId,
        sessionId,
        signal: noAbort,
        taskId,
      });
    }
  } catch (error) {
    if (!signal.aborted) {
      workspaceConfig.captureException(error);
    }
  } finally {
    ActiveReplays.cancel(sessionId);
    publishReplayChanged({
      id: taskId,
      isActive: false,
      sessionId,
    });
  }
}

async function runWriteGuideFileTool({
  noAbort,
  sessionId,
  signal,
  step,
  stepDelayMs,
  taskId,
  toolInputDurationMs,
}: {
  noAbort: AbortSignal;
  sessionId: StoreId.Session;
  signal: AbortSignal;
  step: TutorialTaskWriteFileStep;
  stepDelayMs: number;
  taskId: TaskId;
  toolInputDurationMs: number;
}) {
  const messageId = StoreId.newMessageId();
  const partId = StoreId.newPartId();
  const toolCallId = StoreId.ToolCallSchema.parse(step.toolCallId);
  const createdAt = new Date();
  const input = {
    content: step.content,
    explanation: step.explanation,
    filePath: step.filePath,
  } satisfies TutorialTaskWriteFileInput;

  await saveAssistantMessage({
    createdAt,
    finishReason: "tool-calls",
    messageId,
    sessionId,
    taskId,
  });

  const baseToolPart = {
    metadata: {
      createdAt,
      id: partId,
      messageId,
      sessionId,
    },
    providerExecuted: false,
    toolCallId,
    type: "tool-write_file",
  } satisfies Omit<TutorialTaskWriteFileInputStreamingPart, "input" | "state">;

  await streamWriteFileInput({
    baseToolPart,
    input,
    signal,
    taskId,
    toolInputDurationMs,
  });
  await delay({ delayMs: stepDelayMs, signal });

  const inputAvailablePart = {
    ...baseToolPart,
    input,
    state: "input-available",
  } satisfies TutorialTaskWriteFileInputAvailablePart;
  await saveToolPart({ taskId, toolPart: inputAvailablePart });

  await runToolCall({
    agentName: "main",
    model: replayModel(),
    part: inputAvailablePart,
    sessionId,
    signal: noAbort,
    spawnAgent: replaySpawnAgent,
    taskId,
  });
  await delay({ delayMs: stepDelayMs, signal });

  return messageId;
}

async function saveAssistantMessage({
  createdAt,
  finishReason,
  messageId,
  sessionId,
  taskId,
}: {
  createdAt: Date;
  finishReason: SessionMessage.Assistant["metadata"]["finishReason"];
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  taskId: TaskId;
}) {
  await unwrap(
    Store.saveMessage(
      {
        id: messageId,
        metadata: {
          createdAt,
          finishReason,
          modelId: "tutorial-task-replay",
          providerId: "replay",
          sessionId,
          synthetic: true,
        },
        role: "assistant",
      } satisfies SessionMessage.Assistant,
      taskId,
      {},
    ),
  );
}

async function saveTextPart({
  createdAt,
  endedAt,
  messageId,
  partId,
  sessionId,
  taskId,
  text,
}: {
  createdAt: Date;
  endedAt?: Date;
  messageId: StoreId.Message;
  partId: StoreId.Part;
  sessionId: StoreId.Session;
  taskId: TaskId;
  text: string;
}) {
  await unwrap(
    Store.savePart(
      {
        metadata: {
          createdAt,
          endedAt,
          id: partId,
          messageId,
          sessionId,
        },
        text,
        type: "text",
      } satisfies SessionMessagePart.TextPart,
      taskId,
      {},
    ),
  );
}

async function saveToolPart({
  taskId,
  toolPart,
}: {
  taskId: TaskId;
  toolPart:
    | SessionMessagePart.ToolPartInputAvailable
    | SessionMessagePart.ToolPartInputStreaming;
}) {
  await unwrap(Store.savePart(toolPart, taskId, {}));
}

async function saveUserMessage({
  sessionId,
  taskId,
  text,
}: {
  sessionId: StoreId.Session;
  taskId: TaskId;
  text: string;
}) {
  const messageId = StoreId.newMessageId();
  const createdAt = new Date();
  await unwrap(
    Store.saveMessageWithParts(
      {
        id: messageId,
        metadata: { createdAt, sessionId },
        parts: [
          {
            metadata: {
              createdAt,
              id: StoreId.newPartId(),
              messageId,
              sessionId,
            },
            text,
            type: "text",
          },
        ],
        role: "user",
      } satisfies SessionMessage.UserWithParts,
      taskId,
      {},
    ),
  );
  return messageId;
}

async function streamAssistantText({
  createdAt = new Date(),
  messageId = StoreId.newMessageId(),
  sessionId,
  signal,
  taskId,
  text,
  textChunkDelayMs,
}: {
  createdAt?: Date;
  messageId?: StoreId.Message;
  sessionId: StoreId.Session;
  signal: AbortSignal;
  taskId: TaskId;
  text: string;
  textChunkDelayMs: number;
}) {
  const partId = StoreId.newPartId();
  await saveAssistantMessage({
    createdAt,
    finishReason: "stop",
    messageId,
    sessionId,
    taskId,
  });

  let streamedText = "";
  for (const chunk of text.split(" ")) {
    streamedText = streamedText ? `${streamedText} ${chunk}` : chunk;
    await saveTextPart({
      createdAt,
      messageId,
      partId,
      sessionId,
      taskId,
      text: streamedText,
    });
    await delay({ delayMs: textChunkDelayMs, signal });
  }

  await saveTextPart({
    createdAt,
    endedAt: new Date(),
    messageId,
    partId,
    sessionId,
    taskId,
    text: streamedText,
  });
}

async function streamWriteFileInput({
  baseToolPart,
  input,
  signal,
  taskId,
  toolInputDurationMs,
}: {
  baseToolPart: Omit<
    TutorialTaskWriteFileInputStreamingPart,
    "input" | "state"
  >;
  input: TutorialTaskWriteFileInput;
  signal: AbortSignal;
  taskId: TaskId;
  toolInputDurationMs: number;
}) {
  const contentChunks = getStreamingContentChunks(input.content);
  const delayPerChunkMs =
    toolInputDurationMs === 0
      ? 0
      : Math.ceil(toolInputDurationMs / contentChunks.length);

  await saveToolPart({
    taskId,
    toolPart: {
      ...baseToolPart,
      input: {
        ...input,
        content: "",
      },
      state: "input-streaming",
    } satisfies TutorialTaskWriteFileInputStreamingPart,
  });

  for (const content of contentChunks) {
    await delay({ delayMs: delayPerChunkMs, signal });
    await saveToolPart({
      taskId,
      toolPart: {
        ...baseToolPart,
        input: {
          ...input,
          content,
        },
        state: "input-streaming",
      } satisfies TutorialTaskWriteFileInputStreamingPart,
    });
  }
}

async function unwrap<T, E>(resultPromise: PromiseLike<Result<T, E>>) {
  const result = await resultPromise;
  if (result.isErr()) {
    throw result.error instanceof Error
      ? result.error
      : new Error(String(result.error));
  }
  return result.value;
}
