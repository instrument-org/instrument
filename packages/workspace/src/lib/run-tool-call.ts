import { type AIGatewayModel } from "@instrument-org/ai-gateway";

import { type AgentName } from "../agents/types";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { getToolByType } from "../tools/all";
import { taskDir } from "./app-dir-utils";
import { getCurrentDate } from "./get-current-date";
import { getTaskState } from "./task-state-store";
import { type SpawnAgentFunction } from "./spawn-agent";
import { Store } from "./store";
import { streamTool } from "./stream-tool";
import { getWorkspaceConfig } from "./workspace-config";

export async function runToolCall({
  agentName,
  model,
  part,
  sessionId,
  signal,
  spawnAgent,
  taskId,
}: {
  agentName: AgentName;
  model: AIGatewayModel.Type;
  part: SessionMessagePart.ToolPartInputAvailable;
  sessionId: StoreId.Session;
  signal: AbortSignal;
  spawnAgent: SpawnAgentFunction;
  taskId: TaskId;
}) {
  const tool = getToolByType(part.type);
  let preliminarySaved = false;

  try {
    const projectState = await getTaskState(taskDir(taskId));

    for await (const { output, type } of streamTool({
      execute: tool.execute,
      options: {
        agentName,
        input: part.input as never,
        messageId: part.metadata.messageId,
        model,
        partId: part.metadata.id,
        projectState,
        sessionId,
        signal,
        spawnAgent,
        taskId,
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
            taskId,
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
              taskId,
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
              taskId,
              { signal },
            ));
        getWorkspaceConfig().captureEvent("llm.tool_executed", {
          modelId: model.canonicalId,
          providerId: model.params.provider,
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
      taskId,
      { signal },
    );
  }

  return { preliminarySaved };
}
