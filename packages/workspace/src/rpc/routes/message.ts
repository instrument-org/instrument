import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import { createSession } from "../../lib/create-session";
import { generateTitleFromUserMessage } from "../../lib/generate-title-from-user-message";
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
    .output(eventIterator(SessionMessage.WithPartsSchema.array()))
    .handler(async function* ({ context, input, signal }) {
      yield call(listWithParts, input, { context, signal });

      const messageUpdates = publisher.subscribe("message.updated", { signal });
      const messageRemoved = publisher.subscribe("message.removed", { signal });
      const partUpdates = publisher.subscribe("part.updated", { signal });

      // Scope to this session so a token streaming in one session doesn't
      // reload every other live subscription in the same app. message.updated/
      // .removed carry sessionId directly; part.updated carries it on the part.
      async function* filterBySession(
        generator:
          | typeof messageRemoved
          | typeof messageUpdates
          | typeof partUpdates,
      ) {
        for await (const payload of generator) {
          if (payload.id !== input.id) {
            continue;
          }
          const sessionId =
            "part" in payload
              ? payload.part.metadata.sessionId
              : payload.sessionId;
          if (sessionId === input.sessionId) {
            yield null;
          }
        }
      }

      for await (const _ of mergeGenerators([
        filterBySession(messageUpdates),
        filterBySession(messageRemoved),
        filterBySession(partUpdates),
      ])) {
        yield call(listWithParts, input, { context, signal });
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
