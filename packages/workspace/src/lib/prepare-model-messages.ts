import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { type ModelMessage } from "ai";
import { err, ok, type Result } from "neverthrow";
import { alphabetical } from "radashi";

import { type AnyAgent } from "../agents/types";
import { type Session } from "../schemas/session";
import { SessionMessage } from "../schemas/session/message";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { TOOLS_FOR_MODEL_OUTPUT } from "../tools/all";
import { addCacheControlToMessages } from "./add-cache-control";
import { ChatReads } from "./chat-reads";
import { chatAttachmentsDir } from "./chat-dir-utils";
import {
  applyContextRollover,
  contextRolloverWouldReclaim,
  rolloverWindowDecision,
} from "./apply-context-rollover";
import {
  computeContextBudget,
  contextOccupancyFromMessages,
  usableContextTokens,
} from "./context-budget";
import { ChatWrites } from "./chat-writes";
import { contextBudgetNotice } from "./context-budget-notice";
import { contextOverflowNeedsRollover } from "./context-overflow";
import {
  dropRetriedFailedMessages,
  dropTrailingFailedMessages,
} from "./drop-trailing-failed-messages";
import { effectiveContextLength } from "./effective-context-length";
import { filterUnsupportedMedia } from "./filter-unsupported-media";
import {
  agentHandoffNotesPath,
  agentTranscriptPath,
  contextRolloverNotice,
  readHandoffNotes,
} from "./handoff-notes";
import { modelChangeSincePreviousTurn } from "./model-change";
import { modelWindow } from "./model-window";
import { limitModelImages } from "./limit-model-images";
import { normalizeModelImages } from "./normalize-model-images";
import { normalizeToolCallIds } from "./normalize-tool-call-ids";
import { chatDir } from "./record-folders";
import { removeCrossModelReasoningDetails } from "./remove-cross-model-reasoning-details";
import { sanitizeModelText } from "./sanitize-model-text";
import { sessionBaseline } from "./session-baseline";
import { splitMultipartToolResults } from "./split-multipart-tool-results";
import { clearOldToolResults } from "./tool-result-clearing";
import { shellPath } from "./workspace-fs-layout";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The session with a verdict for `model` on its rollover boundary, recorded
 * the first time that model is asked with a window this process knows; as
 * it was when there is no boundary, a verdict is already recorded, or the
 * window is unknown (the boundary holds meanwhile). A verdict that cannot be
 * recorded is not acted on, so the request reads only what is stored.
 */
async function withRolloverDecision({
  chatId,
  model,
  session,
  usable,
}: {
  chatId: ChatId;
  model: string;
  session: Session.Type | undefined;
  usable: number | undefined;
}): Promise<Session.Type | undefined> {
  if (
    session?.rolledOverAfterMessageId === undefined ||
    session.rolloverWindows?.[model] !== undefined
  ) {
    return session;
  }
  const decision = rolloverWindowDecision({
    rolledOverUnderUsableTokens: session.rolledOverUnderUsableTokens,
    usable,
  });
  if (decision === undefined) {
    return session;
  }
  const decided = {
    ...session,
    rolloverWindows: { ...session.rolloverWindows, [model]: decision },
  };
  const saved = await ChatWrites.saveSession(decided, chatId);
  return saved.isOk() ? decided : session;
}

/**
 * Marks a message said for this request only and kept nowhere. A model that
 * keeps its own copy of the conversation (a Claude account's Claude Code)
 * sends it with the turn but does not count it as part of what it has seen,
 * since the next request leaves it out or says it differently.
 */
export const TRANSIENT = { instrument: { transient: true } };

/**
 * The summary written for the rollover at `boundary`, read from the part
 * that marks it, so every request after it sends the same one.
 */
function rolloverSummary(
  history: readonly SessionMessage.WithParts[],
  boundary: StoreId.Message | undefined,
  chatId: ChatId,
): { summary: string; transcriptPath: string | undefined } | undefined {
  const part = history
    .find((message) => message.id === boundary)
    ?.parts.find((candidate) => candidate.type === "data-contextRollover");
  return part?.type === "data-contextRollover" &&
    part.data.summary !== undefined
    ? {
        summary: part.data.summary,
        transcriptPath: agentTranscriptPath(chatId),
      }
    : undefined;
}

/**
 * A rollover recorded at the newest message the session has: everything
 * before it stops being sent, the user's own messages are carried across,
 * and a `data-contextRollover` part marks the cut, with the summary when one
 * was written. Returns the boundary and the history sent from it, or
 * undefined when nothing was recorded, which leaves the session as it was.
 */
