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
  contextRolloverBoundaryInForce,
  contextRolloverWouldReclaim,
} from "./apply-context-rollover";
import {
  computeContextBudget,
  contextOccupancyFromMessages,
  usableContextTokens,
} from "./context-budget";
import { contextBudgetNotice } from "./context-budget-notice";
import { contextOverflowNeedsRollover } from "./context-overflow";
import { dropTrailingFailedMessages } from "./drop-trailing-failed-messages";
import { effectiveContextLength } from "./effective-context-length";
import { filterUnsupportedMedia } from "./filter-unsupported-media";
import { contextRolloverNotice, readHandoffNotes } from "./handoff-notes";
import { modelChangeSincePreviousTurn } from "./model-change";
import { normalizeModelImages } from "./normalize-model-images";
import { normalizeToolCallIds } from "./normalize-tool-call-ids";
import { removeCrossModelReasoningDetails } from "./remove-cross-model-reasoning-details";
import { sanitizeModelText } from "./sanitize-model-text";
import { splitMultipartToolResults } from "./split-multipart-tool-results";
import { Store } from "./store";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The shape of the session baseline this build writes.
 *
 * Bump it whenever `agent.getMessages` starts producing something a session
 * that already has a baseline stored would otherwise never see. Without a bump
 * such a session keeps the baseline it was opened with for the rest of its
 * life, and the capability the release added is simply missing from every task
 * that predates it.
 */
