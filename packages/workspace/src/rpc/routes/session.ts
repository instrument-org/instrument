import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import { isExpectedNetworkError } from "@instrument-org/shared";
import { call, ORPCError } from "@orpc/server";
import { z } from "zod";

import { agentNameForTask } from "../../lib/agent-name-for-task";
import { changedMessageBatches } from "../../lib/changed-message-batches";
import { getSessionMarkdown } from "../../lib/session-to-markdown";
import { Store } from "../../lib/store";
import { cancelHold } from "../../lib/task-hold";
import { recordTaskActivity } from "../../lib/task-settings";
import { Session } from "../../schemas/session";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { type ToolOutputByName, TOOLS_BY_NAME } from "../../tools/all";
import { ToolNameSchema } from "../../tools/name";
import { base, toORPCError } from "../base";

const byIdWithMessagesAndParts = base
  .input(
    z.object({
      id: TaskIdSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(Session.WithMessagesAndPartsSchema)
  .handler(async ({ errors, input }) => {
    const { id, sessionId } = input;
    const taskId = id;
    const session = await Store.getSessionWithMessagesAndParts(
      sessionId,
      taskId,
    );

    if (session.isErr()) {
      throw toORPCError(session.error, errors);
    }

    return session.value;
  });

const list = base
  .input(
    z.object({
      id: TaskIdSchema,
      includeChildSessions: z.boolean().default(false),
    }),
  )
  .output(z.array(Session.Schema))
  .handler(async ({ errors, input }) => {
    const { id, includeChildSessions } = input;
    const taskId = id;
    const sessions = await Store.getSessions(taskId, {
      includeChildSessions,
    });
    if (sessions.isErr()) {
      throw toORPCError(sessions.error, errors);
    }

    const recency = (s: (typeof sessions.value)[number]) =>
      (s.updatedAt ?? s.createdAt).getTime();

    return [...sessions.value].sort((a, b) => recency(b) - recency(a));
  });

// Run the agent over the session as it stands, with nothing added to it. What
// the agent answers is the request already in the transcript, so a turn that
// failed on its way to the model is asked for again exactly as it was sent the
// first time, and the user is not made to say something to get it.
const run = base
  .input(
    z.object({
      id: TaskIdSchema,
      modelURI: AIGatewayModelURI.Schema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.void())
  .handler(async ({ context, errors, input }) => {
    const { id, modelURI, sessionId } = input;
    const taskId = id;

    const modelResult = await fetchModel({
      captureException: context.workspaceConfig.captureException,
      configs: context.workspaceConfig.getAIProviderConfigs(),
      modelCache: context.workspaceConfig.modelCache,
      modelURI,
    });

    if (!modelResult.ok) {
      if (!isExpectedNetworkError(modelResult.error)) {
        context.workspaceConfig.captureException(modelResult.error);
      }
      throw toORPCError(modelResult.error, errors);
    }

    context.workspaceRef.send({
      type: "runTurn",
      value: {
        agentName: agentNameForTask(taskId),
        id,
        model: modelResult.value,
        sessionId,
      },
    });

    // A settings write, which the record change feed reports: what moves the task in the list.
    await recordTaskActivity(taskId);
  });

const stop = base
  .input(z.object({ id: TaskIdSchema }))
  .handler(({ context, input }) => {
    // A task held from starting has no session to stop; stopping it cancels
    // the start instead.
    cancelHold(input.id);
    context.workspaceRef.send({
      type: "stopSessions",
      value: {
        id: input.id,
      },
    });
  });

const toMarkdown = base
  .input(
    z.object({
      frontMatter: z.record(z.string(), z.unknown()).optional(),
      id: TaskIdSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.object({ markdown: z.string() }))
  .handler(async ({ input }) => {
    const { frontMatter, id, sessionId } = input;
    const taskId = id;

    const markdown = await getSessionMarkdown({
      frontMatter,
      sessionId,
      taskId,
    });
    return { markdown };
  });

const contextTokens = base
  .input(
    z.object({
      id: TaskIdSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.object({ inputTokens: z.number() }))
  .handler(async ({ errors, input }) => {
    const { id, sessionId } = input;
    const taskId = id;

    const messages = await Store.getMessages({ sessionId, taskId });
    if (messages.isErr()) {
      throw toORPCError(messages.error, errors);
    }

    const lastWithTokens = messages.value.findLast(
      (m) =>
        m.role === "assistant" &&
        Number.isFinite(m.metadata.usage?.inputTokens) &&
        (m.metadata.usage?.inputTokens ?? 0) > 0,
    );

    const inputTokens =
      lastWithTokens?.role === "assistant"
        ? (lastWithTokens.metadata.usage?.inputTokens ?? 0)
        : 0;

    return { inputTokens };
  });

const live = {
  contextTokens: base
    .input(
      z.object({
        id: TaskIdSchema,
        sessionId: StoreId.SessionSchema,
      }),
    )
    .handler(async function* ({ context, input, signal }) {
      // Coalesce this session's message/part events into batches: the token
      // count depends only on this session, and a streaming turn's event storm
      // collapses into one recompute per batch instead of one per event.
      const batches = changedMessageBatches(input, signal);
      try {
        yield call(contextTokens, input, { context, signal });
        for await (const _batch of batches) {
          yield call(contextTokens, input, { context, signal });
        }
      } finally {
        await batches.return();
      }
    }),
};

/**
 * Answer a tool call that is waiting on the user: a `choose` or a
 * `request_folder`. The output is checked against the tool's own schema, then
 * handed to the session holding the call, which records it and lets the agent
 * go on.
 */
const answerToolCall = base
  .input(
    z.object({
      id: TaskIdSchema,
      output: z.unknown(),
      toolCallId: z.string(),
      toolName: ToolNameSchema,
    }),
  )
  .output(z.void())
  .handler(({ context, input }) => {
    const tool = TOOLS_BY_NAME[input.toolName];
    const parsed = tool.outputSchema.safeParse(input.output);
    if (!parsed.success) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Not an answer ${input.toolName} accepts: ${z.prettifyError(parsed.error)}`,
      });
    }
    // Nothing is waiting for the answer once the session that asked has gone,
    // which is what an app stopped mid-turn leaves behind: the call stays
    // unanswered on disk and the card that draws it still has its buttons. The
    // machine drops such an answer with a line in the log, so say it here
    // instead, where the click can be told it went nowhere.
    const sessions =
      context.workspaceRef
        .getSnapshot()
        .context.sessionRefsByTaskId.get(input.id) ?? [];
    if (sessions.length === 0) {
      throw new ORPCError("CONFLICT", {
        message: "That request ended before the answer reached it.",
      });
    }
    // The name and the output were validated together above, which is the
    // correlation the union type carries and a lookup by name cannot express.
    const output: unknown = parsed.data;
    const value = { output, toolName: input.toolName } as ToolOutputByName;
    context.workspaceRef.send({
      type: "updateInteractiveToolCall",
      value: {
        id: input.id,
        update: { toolCallId: input.toolCallId, type: "success", value },
      },
    });
  });

export const session = {
  answerToolCall,
  byIdWithMessagesAndParts,
  list,
  live,
  run,
  stop,
  toMarkdown,
};
