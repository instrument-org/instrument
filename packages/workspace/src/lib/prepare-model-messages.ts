import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { differenceInMinutes } from "date-fns";
import { err, ok, Result } from "neverthrow";
import { alphabetical } from "radashi";

import { type AnyAgent } from "../agents/types";
import { SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { TOOLS_FOR_MODEL_OUTPUT } from "../tools/all";
import { addCacheControlToMessages } from "./add-cache-control";
import {
  computeContextBudget,
  contextOccupancyFromMessages,
} from "./context-budget";
import { contextBudgetNotice } from "./context-budget-notice";
import { dropTrailingFailedMessages } from "./drop-trailing-failed-messages";
import { effectiveContextLength } from "./effective-context-length";
import { filterUnsupportedMedia } from "./filter-unsupported-media";
import { normalizeModelImages } from "./normalize-model-images";
import { normalizeToolCallIds } from "./normalize-tool-call-ids";
import { removeCrossModelReasoningDetails } from "./remove-cross-model-reasoning-details";
import { sanitizeModelText } from "./sanitize-model-text";
import { splitMultipartToolResults } from "./split-multipart-tool-results";
import { Store } from "./store";
import { getWorkspaceConfig } from "./workspace-config";

const STALE_MESSAGE_THRESHOLD_MINUTES = 60;

export async function prepareModelMessages({
  agent,
  model,
  sessionId,
  signal,
  taskId,
}: {
  agent: AnyAgent;
  model: AIGatewayModel.Type;
  sessionId: StoreId.Session;
  signal: AbortSignal;
  taskId: TaskId;
}) {
  const messageResults = await Store.getMessagesWithParts(
    { sessionId, taskId },
    { signal },
  );

  // Every failure is re-wrapped rather than returned as it came. A neverthrow
  // `Err` carries the success type of the result it came from, so passing the
  // store's along would leave this function's success type a union of model
  // messages and stored ones, and a caller free to read the wrong shape.
  if (messageResults.isErr()) {
    return err(messageResults.error);
  }
  const messages = messageResults.value;

  function isSessionContextMessage(
    message: SessionMessage.WithParts,
  ): message is SessionMessage.ContextWithParts {
    return message.role === "session-context";
  }

  const existingSessionContextMessages = messages.filter(
    isSessionContextMessage,
  );

  const nonContextMessages = messages.filter(
    (message) => !isSessionContextMessage(message),
  );

  let contextMessages: SessionMessage.ContextWithParts[];

  async function createAndSaveContextMessages() {
    const newContextMessages = await agent.getMessages({
      sessionId,
      taskId,
    });

    const saveResults = await Promise.all(
      newContextMessages.map((message) =>
        Store.saveMessageWithParts(message, taskId, { signal }),
      ),
    );

    const combinedResult = Result.combine(saveResults);
    if (combinedResult.isErr()) {
      return err(combinedResult.error);
    }

    return ok(newContextMessages);
  }

  if (existingSessionContextMessages.length > 0) {
    const now = new Date();
    const hasStaleMessage = existingSessionContextMessages.some(
      (message) =>
        differenceInMinutes(now, message.metadata.createdAt) >
        STALE_MESSAGE_THRESHOLD_MINUTES,
    );

    if (hasStaleMessage) {
      for (const existingMessage of existingSessionContextMessages) {
        const removeResult = await Store.removeMessage(
          existingMessage.id,
          existingMessage.metadata.sessionId,
          taskId,
          { signal },
        );

        if (removeResult.isErr()) {
          return err(removeResult.error);
        }
      }

      const createResult = await createAndSaveContextMessages();
      if (createResult.isErr()) {
        return err(createResult.error);
      }
      contextMessages = createResult.value;
    } else {
      contextMessages = existingSessionContextMessages;
    }
  } else {
    const createResult = await createAndSaveContextMessages();
    if (createResult.isErr()) {
      return err(createResult.error);
    }
    contextMessages = createResult.value;
  }

  const orderedMessages = dropTrailingFailedMessages([
    // ulid sorts oldest to newest
    ...alphabetical(contextMessages, (message) => message.id),
    ...alphabetical(nonContextMessages, (message) => message.id),
  ]);

  const portableMessagesResult = removeCrossModelReasoningDetails({
    messages: orderedMessages,
    model,
  });

  if (portableMessagesResult.redactedReasoningDetailsCount > 0) {
    getWorkspaceConfig().captureEvent("llm.reasoning_details_redacted", {
      modelId: model.canonicalId,
      providerId: model.params.provider,
      redacted_message_count: portableMessagesResult.redactedMessageCount,
      redacted_reasoning_details_count:
        portableMessagesResult.redactedReasoningDetailsCount,
      source_model_ids: portableMessagesResult.sourceModelIds,
      source_provider_ids: portableMessagesResult.sourceProviderIds,
    });
  }

  // Including all tools so they can run their toModelOutput even if they are
  // not used in this session
  const modelMessages = await SessionMessage.toModelMessages(
    portableMessagesResult.messages,
    TOOLS_FOR_MODEL_OUTPUT,
  );

  const nonEmptyModelMessages = modelMessages.filter(
    (message) => message.content.length > 0 || Boolean(message.providerOptions),
  );

  // AI SDK requires system messages to be first for some providers
  const modelMessagesWithSystemFirst = nonEmptyModelMessages.sort((a, b) =>
    a.role === "system" ? -1 : b.role === "system" ? 1 : 0,
  );

  const splitMessages = splitMultipartToolResults({
    messages: modelMessagesWithSystemFirst,
    provider: model.params.provider,
  });

  const filteredMessages = await filterUnsupportedMedia({
    messages: splitMessages,
    model,
  });

  // After filtering, so we never spend a resize on an image this model was
  // going to have stripped anyway; before cache control, because the cache
  // breakpoints have to be placed over the bytes we actually send.
  const normalizedMessages = await normalizeModelImages({
    messages: filteredMessages,
    signal,
  });

  const cachedModelMessages = addCacheControlToMessages({
    messages: await sanitizeModelText(normalizedMessages),
    model,
  });

  const preparedMessages = normalizeToolCallIds({
    messages: cachedModelMessages,
    model,
  });

  // Appended last, after the cache breakpoints have been placed, so a notice
  // whose numbers move every turn sits behind the cached prefix instead of
  // rewriting it. Nothing here is saved: the notice is recomputed from the
  // budget on each request, so it disappears on its own once there is room
  // again and never accumulates in the transcript.
  const notice = contextBudgetNotice(
    computeContextBudget({
      contextLength: effectiveContextLength(model),
      occupied: contextOccupancyFromMessages(messages),
    }),
  );

  if (notice !== undefined) {
    preparedMessages.push({ content: notice, role: "user" });
  }

  return ok(preparedMessages);
}
