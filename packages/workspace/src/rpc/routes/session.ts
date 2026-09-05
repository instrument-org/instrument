import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { call } from "@orpc/server";
import { z } from "zod";

import { killSessionBackgroundProcesses } from "../../lib/background-processes";
import { changedMessageBatches } from "../../lib/changed-message-batches";
import { createSession } from "../../lib/create-session";
import { getSessionMarkdown } from "../../lib/session-to-markdown";
import { Store } from "../../lib/store";
import { recordTaskActivity } from "../../lib/task-settings";
import { Session } from "../../schemas/session";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { base, toORPCError } from "../base";
import { publisher } from "../publisher";

const byId = base
  .input(
    z.object({
      id: TaskIdSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(Session.Schema)
  .handler(async ({ errors, input }) => {
    const { id, sessionId } = input;
    const taskId = id;
    const session = await Store.getSession(sessionId, taskId);

    if (session.isErr()) {
      throw toORPCError(session.error, errors);
    }

    return session.value;
  });

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

const remove = base
  .input(
    z.object({
      id: TaskIdSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.void())
  .handler(async ({ context, errors, input }) => {
    const { id, sessionId } = input;
    const taskId = id;
    const sessions = await Store.getSessions(taskId, {
      includeChildSessions: true,
    });
    if (sessions.isErr()) {
      throw toORPCError(sessions.error, errors);
    }
    const removedSessionIds = sessions.value
      .filter(
        (session) => session.id === sessionId || session.parentId === sessionId,
      )
      .map((session) => session.id);
    // Cleanup is already bounded, and a process that will not confirm it stopped
    // must not make its session undeletable: record it and remove the session
    // anyway, so the stuck process is the only thing left to deal with.
    await Promise.all(
      removedSessionIds.map((removedSessionId) =>
        killSessionBackgroundProcesses(removedSessionId).catch(
          (error: unknown) => {
            context.workspaceConfig.captureException(error);
          },
        ),
      ),
    );
    const result = await Store.removeSession(sessionId, taskId);
    if (result.isErr()) {
      context.workspaceConfig.captureException(result.error);
      throw toORPCError(result.error, errors);
    }

    context.workspaceConfig.captureEvent("session.removed");
  });

const create = base
  .input(z.object({ id: TaskIdSchema }))
  .output(Session.Schema)
  .handler(async ({ context, errors, input }) => {
    const { id } = input;
    const taskId = id;
    const sessionResult = await createSession({
      sessionId: StoreId.newSessionId(),
      taskId,
    });

    if (sessionResult.isErr()) {
      context.workspaceConfig.captureException(sessionResult.error);
      throw toORPCError(sessionResult.error, errors);
    }

    return sessionResult.value;
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
      context.workspaceConfig.captureException(modelResult.error);
      throw toORPCError(modelResult.error, errors);
    }

    context.workspaceRef.send({
      type: "runTurn",
      value: {
        agentName: "main",
        id,
        model: modelResult.value,
        sessionId,
      },
    });

    // Publishes `task.updated` itself, which is what moves the task in the list.
    await recordTaskActivity(taskId);

    context.workspaceConfig.captureEvent("session.run");
  });

const stop = base
  .input(z.object({ id: TaskIdSchema }))
  .handler(({ context, input }) => {
    context.workspaceRef.send({
      type: "stopSessions",
      value: {
        id: input.id,
      },
    });

    context.workspaceConfig.captureEvent("session.stopped");
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
  list: base
    .input(
      z.object({
        id: TaskIdSchema,
        includeChildSessions: z.boolean().default(false),
      }),
    )
    .handler(async function* ({ context, input, signal }) {
      yield call(list, input, { context, signal });

      const sessionUpdates = publisher.subscribe("session.updated", { signal });
      const sessionRemoved = publisher.subscribe("session.removed", { signal });

      async function* filterByTaskId(
        generator: typeof sessionRemoved | typeof sessionUpdates,
      ) {
        for await (const payload of generator) {
          if (payload.id === input.id) {
            yield null;
          }
        }
      }

      for await (const _ of mergeGenerators([
        filterByTaskId(sessionUpdates),
        filterByTaskId(sessionRemoved),
      ])) {
        yield call(list, input, { context, signal });
      }
    }),
};

export const session = {
  byId,
  byIdWithMessagesAndParts,
  contextTokens,
  create,
  list,
  live,
  remove,
  run,
  stop,
  toMarkdown,
};
