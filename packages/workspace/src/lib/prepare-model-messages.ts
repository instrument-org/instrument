import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { err, ok, Result } from "neverthrow";
import { alphabetical } from "radashi";

import { type AnyAgent } from "../agents/types";
import { SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { TOOLS_FOR_MODEL_OUTPUT } from "../tools/all";
import { addCacheControlToMessages } from "./add-cache-control";
import {
  applyContextRollover,
  contextRolloverWouldReclaim,
} from "./apply-context-rollover";
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

  const allNonContextMessages = messages.filter(
    (message) => !isSessionContextMessage(message),
  );

  // The window this task is actually running in. Read before anything is
  // measured, because occupancy has to come from turns inside the current
  // window: a reported count from before a reset describes a request that is no
  // longer being sent, and taking it at face value would roll the session over
  // again on every turn, eating another slice of history each time.
  const sessionResult = await Store.getSession(sessionId, taskId, { signal });
  const rolledOverAfterMessageId = sessionResult.isOk()
    ? sessionResult.value.rolledOverAfterMessageId
    : undefined;

  let nonContextMessages = applyContextRollover({
    messages: allNonContextMessages,
    rolledOverAfterMessageId,
  });

  let budget = computeContextBudget({
    contextLength: effectiveContextLength(model),
    occupied: contextOccupancyFromMessages(nonContextMessages),
  });

  if (
    budget.status === "exhausted" &&
    contextRolloverWouldReclaim(nonContextMessages)
  ) {
    // Reset here rather than after assembling, so the request this call is
    // building is the smaller one. The boundary is the newest message the task
    // has: everything before it stops being sent, the user's own messages are
    // carried across, and the task continues in the same session rather than
    // failing the turn.
    const newest = allNonContextMessages.at(-1);
    const session = sessionResult.isOk() ? sessionResult.value : undefined;

    if (newest && session) {
      const saveResult = await Store.saveSession(
        { ...session, rolledOverAfterMessageId: newest.id },
        taskId,
        { signal },
      );

      // A boundary we could not record is one that would not survive the next
      // turn, so the session keeps the history it had. The request may well be
      // refused for size, which is the behavior this feature is replacing
      // rather than a regression it introduces.
      if (saveResult.isOk()) {
        nonContextMessages = applyContextRollover({
          messages: allNonContextMessages,
          rolledOverAfterMessageId: newest.id,
        });
        budget = computeContextBudget({
          contextLength: effectiveContextLength(model),
          occupied: contextOccupancyFromMessages(nonContextMessages),
        });

        // Written here, behind the same successful save, so the mark in the
        // transcript and the boundary assembly reads are recorded together or
        // not at all. A failed part leaves the rollover itself intact: the
        // session is still correct, it is only undrawn.
        await Store.savePart(
          {
            data: {
              droppedMessages:
                allNonContextMessages.length - nonContextMessages.length,
              retainedUserMessages: nonContextMessages.length,
            },
            metadata: {
              createdAt: new Date(),
              id: StoreId.newPartId(),
              messageId: newest.id,
              sessionId,
            },
            type: "data-contextRollover",
          },
          taskId,
          { signal },
        );
      }
    }
  }

  // The session's baseline: built once, when the session first needs model
  // input, and reused verbatim for the rest of the session. Rebuilding it later
  // would rewrite the front of every subsequent request -- the bytes a provider
  // cache is keyed on -- to restate facts that mostly did not change. Values
  // that do change reach the model as append-only corrections on the user turn
  // where they were detected instead (see `SessionMessage.toModelMessages`).
  let contextMessages = existingSessionContextMessages;

  if (contextMessages.length === 0) {
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

    contextMessages = newContextMessages;
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
  const notice = contextBudgetNotice(budget);

  if (notice !== undefined) {
    preparedMessages.push({ content: notice, role: "user" });
  }

  return ok(preparedMessages);
}
