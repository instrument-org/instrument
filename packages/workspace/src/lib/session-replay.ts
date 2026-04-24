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
import { updateProjectManifest } from "./project-manifest";
import { runToolCall } from "./run-tool-call";
import { type SpawnAgentFunction } from "./spawn-agent";
import { Store } from "./store";

const DEFAULT_TEMPLATE_NAME = "basic";

export interface ReplayMessage {
  allParts: SessionMessagePart.Type[];
  message: SessionMessage.WithParts;
  toolPartsToExecute: SessionMessagePart.ToolPartInputAvailable[];
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

  for (const { allParts, message, toolPartsToExecute } of replayMessages) {
    if (signal.aborted) {
      return;
    }

    await Store.saveMessage(message, appConfig, { signal });

    if (delayMs > 0) {
      await delay();
    }

    const toolPartById = new Map(
      toolPartsToExecute.map((p) => [p.metadata.id, p]),
    );

    for (const part of allParts) {
      await Store.savePart(part, appConfig, { signal });

      const toolPart = toolPartById.get(part.metadata.id);
      if (toolPart) {
        await runToolCall({
          agentName,
          appConfig,
          model,
          part: toolPart,
          sessionId,
          signal,
          spawnAgent,
        });
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
      { projectConfig, templateName: DEFAULT_TEMPLATE_NAME, workspaceConfig },
      { signal },
    );

    yield* await updateProjectManifest(projectConfig, {
      name: `Replay of ${sourceProjectName}`,
    });

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
    const toolPartsToExecute: SessionMessagePart.ToolPartInputAvailable[] = [];
    const staticParts: SessionMessagePart.Type[] = [];

    for (const sourcePart of sourceMessage.parts) {
      const newPartId = StoreId.newPartId();
      const newMetadata = {
        ...sourcePart.metadata,
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
        const inputPart = {
          ...sourcePart,
          metadata: newMetadata,
          state: "input-available" as const,
        } as SessionMessagePart.ToolPartInputAvailable;
        staticParts.push(inputPart);
        toolPartsToExecute.push(inputPart);
      } else {
        staticParts.push({
          ...sourcePart,
          metadata: newMetadata,
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

    result.push({
      allParts: staticParts,
      message: newMessage,
      toolPartsToExecute,
    });
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