async function recordRollover({
  chatId,
  history,
  model,
  sessionId,
  summary,
  usable,
}: {
  chatId: ChatId;
  /** Every stored message the session is sent from, oldest first. */
  history: readonly SessionMessage.WithParts[];
  model: AIGatewayModel.Type;
  sessionId: StoreId.Session;
  summary:
    | {
        summary: string;
        usage: SessionMessageDataPart.ContextRolloverDataPart["summaryUsage"];
      }
    | undefined;
  usable: number | undefined;
}): Promise<
  | { boundary: StoreId.Message; narrowed: SessionMessage.WithParts[] }
  | undefined
> {
  const newest = history.at(-1);

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
          messages: history,
          rolledOverAfterMessageId: newest.id,
        });
  if (!newest || !narrowed || narrowed.length >= history.length) {
    return undefined;
  }

  // The row is read here rather than taken from the boundary read before,
  // because the row is what is written: the store is still what keeps a
  // session, and a row written from anything but itself would carry the
  // other side's answer for every field the boundary is not.
  const stored = await ChatReads.session({ chatId, sessionId });
  const saveResult = await stored.asyncAndThen((row) =>
    ChatWrites.saveSession(
      {
        ...row,
        rolledOverAfterMessageId: newest.id,
        rolledOverUnderUsableTokens: usable,
        // A new boundary drops the verdicts on the last one; this model's
        // is that it holds, since it was drawn under this window.
        rolloverWindows:
          usable === undefined
            ? undefined
            : {
                [model.canonicalId]: {
                  lifted: false,
                  usableTokens: usable,
                },
              },
      },
      chatId,
    ),
  );

  // A boundary we could not record is one that would not survive the next
  // turn, so the session keeps the history it had. The request may well be
  // refused for size, which is the behavior this feature is replacing
  // rather than a regression it introduces.
  if (saveResult.isErr()) {
    return undefined;
  }

  // Written here, behind the same successful save, so the mark in the
  // transcript and the boundary assembly reads are recorded together or
  // not at all. A failed part leaves the rollover itself intact: the
  // session is still correct, it is only undrawn, and memory told on a
  // message the cut dropped is not told again (`lastToldMemory` reads
  // the window from this mark).
  await ChatWrites.savePart(
    {
      data: {
        droppedMessages: history.length - narrowed.length,
        retainedUserMessages: narrowed.length,
        ...(summary !== undefined && {
          summary: summary.summary,
          summaryUsage: summary.usage,
        }),
      },
      metadata: {
        createdAt: new Date(),
        id: StoreId.newPartId(),
        messageId: newest.id,
        sessionId,
      },
      type: "data-contextRollover",
    },
    chatId,
  );
  return { boundary: newest.id, narrowed };
}

