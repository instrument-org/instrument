import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { ok, safeTry } from "neverthrow";

import { type AgentName } from "../agents/types";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type WorkspaceConfig } from "../types";
import { newProjectConfig } from "./app-config/new";
import { type AppConfig } from "./app-config/types";
import { createSession } from "./create-session";
import { getCurrentDate } from "./get-current-date";
import { initializeProject } from "./initialize-project";
import { isToolPart } from "./is-tool-part";
import { runToolCall } from "./run-tool-call";
import { type SpawnAgentFunction } from "./spawn-agent";
import { Store } from "./store";

const DEFAULT_TEMPLATE_NAME = "basic";

export interface ReplayMessage {
  allParts: SessionMessagePart.Type[];
  message: SessionMessage.WithParts;
  replayToolParts: ReplayToolPart[];
}

interface ReplayToolPart {
  inputAvailablePart: SessionMessagePart.ToolPartInputAvailable;
  inputStreamingPart: SessionMessagePart.ToolPartInputStreaming;
}

export async function createReplaySession({
  appConfig,
  sessionNamePrefix,
  signal,
  sourceMessages,
}: {
  appConfig: AppConfig;
  sessionNamePrefix: string;
  signal?: AbortSignal;
  sourceMessages: SessionMessage.WithParts[];
}) {
  return safeTry(async function* () {
    const sessionId = StoreId.newSessionId();
    const replayMessages = yield* await saveAndBuildReplaySession({
      appConfig,
      sessionId,
      sessionNamePrefix,
      signal,
      sourceMessages,
    });
    return ok({ replayMessages, sessionId });
  });
}

export async function executeSessionReplay({
  agentName,
  appConfig,
  delayMs = 0,
  model,
  replayMessages,
  sessionId,
  signal,
  spawnAgent,
}: {
  agentName: AgentName;
  appConfig: AppConfig;
  delayMs?: number;
  model: AIGatewayModel.Type;
  replayMessages: ReplayMessage[];
  sessionId: StoreId.Session;
  signal: AbortSignal;
  spawnAgent: SpawnAgentFunction;
}) {
  const delay = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delayMs);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    });

  for (const { allParts, message, replayToolParts } of replayMessages) {
    if (signal.aborted) {
      return;
    }

    await Store.saveMessage(message, appConfig, { signal });

    if (delayMs > 0) {
      await delay();
    }

    const replayToolPartById = new Map(
      replayToolParts.map((p) => [p.inputStreamingPart.metadata.id, p]),
    );

    for (const part of allParts) {
      const replayToolPart = replayToolPartById.get(part.metadata.id);

      if (replayToolPart) {
        // Save as input-streaming first to simulate partial JSON streaming,
        // then delay before transitioning to input-available for re-execution.
        await Store.savePart(replayToolPart.inputStreamingPart, appConfig, {
          signal,
        });

        if (delayMs > 0) {
          await delay();
        }

        await Store.savePart(replayToolPart.inputAvailablePart, appConfig, {
          signal,
        });

        await runToolCall({
          agentName,
          appConfig,
          model,
          part: replayToolPart.inputAvailablePart,
          sessionId,
          signal,
          spawnAgent,
        });
      } else {
        await Store.savePart(part, appConfig, { signal });
      }

      if (delayMs > 0) {
        await delay();
      }
    }
  }
}

export async function prepareProjectReplay({
  sessionNamePrefix,
  signal,
  sourceMessages,
  sourceProjectName,
  workspaceConfig,
}: {
  sessionNamePrefix: string;
  signal?: AbortSignal;
  sourceMessages: SessionMessage.WithParts[];
  sourceProjectName: string;
  workspaceConfig: WorkspaceConfig;
}) {
  return safeTry(async function* () {
    const projectConfig = await newProjectConfig({ workspaceConfig });

    yield* await initializeProject(
      {
        initialManifest: { name: `Replay of ${sourceProjectName}` },
        projectConfig,
        templateName: DEFAULT_TEMPLATE_NAME,
        workspaceConfig,
      },
      { signal },
    );

    const sessionId = StoreId.newSessionId();
    const replayMessages = yield* await saveAndBuildReplaySession({
      appConfig: projectConfig,
      sessionId,
      sessionNamePrefix,
      signal,
      sourceMessages,
    });

    return ok({ projectConfig, replayMessages, sessionId });
  });
}

function buildReplayMessages(
  sourceMessages: SessionMessage.WithParts[],
  newSessionId: StoreId.Session,
): ReplayMessage[] {
  const now = getCurrentDate();
  const result: ReplayMessage[] = [];

  for (const sourceMessage of sourceMessages) {
    const newMessageId = StoreId.newMessageId();
    const replayToolParts: ReplayToolPart[] = [];
    const allParts: SessionMessagePart.Type[] = [];

    for (const sourcePart of sourceMessage.parts) {
      const newPartId = StoreId.newPartId();
      const freshMetadata = {
        createdAt: now,
        id: newPartId,
        messageId: newMessageId,
        sessionId: newSessionId,
      };

      if (
        isToolPart(sourcePart) &&
        (sourcePart.state === "output-available" ||
          sourcePart.state === "output-error")
      ) {
        // Build metadata from scratch: all BaseMetadata fields are fresh and
        // ToolPartBaseMetadata only adds contextItems, which must be empty so
        // re-execution starts clean (otherwise copied + new items accumulate).
        //
        // The streaming part shares the same ID so the execute loop can find
        // it by ID in allParts; the input-available part is stored alongside.
        const inputStreamingPart = {
          ...sourcePart,
          metadata: freshMetadata,
          state: "input-streaming" as const,
        } as SessionMessagePart.ToolPartInputStreaming;
        const inputAvailablePart = {
          ...sourcePart,
          metadata: freshMetadata,
          state: "input-available" as const,
        } as SessionMessagePart.ToolPartInputAvailable;
        // Push the streaming part as the allParts sentinel — the execute
        // loop keys off its ID to find the full ReplayToolPart.
        allParts.push(inputStreamingPart);
        replayToolParts.push({ inputAvailablePart, inputStreamingPart });
      } else {
        allParts.push({
          ...sourcePart,
          metadata: { ...sourcePart.metadata, ...freshMetadata },
        } as SessionMessagePart.Type);
      }
    }

    const newMessage = {
      ...sourceMessage,
      id: newMessageId,
      metadata: {
        ...sourceMessage.metadata,
        createdAt: now,
        sessionId: newSessionId,
      },
      parts: [],
    } as SessionMessage.WithParts;

    result.push({ allParts, message: newMessage, replayToolParts });
  }

  return result;
}

async function saveAndBuildReplaySession({
  appConfig,
  sessionId,
  sessionNamePrefix,
  signal,
  sourceMessages,
}: {
  appConfig: AppConfig;
  sessionId: StoreId.Session;
  sessionNamePrefix: string;
  signal?: AbortSignal;
  sourceMessages: SessionMessage.WithParts[];
}) {
  return safeTry(async function* () {
    yield* await createSession({
      appConfig,
      sessionId,
      sessionNamePrefix,
      signal,
    });

    const replayMessages = buildReplayMessages(sourceMessages, sessionId);

    return ok(replayMessages);
  });
}
