import { type AIGatewayModel } from "@instrument-org/ai-gateway";

import { type AgentName } from "../agents/types";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { getToolByType } from "../tools/all";
import { type AppConfig } from "./app-config/types";
import { getCurrentDate } from "./get-current-date";
import { getProjectState } from "./project-state-store";
import { type SpawnAgentFunction } from "./spawn-agent";
import { Store } from "./store";
import { streamTool } from "./stream-tool";

export async function runToolCall({
  agentName,
  appConfig,
  model,
  part,
  sessionId,
  signal,
  spawnAgent,
}: {
  agentName: AgentName;
  appConfig: AppConfig;
  model: AIGatewayModel.Type;
  part: SessionMessagePart.ToolPartInputAvailable;
  sessionId: StoreId.Session;
  signal: AbortSignal;
  spawnAgent: SpawnAgentFunction;
}) {
  const tool = getToolByType(part.type);
  let preliminarySaved = false;

  try {
    const projectState = await getProjectState(appConfig.appDir);

    for await (const { output, type } of streamTool({
      execute: tool.execute,
      options: {
        agentName,
        appConfig,
        input: part.input as never,
        messageId: part.metadata.messageId,
        model,
        partId: part.metadata.id,
        projectState,
        sessionId,
        signal,
        spawnAgent,
      },
    })) {
      if (signal.aborted) {
        return { preliminarySaved };
      }

      const ids = {
        messageId: part.metadata.messageId,
        partId: part.metadata.id,
        sessionId,
      };

      if (type === "preliminary") {
        if (output.isOk()) {
          await Store.updatePart(
            ids,
            (current) =>
              ({
                ...current,
                metadata: { ...current.metadata, endedAt: getCurrentDate() },
                output: output.value as never,
                preliminary: true,
                state: "output-available",
              }) as SessionMessagePart.Type,
            appConfig,
            { signal },
          );
          preliminarySaved = true;
        }
      } else {
        await (output.isOk()
          ? Store.updatePart(
              ids,
              (current) =>
                ({
                  ...current,
                  metadata: {
                    ...current.metadata,
                    endedAt: getCurrentDate(),
                  },
                  output: output.value as never,
                  preliminary: false,
                  state: "output-available",
                }) as SessionMessagePart.Type,
              appConfig,
              { signal },
            )
          : Store.updatePart(
              ids,
              (current) =>
                ({
                  ...current,
                  errorText: output.error.message,
                  metadata: {
                    ...current.metadata,
                    endedAt: getCurrentDate(),
                  },
                  state: "output-error",
                }) as SessionMessagePart.Type,
              appConfig,
              { signal },
            ));
        appConfig.workspaceConfig.captureEvent("llm.tool_executed", {
          success: output.isOk(),
          tool_name: part.type,
        });
      }
    }
  } catch (error) {
    if (signal.aborted) {
      return { preliminarySaved };
    }
    await Store.updatePart(
      {
        messageId: part.metadata.messageId,
        partId: part.metadata.id,
        sessionId,
      },
      (current) =>
        ({
          ...current,
          errorText: `Something went wrong while running '${part.type}': ${error instanceof Error ? error.message : "An unexpected error occurred"}`,
          metadata: {
            ...current.metadata,
            endedAt: getCurrentDate(),
          },
          state: "output-error",
        }) as SessionMessagePart.Type,
      appConfig,
      { signal },
    );
  }

  return { preliminarySaved };
}
