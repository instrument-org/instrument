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
import { type ProjectSubdomain } from "../schemas/subdomains";
import { type WorkspaceConfig } from "../types";
import { ActiveReplays } from "./active-replays";
import { newProjectConfig } from "./app-config/new";
import { type AppConfigProject } from "./app-config/types";
import { taskDir } from "./app-dir-utils";
import {
  TUTORIAL_TASK_REPLAY,
  type TutorialTaskWriteFileStep,
} from "./data/tutorial-task-replay";
import { initializeProject } from "./initialize-project";
import { setProjectState } from "./project-state-store";
import { runToolCall } from "./run-tool-call";
import { type SpawnAgentFunction } from "./spawn-agent";
import { Store } from "./store";

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
    const { project } = TUTORIAL_TASK_REPLAY;
    const projectConfig = await newProjectConfig({
      preferredFolderName: SubdomainPartSchema.parse(project.folderName),
      workspaceConfig,
    });

    const projectResult = yield* await initializeProject(
      {
        initialManifest: { name: project.title },
        projectConfig,
        templateName: project.templateName,
        workspaceConfig,
      },
      { signal },
    );

    await setProjectState(taskDir(projectResult.projectConfig), {
      showTutorial: true,
    });

    const sessionId = StoreId.newSessionId();
    const now = new Date();
    const sessionResult = yield* Store.saveSession(
      {
        createdAt: now,
        id: sessionId,
        title: project.title,
        updatedAt: now,
      } satisfies Session.Type,
      projectResult.projectConfig,
      { signal },
    );

    return ok({
      appConfig: projectResult.projectConfig,
      sessionId: sessionResult.id,
      subdomain: projectResult.projectConfig,
    });
  });

  if (setupResult.isErr()) {
    return setupResult;
  }

  const { appConfig, sessionId, subdomain } = setupResult.value;
  const controller = new AbortController();

  ActiveReplays.register(sessionId, controller, subdomain);
  publishReplayChanged({ isActive: true, sessionId, subdomain });
  const completion = runTutorialTaskReplay({
    appConfig,
    sessionId,
    signal: controller.signal,
    timing: getReplayTiming({ delayMs, timing }),
    workspaceConfig,
  });

  return ok({ completion, sessionId, subdomain });
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
  isActive,
  sessionId,
  subdomain,
}: {
  isActive: boolean;
  sessionId: StoreId.Session;
  subdomain: ProjectSubdomain;
}) {
  publisher.publish("replay.changed", { isActive, sessionId, subdomain });
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
  appConfig,
  sessionId,
  signal,
  timing,
  workspaceConfig,
}: {
  appConfig: AppConfigProject;
  sessionId: StoreId.Session;
  signal: AbortSignal;
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
      appConfig,
      sessionId,
      text: userStep.text,
    });
    await mainAgent.onStart({
      appConfig,
      sessionId,
      signal: noAbort,
    });

    try {
      const introMessageId = StoreId.newMessageId();
      const introMessageCreatedAt = new Date();
      await saveAssistantMessage({
        appConfig,
        createdAt: introMessageCreatedAt,
        finishReason: "unknown",
        messageId: introMessageId,
        sessionId,
      });
      await delay({ delayMs: timing.assistantStartDelayMs, signal });

      await streamAssistantText({
        appConfig,
        createdAt: introMessageCreatedAt,
        messageId: introMessageId,
        sessionId,
        signal,
        text: introStep.text,
        textChunkDelayMs: timing.textChunkDelayMs,
      });

      const toolMessageId = await runWriteGuideFileTool({
        appConfig,
        noAbort,
        sessionId,
        signal,
        step: writeGuideFileStep,
        stepDelayMs: timing.stepDelayMs,
        toolInputDurationMs: timing.toolInputDurationMs,
      });

      await streamAssistantText({
        appConfig,
        messageId: toolMessageId,
        sessionId,
        signal,
        text: completionStep.text,
        textChunkDelayMs: timing.textChunkDelayMs,
      });
    } finally {
      await mainAgent.onFinish({
        appConfig,
        model: replayModel(),
        parentMessageId: userMessageId,
        sessionId,
        signal: noAbort,
      });
    }
  } catch (error) {
    if (!signal.aborted) {
      workspaceConfig.captureException(error);
    }
  } finally {
    ActiveReplays.cancel(sessionId);
    publishReplayChanged({
      isActive: false,
      sessionId,
      subdomain: appConfig,
    });
  }
}

