import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import { eventIterator, type } from "@orpc/server";
import { sleep } from "radashi";
import { z } from "zod";

import { changedMessageBatches } from "../../lib/changed-message-batches";
import { createSession } from "../../lib/create-session";
import { generateTitleFromUserMessage } from "../../lib/generate-title-from-user-message";
import { LiveMessagesSnapshot } from "../../lib/live-messages-snapshot";
import { newMessage } from "../../lib/new-message";
import { Store } from "../../lib/store";
import { updateSessionTitle } from "../../lib/update-session-title";
import { FileUpload } from "../../schemas/file-upload";
import { SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { TOOL_NAMES } from "../../tools/name";
import { base, toORPCError } from "../base";
import { publisher } from "../publisher";

// One schema per interactive tool: the renderer resolves a pending
// (never-executed) tool call with a typed output. Keep in sync with
// isInteractiveTool and each tool's outputSchema.
const InteractiveToolResolutionSchema = z.discriminatedUnion("toolName", [
  z.object({
    output: z.object({ selectedChoice: z.string() }),
    toolName: z.literal(TOOL_NAMES.choose),
  }),
  z.object({
    output: z.object({
      slug: z.string(),
      state: z.enum(["granted", "denied"]),
    }),
    toolName: z.literal(TOOL_NAMES.connectorCredentialPrompt),
  }),
  z.object({
    output: z.object({
      slug: z.string(),
      state: z.enum(["connected", "dismissed"]),
    }),
    toolName: z.literal(TOOL_NAMES.connectorOauthPrompt),
  }),
]);

const resolveInteractiveToolCall = base
  .input(
    z.object({
      id: TaskIdSchema,
      resolution: InteractiveToolResolutionSchema,
      toolCallId: z.string(),
    }),
  )
  .handler(({ context, input }) => {
    // The workspace machine fans this out to the task's sessions; the agent
    // machine writes the output onto the pending part and resumes the turn.
    context.workspaceRef.send({
      type: "updateInteractiveToolCall",
      value: {
        id: input.id,
        update: {
          toolCallId: input.toolCallId,
          type: "success",
          value: input.resolution,
        },
      },
    });
  });

const listWithParts = base
  .input(
    z.object({
      id: TaskIdSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.array(SessionMessage.WithPartsSchema))
  .handler(async ({ errors, input }) => {
    const { id, sessionId } = input;
    const taskId = id;
    const messages = await Store.getMessagesWithParts({
      sessionId,
      taskId,
    });

    if (messages.isErr()) {
      throw toORPCError(messages.error, errors);
    }

    return messages.value;
  });

const create = base
  .input(
    z.object({
      files: z.array(FileUpload.Schema).optional(),
      folders: z.array(z.object({ path: z.string() })).optional(),
      id: TaskIdSchema,
      modelURI: AIGatewayModelURI.Schema,
      prompt: z.string(),
      sessionId: StoreId.SessionSchema.optional(),
    }),
  )
  .output(z.object({ sessionId: StoreId.SessionSchema }))
  .handler(
    async ({
      context,
      errors,
      input: { files, folders, id, modelURI, prompt, sessionId },
    }) => {
      const taskId = id;

      const modelResult = await fetchModel({
        captureException: context.workspaceConfig.captureException,
        configs: context.workspaceConfig.getAIProviderConfigs(),
        modelCache: context.workspaceConfig.modelCache,
        modelURI,
      });

      if (!modelResult.ok) {
        const error = modelResult.error;
        context.workspaceConfig.captureException(error);
        throw toORPCError(error, errors);
      }

      const model = modelResult.value;

      let finalSessionId: StoreId.Session;
      if (sessionId) {
        finalSessionId = sessionId;
      } else {
        const sessionResult = await createSession({
          sessionId: StoreId.newSessionId(),
          taskId,
        });
        if (sessionResult.isErr()) {
          context.workspaceConfig.captureException(sessionResult.error);
          throw toORPCError(sessionResult.error, errors);
        }
        finalSessionId = sessionResult.value.id;
      }

      const messageIdsBeforeResult = await Store.getMessageIds(
        finalSessionId,
        taskId,
      );
      if (messageIdsBeforeResult.isErr()) {
        context.workspaceConfig.captureException(messageIdsBeforeResult.error);
        throw toORPCError(messageIdsBeforeResult.error, errors);
      }
      const isFirstMessageInSession = messageIdsBeforeResult.value.length === 0;

      const messageResult = await newMessage({
        files,
        folders,
        model,
        modelURI,
        prompt,
        sessionId: finalSessionId,
        taskId,
      });

      if (messageResult.isErr()) {
        context.workspaceConfig.captureException(messageResult.error);
        throw toORPCError(messageResult.error, errors);
      }

      const message = messageResult.value;

      if (isFirstMessageInSession) {
        generateTitleFromUserMessage({
          message,
          model,
          workspaceConfig: context.workspaceConfig,
        }).then(async (title) => {
          if (title.isOk()) {
            await updateSessionTitle({
              sessionId: message.metadata.sessionId,
              taskId,
              title: title.value,
            });
          }
        });
      }

      context.workspaceRef.send({
        type: "addMessage",
        value: {
          agentName: "main",
          id,
          message,
          model,
          sessionId: message.metadata.sessionId,
        },
      });

      publisher.publish("task.updated", {
        id: taskId,
      });

      return { sessionId: message.metadata.sessionId };
    },
  );

const count = base
  .input(
    z.object({
      id: TaskIdSchema,
      sessionId: StoreId.SessionSchema.optional(),
    }),
  )
  .output(z.number())
  .handler(async ({ errors, input }) => {
    const { id, sessionId } = input;
    const taskId = id;

    const messageIds = sessionId
      ? await Store.getMessageIds(sessionId, taskId)
      : await Store.getAllMessageIds(taskId);

    if (messageIds.isErr()) {
      const error = toORPCError(messageIds.error, errors);
      throw error;
    }

    return messageIds.value.length;
  });

const live = {
  listWithParts: base
    .input(
      z.object({
        id: TaskIdSchema,
        sessionId: StoreId.SessionSchema,
      }),
    )
    // Messages are Zod-validated when read from the store; re-validating the
    // whole array on every yield would make each update O(session) again.
    .output(eventIterator(type<SessionMessage.WithParts[]>()))
    .handler(async function* ({ errors, input, signal }) {
      // Subscribing before the initial read means no event can land
      // unobserved between the two; an event for a message the read already
      // covered only costs a redundant re-read of that message.
      const batches = changedMessageBatches(input, signal);

      try {
        const initial = await Store.getMessagesWithParts(
          { sessionId: input.sessionId, taskId: input.id },
          { signal },
        );
        if (initial.isErr()) {
          throw toORPCError(initial.error, errors);
        }
        const snapshot = new LiveMessagesSnapshot(initial.value);
        yield snapshot.toArray();

        // Each batch re-reads only the changed messages and splices them into
        // the snapshot, so store work per update is proportional to the
        // change, not the session. Bursts coalesce: a turn's token storm
        // targets one message, so its part.updated events collapse into a
        // single re-read + yield. Every yield is the complete sorted array.
        for await (const batch of batches) {
          for (const messageId of batch.removed) {
            snapshot.remove(messageId);
          }

          if (batch.updated.size > 0) {
            const messageIds = [...batch.updated];
            const readUpdated = () =>
              Store.getMessagesWithParts(
                { messageIds, sessionId: input.sessionId, taskId: input.id },
                { signal },
              );

            // A message can be unreadable mid-write (writes aren't atomic),
            // so give the write a moment to settle before falling back to a
            // full reload, which surfaces a persistent error the same way
            // the initial read does.
            let messages = await readUpdated();
            for (
              let retry = 0;
              messages.isErr() && retry < 2 && !signal?.aborted;
              retry++
            ) {
              await sleep(50);
              messages = await readUpdated();
            }

            if (messages.isOk()) {
              for (const message of messages.value) {
                snapshot.upsert(message);
              }
              // The read omits ids the index named but the fetch couldn't
              // find (mid-write or just removed). Drop them; a later event
              // re-adds a message that reappears.
              const found = new Set(messages.value.map(({ id }) => id));
              for (const messageId of messageIds) {
                if (!found.has(messageId)) {
                  snapshot.remove(messageId);
                }
              }
            } else {
              const reload = await Store.getMessagesWithParts(
                { sessionId: input.sessionId, taskId: input.id },
                { signal },
              );
              if (reload.isErr()) {
                throw toORPCError(reload.error, errors);
              }
              snapshot.reset(reload.value);
            }
          }

          yield snapshot.toArray();
        }
      } finally {
        // for await only closes the iterator once the loop has been entered;
        // this also unsubscribes when the initial read throws.
        await batches.return();
      }
    }),
};

export const message = {
  count,
  create,
  list: listWithParts,
  live,
  resolveInteractiveToolCall,
};
