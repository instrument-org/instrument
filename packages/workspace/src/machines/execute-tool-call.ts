import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { omit } from "radashi";
import { assign, fromPromise, log, setup } from "xstate";

import { ChatWrites } from "../lib/chat-writes";
import { getCurrentDate } from "../lib/get-current-date";
import {
  INTERRUPTED_TOOL_CALL_ERROR_TEXT,
  STOPPED_TOOL_CALL_ERROR_TEXT,
} from "../constants";
import { isToolPart } from "../lib/is-tool-part";
import { isArriving } from "../lib/records/arriving";
import { runToolCall } from "../lib/run-tool-call";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { getToolByType } from "../tools/all";

/**
 * Why a run was stopped: the user stopped it, the chat stopped one of its
 * tasks with `instrument task stop`, the user wrote again while the conversation was
 * still replying, which starts the reply over, or the app is quitting.
 */
export type StopReason = "chat" | "manual" | "quit" | "superseded";

type CancellationReason = "timeout" | "unknown" | StopReason;

const STOPPED_BECAUSE: Record<CancellationReason, string> = {
  // The person reads the same words for the chat's stop as for their own;
  // the part's `stoppedBy` keeps which it was for the model.
  chat: STOPPED_TOOL_CALL_ERROR_TEXT,
  manual: STOPPED_TOOL_CALL_ERROR_TEXT,
  // The words the next launch's sweep writes on a call the quit left in
  // flight, so a call reads the same whichever of the two settled it.
  quit: INTERRUPTED_TOOL_CALL_ERROR_TEXT,
  superseded:
    "This action was interrupted by a newer message from the user, and may not have finished.",
  timeout: "This action was stopped because it took too long.",
  unknown: "This action was stopped.",
};

/**
 * Writes the terminal record for a tool call that will never produce its own
 * output: `output-error` with copy naming why it stopped. Shared by the cancel
 * path here and the agent machine's finishing sweep over dangling parts.
 *
 * A call that produced a real output before this lands keeps it. `updatePart`
 * re-reads the part and hands the updater what the store holds now, which is
 * the only place the two writers can be ordered: a tool finishing as the user
 * stops, or as the sweep scans, would otherwise have its result replaced by an
 * account of the stop. Returning `current` unchanged skips the write entirely.
 */
export async function saveStoppedToolCallPart(input: {
  part: SessionMessagePart.ToolPart;
  reason: CancellationReason;
  chatId: ChatId;
}) {
  await ChatWrites.updatePart(
    {
      chatId: input.chatId,
      messageId: input.part.metadata.messageId,
      partId: input.part.metadata.id,
      sessionId: input.part.metadata.sessionId,
    },
    (current) => {
      // A preliminary output is the turn's memory, not an answer: the record
      // under it still waits on one.
      if (
        !isToolPart(current) ||
        (current.state !== "input-available" && !isArriving(current))
      ) {
        return current;
      }
      const unsettled = omit(current, ["output", "preliminary"]);
      // The part union is discriminated by tool type as well as by state, so
      // a spread that moves only the state does not land on a member of it;
      // the fields written here are the ones an errored call carries.
      return {
        ...unsettled,
        errorText: STOPPED_BECAUSE[input.reason],
        metadata: {
          ...unsettled.metadata,
          endedAt: getCurrentDate(),
          ...(input.reason === "chat" ? { stoppedBy: "agent" } : {}),
        },
        state: "output-error",
      } as SessionMessagePart.Type;
    },
  );
}

const executeToolLogic = fromPromise<
  void,
  {
    model: AIGatewayModel.Type;
    part: SessionMessagePart.ToolPartInputAvailable;
    sessionId: StoreId.Session;
    chatId: ChatId;
  }
>(async ({ input: { model, part, sessionId, chatId }, signal }) => {
  return runToolCall({
    model,
    part,
    sessionId,
    signal,
    chatId,
  });
});

export const executeToolCallMachine = setup({
  actors: {
    cancelToolCallLogic: fromPromise<
      void,
      {
        part: SessionMessagePart.ToolPartInputAvailable;
        reason: CancellationReason;
        chatId: ChatId;
      }
    >(async ({ input }) => {
      await saveStoppedToolCallPart(input);
    }),

    executeToolLogic,
  },

  delays: {
    toolCallTimeout: ({ context }) => {
      const tool = getToolByType(context.part.type);
      return tool.timeoutMs({
        input: context.part.input as never,
        chatId: context.chatId,
      });
    },
  },

  types: {
    context: {} as {
      cancellationReason: CancellationReason;
      model: AIGatewayModel.Type;
      part: SessionMessagePart.ToolPartInputAvailable;
      sessionId: StoreId.Session;
      chatId: ChatId;
    },
    events: {} as { reason?: StopReason; type: "stop" },
    input: {} as {
      model: AIGatewayModel.Type;
      part: SessionMessagePart.ToolPartInputAvailable;
      sessionId: StoreId.Session;
      chatId: ChatId;
    },
  },
}).createMachine({
  context: ({ input }) => ({
    cancellationReason: "unknown",
    model: input.model,
    part: input.part,
    sessionId: input.sessionId,
    chatId: input.chatId,
  }),
  id: "executeToolCall",
  initial: "Executing",
  states: {
    Cancelling: {
      invoke: {
        input: ({ context }) => ({
          part: context.part,
          reason: context.cancellationReason,
          chatId: context.chatId,
        }),
        onDone: "Done",
        onError: { actions: log(({ event }) => event.error), target: "Done" },
        src: "cancelToolCallLogic",
      },
    },

    Done: { type: "final" },

    Executing: {
      after: {
        toolCallTimeout: {
          actions: assign({ cancellationReason: "timeout" }),
          target: "Cancelling",
        },
      },
      invoke: {
        input: ({ context }) => ({
          model: context.model,
          part: context.part,
          sessionId: context.sessionId,
          chatId: context.chatId,
        }),
        onDone: "Done",
        onError: { actions: log(({ event }) => event.error), target: "Done" },
        src: "executeToolLogic",
      },
      on: {
        stop: {
          actions: assign({
            cancellationReason: ({ event }) => event.reason ?? "manual",
          }),
          target: "Cancelling",
        },
      },
    },
  },
});