export const SESSION_CONTEXT_VERSION = 1;

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
  const session = sessionResult.isOk() ? sessionResult.value : undefined;

  const contextLength = effectiveContextLength(model);
  const usable = usableContextTokens(contextLength);

  // Recorded before anything is measured or reset, so the transcript says the
  // model moved even on a turn that then fails. Attached to the newest message
  // the task has, which is the turn the new model is about to answer.
  const modelChange = modelChangeSincePreviousTurn({
    messages: allNonContextMessages,
    model,
  });
  const newestMessage = allNonContextMessages.at(-1);

  if (
    modelChange &&
    newestMessage &&
    !newestMessage.parts.some((part) => part.type === "data-modelChange")
  ) {
    await Store.savePart(
      {
        data: modelChange,
        metadata: {
          createdAt: new Date(),
          id: StoreId.newPartId(),
          messageId: newestMessage.id,
          sessionId,
        },
        type: "data-modelChange",
      },
      taskId,
      { signal },
    );
  }

  // Asked on every request rather than read straight off the session, so a
  // boundary drawn when a smaller model ran out stops narrowing the history
  // once a model with room for it is the one being asked.
  const rolledOverAfterMessageId = contextRolloverBoundaryInForce({
    rolledOverAfterMessageId: session?.rolledOverAfterMessageId,
    rolledOverUnderUsableTokens: session?.rolledOverUnderUsableTokens,
    usable,
  });

  let nonContextMessages = applyContextRollover({
    messages: allNonContextMessages,
    rolledOverAfterMessageId,
  });

  let budget = computeContextBudget({
    contextLength,
    modelId: model.canonicalId,
    occupancy: contextOccupancyFromMessages(nonContextMessages),
  });

  // A rollover spends history, so the verdict it acts on has to be a count this
  // model reported. On the first turn after a switch the newest count came from
  // the model before it, measured by a different tokenizer against a different
  // window, and a roomy model's count held against a smaller one's window reads
  // as exhausted whether or not it is. That is enough to warn the agent while
  // it can still write handoff notes, which is the entire mechanism for
  // carrying a task across a reset, and not enough to reset on. One turn later
  // the current model has reported its own count and the ordinary path applies.
  //
  // Unless the provider refused the request for size, which is the case the
  // deferral cannot survive on its own: a refused turn reports no usage, so the
  // next turn reads the same carried-over count, defers again, and sends the
  // same oversized request forever. A refusal is also the only evidence of a
  // ceiling that a model with no reported window ever produces, and it is
  // bounded to one reset per refusal for the reason given where it is read.
  //
  // Read from the messages inside the current window, like occupancy and for
  // the same reason: a refusal an earlier reset already answered sits before
  // that boundary, and reading past it would reset the session again on every
  // turn over a request nothing is sending any more.
  const rolloverIsWarranted =
    (budget.status === "exhausted" && budget.occupancySource === "measured") ||
    contextOverflowNeedsRollover(nonContextMessages);

  if (rolloverIsWarranted && contextRolloverWouldReclaim(nonContextMessages)) {
    // Reset here rather than after assembling, so the request this call is
    // building is the smaller one. The boundary is the newest message the task
    // has: everything before it stops being sent, the user's own messages are
    // carried across, and the task continues in the same session rather than
    // failing the turn.
    const newest = allNonContextMessages.at(-1);

    // Applied before it is recorded, so what gets written down is a boundary
    // that demonstrably changed the request rather than one that only should
    // have. A boundary that drops nothing is not a smaller request by any
    // amount; recording it would leave the session marked as having reset while
    // sending exactly what it sent before, and the mark is what stops the next
    // turn trying again.
    const narrowed =
      newest === undefined
        ? undefined
        : applyContextRollover({
            messages: allNonContextMessages,
            rolledOverAfterMessageId: newest.id,
          });

    if (
      newest &&
      session &&
      narrowed &&
      narrowed.length < allNonContextMessages.length
    ) {
      const saveResult = await Store.saveSession(
        {
          ...session,
          rolledOverAfterMessageId: newest.id,
          rolledOverUnderUsableTokens: usable,
        },
        taskId,
        { signal },
      );

      // A boundary we could not record is one that would not survive the next
      // turn, so the session keeps the history it had. The request may well be
      // refused for size, which is the behavior this feature is replacing
      // rather than a regression it introduces.
      if (saveResult.isOk()) {
        nonContextMessages = narrowed;
        budget = computeContextBudget({
          contextLength,
          modelId: model.canonicalId,
          occupancy: contextOccupancyFromMessages(nonContextMessages),
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
  //
  // The one thing that does rewrite it is a build whose baseline holds
  // something the stored one cannot: the marker each message carries says which
  // shape it was written under, and a baseline older than this build's is
  // replaced on the first turn after the upgrade and then reused like any
  // other. So the prefix moves once per shape change, and never on a clock. A
  // marker from ahead of this build is left alone, since an older release
  // running against a newer baseline has nothing better to put there.
  let contextMessages = existingSessionContextMessages;

  const hasOutdatedBaseline = contextMessages.some(
    (message) =>
      (message.metadata.contextVersion ?? 0) < SESSION_CONTEXT_VERSION,
  );

  if (contextMessages.length === 0 || hasOutdatedBaseline) {
    // Replaced rather than added to: two baselines in the store are two
    // baselines in every later request, and the superseded one would keep being
    // sent for the rest of the session.
    for (const message of contextMessages) {
      const removeResult = await Store.removeMessage(
        message.id,
        message.metadata.sessionId,
        taskId,
        { signal },
      );

      if (removeResult.isErr()) {
        return err(removeResult.error);
      }
    }

    const builtContextMessages = await agent.getMessages({
      sessionId,
      taskId,
    });

    const newContextMessages = builtContextMessages.map((message) => ({
      ...message,
      metadata: {
        ...message.metadata,
        contextVersion: SESSION_CONTEXT_VERSION,
      },
    }));

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
  // Any history narrower than what the task holds is one a boundary was placed
  // in, which is the same test whether the boundary was recorded a moment ago
  // in this call or on an earlier turn. A boundary naming a message this
  // session no longer has drops nothing, and correctly says nothing here.
  //
  // Said on every request from here on rather than once at the cut: what is
  // missing stays missing, and the turn that needs to recover from it is rarely
  // the first one after.
  if (nonContextMessages.length < allNonContextMessages.length) {
    preparedMessages.push({
      content: contextRolloverNotice(await readHandoffNotes(taskId)),
      role: "user",
    });
  }

  // After the rollover notice: that one says what the window is missing and
  // hands back the notes, and this one says how much room what remains has
  // left. Read the other way around, the instruction to write notes arrives
  // before the agent has been given the ones it already wrote.
  const notice = contextBudgetNotice(budget);

  if (notice !== undefined) {
    preparedMessages.push({ content: notice, role: "user" });
  }

  return ok(preparedMessages);
}