async function runWriteGuideFileTool({
  appConfig,
  noAbort,
  sessionId,
  signal,
  step,
  stepDelayMs,
  toolInputDurationMs,
}: {
  appConfig: AppConfigProject;
  noAbort: AbortSignal;
  sessionId: StoreId.Session;
  signal: AbortSignal;
  step: TutorialTaskWriteFileStep;
  stepDelayMs: number;
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
    appConfig,
    createdAt,
    finishReason: "tool-calls",
    messageId,
    sessionId,
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
    appConfig,
    baseToolPart,
    input,
    signal,
    toolInputDurationMs,
  });
  await delay({ delayMs: stepDelayMs, signal });

  const inputAvailablePart = {
    ...baseToolPart,
    input,
    state: "input-available",
  } satisfies TutorialTaskWriteFileInputAvailablePart;
  await saveToolPart({ appConfig, toolPart: inputAvailablePart });

  await runToolCall({
    agentName: "main",
    appConfig,
    model: replayModel(),
    part: inputAvailablePart,
    sessionId,
    signal: noAbort,
    spawnAgent: replaySpawnAgent,
  });
  await delay({ delayMs: stepDelayMs, signal });

  return messageId;
}

async function saveAssistantMessage({
  appConfig,
  createdAt,
  finishReason,
  messageId,
  sessionId,
}: {
  appConfig: AppConfigProject;
  createdAt: Date;
  finishReason: SessionMessage.Assistant["metadata"]["finishReason"];
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
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
      appConfig,
      {},
    ),
  );
}

async function saveTextPart({
  appConfig,
  createdAt,
  endedAt,
  messageId,
  partId,
  sessionId,
  text,
}: {
  appConfig: AppConfigProject;
  createdAt: Date;
  endedAt?: Date;
  messageId: StoreId.Message;
  partId: StoreId.Part;
  sessionId: StoreId.Session;
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
      appConfig,
      {},
    ),
  );
}

async function saveToolPart({
  appConfig,
  toolPart,
}: {
  appConfig: AppConfigProject;
  toolPart:
    | SessionMessagePart.ToolPartInputAvailable
    | SessionMessagePart.ToolPartInputStreaming;
}) {
  await unwrap(Store.savePart(toolPart, appConfig, {}));
}

async function saveUserMessage({
  appConfig,
  sessionId,
  text,
}: {
  appConfig: AppConfigProject;
  sessionId: StoreId.Session;
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
      appConfig,
      {},
    ),
  );
  return messageId;
}

async function streamAssistantText({
  appConfig,
  createdAt = new Date(),
  messageId = StoreId.newMessageId(),
  sessionId,
  signal,
  text,
  textChunkDelayMs,
}: {
  appConfig: AppConfigProject;
  createdAt?: Date;
  messageId?: StoreId.Message;
  sessionId: StoreId.Session;
  signal: AbortSignal;
  text: string;
  textChunkDelayMs: number;
}) {
  const partId = StoreId.newPartId();
  await saveAssistantMessage({
    appConfig,
    createdAt,
    finishReason: "stop",
    messageId,
    sessionId,
  });

  let streamedText = "";
  for (const chunk of text.split(" ")) {
    streamedText = streamedText ? `${streamedText} ${chunk}` : chunk;
    await saveTextPart({
      appConfig,
      createdAt,
      messageId,
      partId,
      sessionId,
      text: streamedText,
    });
    await delay({ delayMs: textChunkDelayMs, signal });
  }

  await saveTextPart({
    appConfig,
    createdAt,
    endedAt: new Date(),
    messageId,
    partId,
    sessionId,
    text: streamedText,
  });
}

async function streamWriteFileInput({
  appConfig,
  baseToolPart,
  input,
  signal,
  toolInputDurationMs,
}: {
  appConfig: AppConfigProject;
  baseToolPart: Omit<
    TutorialTaskWriteFileInputStreamingPart,
    "input" | "state"
  >;
  input: TutorialTaskWriteFileInput;
  signal: AbortSignal;
  toolInputDurationMs: number;
}) {
  const contentChunks = getStreamingContentChunks(input.content);
  const delayPerChunkMs =
    toolInputDurationMs === 0
      ? 0
      : Math.ceil(toolInputDurationMs / contentChunks.length);

  await saveToolPart({
    appConfig,
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
      appConfig,
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
