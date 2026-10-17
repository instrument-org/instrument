import { type AIGatewayModel } from "@instrument-org/ai-gateway";

import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { getToolByType } from "../tools/all";
import { ChatWrites } from "./chat-writes";
import { getCurrentDate } from "./get-current-date";
import { streamTool } from "./stream-tool";

export async function runToolCall({
  model,
  part,
  sessionId,
  signal,
  chatId,
}: {
  model: AIGatewayModel.Type;
  part: SessionMessagePart.ToolPartInputAvailable;
  sessionId: StoreId.Session;
  signal: AbortSignal;
  chatId: ChatId;
}) {
  const tool = getToolByType(part.type);

  try {
    // Marks the call as executing rather than waiting its turn. Written before
    // anything else so the transcript can show which of a batch of calls is the
    // one actually running.
    await ChatWrites.updatePart(
      {
        chatId,
        messageId: part.metadata.messageId,
        partId: part.metadata.id,
        sessionId,
      },
      (current) =>
        ({
          ...current,
          metadata: { ...current.metadata, startedAt: getCurrentDate() },
        }) as SessionMessagePart.Type,
    );

    for await (const { output, type } of streamTool({
      execute: tool.execute,
      options: {
        input: part.input as never,
        messageId: part.metadata.messageId,
        model,
        partId: part.metadata.id,
        sessionId,
        signal,
        chatId,
      },
    })) {
      if (signal.aborted) {
        return;
      }

      const ids = {
        chatId,
        messageId: part.metadata.messageId,
        partId: part.metadata.id,
        sessionId,
      };

      if (type === "preliminary") {
        if (output.isOk()) {
          await ChatWrites.updatePart(
            ids,
            (current) =>
              ({
                ...current,
                metadata: { ...current.metadata, endedAt: getCurrentDate() },
                output: output.value as never,
                preliminary: true,
                state: "output-available",
              }) as SessionMessagePart.Type,
          );
        }
      } else {
        await (output.isOk()
          ? ChatWrites.updatePart(
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
            )
          : ChatWrites.updatePart(
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
            ));
      }
    }
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    await ChatWrites.updatePart(
      {
        chatId,
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
    );
  }
}