export async function prepareModelMessages({
  agent,
  model,
  sessionId,
  signal,
  chatId,
  summarize,
}: {
  agent: AnyAgent;
  model: AIGatewayModel.Type;
  sessionId: StoreId.Session;
  signal: AbortSignal;
  chatId: ChatId;
  /**
   * Asks the model for a summary of the conversation in `messages`, the
   * request as it would be sent, for a rollover taken before the request
   * reaches the model's price step. Undefined, or no summary, and none is
   * taken.
   */
  summarize?: (messages: ModelMessage[]) => Promise<
    | {
        summary: string;
        usage: SessionMessageDataPart.ContextRolloverDataPart["summaryUsage"];
      }
    | undefined
  >;
}): Promise<Result<ModelMessage[], unknown>> {
  const contextLength = effectiveContextLength(model);
  const usable = usableContextTokens(contextLength);

  // The window this task is actually running in, read before anything is
  // measured, because occupancy has to come from turns inside the current
  // window: a reported count from before a reset describes a request that is no
  // longer being sent, and taking it at face value would roll the session over
  // again on every turn, eating another slice of history each time. Whether a
  // boundary holds for this model is decided the first time it is asked and
  // recorded with the boundary, so every request after reads the same answer
  // whatever this process knows of the window then (`rolloverWindowDecision`).
  const session = await withRolloverDecision({
    chatId,
    model: model.canonicalId,
    session: await ChatReads.session({ chatId, sessionId }).unwrapOr(undefined),
    usable,
  });

  const messageResults = await ChatReads.modelHistory({
    chatId,
    model: model.canonicalId,
    sessionId,
  });

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

  const storedNonContextMessages = messages.filter(
    (message) => !isSessionContextMessage(message),
  );

  // Recorded before anything is measured or reset, so the transcript says the
  // model moved even on a turn that then fails. Attached to the newest message
  // the task has, which is the turn the new model is about to answer, and to
  // this request's copy of it too, so the model is told on the turn it starts
  // answering rather than one turn late.
  const modelChange = modelChangeSincePreviousTurn({
    messages: storedNonContextMessages,
    model,
  });
  const newestMessage = storedNonContextMessages.at(-1);
  let modelChangePart: SessionMessagePart.DataPart | undefined;

  if (
    modelChange &&
    newestMessage &&
    !newestMessage.parts.some((part) => part.type === "data-modelChange")
  ) {
    modelChangePart = {
      data: modelChange,
      metadata: {
        createdAt: new Date(),
        id: StoreId.newPartId(),
        messageId: newestMessage.id,
        sessionId,
      },
      type: "data-modelChange",
    };
    await ChatWrites.savePart(modelChangePart, chatId);
  }

  const allNonContextMessages =
    modelChangePart === undefined
      ? storedNonContextMessages
      : storedNonContextMessages.map((message) =>
          message === newestMessage
            ? { ...message, parts: [...message.parts, modelChangePart] }
            : message,
        );

  // A boundary drawn when a smaller model ran out stops narrowing the history
  // once a model with room for it is the one being asked, as recorded above.
  const sent = modelWindow({
    messages: allNonContextMessages,
    model: model.canonicalId,
    session,
  });
  let rolledOverAfterMessageId = sent.after;
  let nonContextMessages = sent.messages;

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
    // building is the smaller one, and the task continues in the same session
    // rather than failing the turn.
    const rolled = await recordRollover({
      chatId,
      history: allNonContextMessages,
      model,
      sessionId,
      summary: undefined,
      usable,
    });
    if (rolled !== undefined) {
      rolledOverAfterMessageId = rolled.boundary;
      nonContextMessages = rolled.narrowed;
      budget = computeContextBudget({
        contextLength,
        modelId: model.canonicalId,
        occupancy: contextOccupancyFromMessages(nonContextMessages),
      });
    }
  }

  // The front of every request, written once and read back verbatim; see
  // `session-baseline.ts` for the few times it is written again.
  const baselineResult = await sessionBaseline({
    agent,
    chatId,
    contextMessages: existingSessionContextMessages,
    model,
    rolledOverAfterMessageId,
    sessionId,
  });
  if (baselineResult.isErr()) {
    return err(baselineResult.error);
  }
  const contextMessages = baselineResult.value;

  const orderedMessages = dropTrailingFailedMessages(
    dropRetriedFailedMessages([
      // ulid sorts oldest to newest
      ...alphabetical(contextMessages, (message) => message.id),
      ...alphabetical(nonContextMessages, (message) => message.id),
    ]),
  );

  const portableMessagesResult = removeCrossModelReasoningDetails({
    messages: orderedMessages,
    model,
  });

  // Including all tools so they can run their toModelOutput even if they are
  // not used in this session
  const modelMessages = await SessionMessage.toModelMessages(
    portableMessagesResult.messages,
    TOOLS_FOR_MODEL_OUTPUT,
    {
      attachmentsDir: shellPath(chatAttachmentsDir(chatDir(chatId))),
      shellPath,
      workspaceRoot: getWorkspaceConfig().rootDir,
    },
  );

  // Sized from what each result is sent as, before any of it is filtered or
  // resized, so the bytes a clearing replaces are the ones it measured.
  const cleared = await clearOldToolResults({
    chatId,
    messages: nonContextMessages,
    model,
    modelMessages,
    sessionId,
  });

  const nonEmptyModelMessages = cleared.messages.filter(
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
    renderedIn: chatDir(chatId),
    signal,
  });

  // After resizing, so the size budget counts the bytes actually sent.
  const limitedMessages = await limitModelImages(normalizedMessages);

  const cachedModelMessages = addCacheControlToMessages({
    messages: await sanitizeModelText(limitedMessages),
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
      content: contextRolloverNotice(
        await readHandoffNotes(chatId),
        agentHandoffNotesPath(chatId),
        rolloverSummary(
          allNonContextMessages,
          rolledOverAfterMessageId,
          chatId,
        ),
      ),
      providerOptions: TRANSIENT,
      role: "user",
    });
  }

  // Near the price step with nothing left worth clearing: the model writes a
  // summary of the conversation from this very request, so it reads the
  // prefix from cache, and the session rolls over onto it before the request
  // crosses the step. The request is then built again, from the boundary.
  // After the rollover notice, so a summary written after an earlier one is
  // written from it.
  if (
    summarize !== undefined &&
    cleared.summaryDue &&
    contextRolloverWouldReclaim(nonContextMessages)
  ) {
    const summary = await summarize(preparedMessages);
    if (
      summary !== undefined &&
      (await recordRollover({
        chatId,
        history: allNonContextMessages,
        model,
        sessionId,
        summary,
        usable,
      })) !== undefined
    ) {
      return prepareModelMessages({ agent, chatId, model, sessionId, signal });
    }
  }

  // After the rollover notice: that one says what the window is missing and
  // hands back the notes, and this one says how much room what remains has
  // left. Read the other way around, the instruction to write notes arrives
  // before the agent has been given the ones it already wrote.
  const notice = contextBudgetNotice(budget, agentHandoffNotesPath(chatId));

  if (notice !== undefined) {
    preparedMessages.push({
      content: notice,
      providerOptions: TRANSIENT,
      role: "user",
    });
  }

  return ok(preparedMessages);
}
