import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { call } from "@orpc/server";
import { z } from "zod";

import { createSession } from "../../lib/create-session";
import { getSessionMarkdown } from "../../lib/session-to-markdown";
import { Store } from "../../lib/store";
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

    const messages = await Store.getMessagesWithParts({ sessionId, taskId });
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
      yield call(contextTokens, input, { context, signal });

      const messageUpdates = publisher.subscribe("message.updated", { signal });
      const messageRemoved = publisher.subscribe("message.removed", { signal });
      const partUpdates = publisher.subscribe("part.updated", { signal });

      async function* filterByTaskId(
        generator:
          | typeof messageRemoved
          | typeof messageUpdates
          | typeof partUpdates,
      ) {
        for await (const payload of generator) {
          if (payload.id === input.id) {
            yield null;
          }
        }
      }

      for await (const _ of mergeGenerators([
        filterByTaskId(messageUpdates),
        filterByTaskId(messageRemoved),
        filterByTaskId(partUpdates),
      ])) {
        yield call(contextTokens, input, { context, signal });
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
  stop,
  toMarkdown,
};
