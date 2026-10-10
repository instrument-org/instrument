import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { assign, fromPromise, log, setup } from "xstate";

import { getCurrentDate } from "../lib/get-current-date";
import { isToolPart } from "../lib/is-tool-part";
import { runToolCall } from "../lib/run-tool-call";
import { Store } from "../lib/store";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { getToolByType } from "../tools/all";

/**
 * Why a run was stopped: the user stopped it, or the user wrote again while
 * the conversation was still replying, which starts the reply over.
 */
export type StopReason = "manual" | "superseded";

type CancellationReason = "timeout" | "unknown" | StopReason;

const STOPPED_BECAUSE: Record<CancellationReason, string> = {
  manual: "This action was stopped by you.",
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
export async function saveStoppedToolCallPart(
  input: {
    part: SessionMessagePart.ToolPart;
    reason: CancellationReason;
    chatId: ChatId;
  },
  { signal }: { signal?: AbortSignal } = {},
) {
  await Store.updatePart(
    {
      messageId: input.part.metadata.messageId,
      partId: input.part.metadata.id,
      sessionId: input.part.metadata.sessionId,
    },
    (current) => {
      if (
        !isToolPart(current) ||
        (current.state !== "input-available" &&
          current.state !== "input-streaming")
      ) {
        return current;
      }
      // The part union is discriminated by tool type as well as by state, so
      // a spread that moves only the state does not land on a member of it;
      // the fields written here are the ones an errored call carries.
      return {
        ...current,
        errorText: STOPPED_BECAUSE[input.reason],
        metadata: {
          ...current.metadata,
          endedAt: getCurrentDate(),
        },
        state: "output-error",
      } as SessionMessagePart.Type;
    },
    input.chatId,
    { signal },
  );
}

const executeToolLogic = fromPromise<
  { preliminarySaved: boolean },
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
    >(async ({ input, signal }) => {
      await saveStoppedToolCallPart(input, { signal });
    }),

    executeToolLogic,
  },

  delays: {
    toolCallTimeout: ({ context }) => {
      const tool = getToolByType(context.part.type);
      return typeof tool.timeoutMs === "function"
        ? tool.timeoutMs({
            input: context.part.input as never,
            chatId: context.chatId,
          })
        : tool.timeoutMs;
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
        onDone: [
          {
            guard: ({ context, event }) =>
              context.cancellationReason !== "unknown" &&
              !event.output.preliminarySaved,
            target: "Cancelling",
          },
          { target: "Done" },
        ],
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
