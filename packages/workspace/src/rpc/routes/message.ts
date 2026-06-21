import {
  AIGatewayModelURI,
  fetchModel,
} from "@instrument-org/ai-gateway";
import {
  mergeGenerators,
} from "@instrument-org/shared/merge-generators";
import {
  call,
  eventIterator,
} from "@orpc/server";
import {
  parallel,
} from "radashi";
import {
  z,
} from "zod";

import {
  createAppConfig,
} from "../../lib/app-config/create";
import {
  createSession,
} from "../../lib/create-session";
import {
  generateTitleFromUserMessage,
} from "../../lib/generate-title-from-user-message";
import {
  newMessage,
} from "../../lib/new-message";
import {
  Store,
} from "../../lib/store";
import {
  updateSessionTitle,
} from "../../lib/update-session-title";
import {
  emptyUsageSummary,
  getUsageSummaryFromMessages,
  UsageSummarySchema,
} from "../../lib/usage-summary";
import {
  FileUpload,
} from "../../schemas/file-upload";
import {
  SessionMessage,
} from "../../schemas/session/message";
import {
  StoreId,
} from "../../schemas/store-id";
import {
  TaskIdSchema,
} from "../../schemas/task-id";
import {
  base,
  toORPCError,
} from "../base";
import {
  publisher,
} from "../publisher";

const listWithParts = base
  .input(
    z.object({
      sessionId: StoreId.SessionSchema,
      subdomain: TaskIdSchema,
    }),
  )
  .output(z.array(SessionMessage.WithPartsSchema))
  .handler(async ({ errors, input }) => {
    const { sessionId, subdomain } = input;
    const appConfig = createAppConfig({ subdomain });
    const messages = await Store.getMessagesWithParts({
      appConfig,
      sessionId,
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
      modelURI: AIGatewayModelURI.Schema,
      prompt: z.string(),
      sessionId: StoreId.SessionSchema.optional(),
      subdomain: TaskIdSchema,
    }),
  )
  .output(z.object({ sessionId: StoreId.SessionSchema }))
  .handler(
    async ({
      context,
      errors,
      input: { files, folders, modelURI, prompt, sessionId, subdomain },
    }) => {
      const appConfig = createAppConfig({ subdomain });

      const modelResult = await fetchModel({
        captureException: context.workspaceConfig.captureException,
        configs: context.workspaceConfig.getAIProviderConfigs(),
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
          appConfig,
          sessionId: StoreId.newSessionId(),
        });
        if (sessionResult.isErr()) {
          context.workspaceConfig.captureException(sessionResult.error);
          throw toORPCError(sessionResult.error, errors);
        }
        finalSessionId = sessionResult.value.id;
      }

      const messageIdsBeforeResult = await Store.getMessageIds(
        finalSessionId,
        appConfig,
      );
      if (messageIdsBeforeResult.isErr()) {
        context.workspaceConfig.captureException(messageIdsBeforeResult.error);
        throw toORPCError(messageIdsBeforeResult.error, errors);
      }
      const isFirstMessageInSession = messageIdsBeforeResult.value.length === 0;

      const messageResult = await newMessage({
        appConfig,
        files,
        folders,
        model,
        modelURI,
        prompt,
        sessionId: finalSessionId,
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
              appConfig,
              sessionId: message.metadata.sessionId,
              title: title.value,
            });
          }
        });
      }

      context.workspaceRef.send({
        type: "addMessage",
        value: {
          agentName: "main",
          message,
          model,
          sessionId: message.metadata.sessionId,
          subdomain,
        },
      });

      publisher.publish("project.updated", {
        subdomain: appConfig,
      });

      return { sessionId: message.metadata.sessionId };
    },
  );

const count = base
  .input(
    z.object({
      sessionId: StoreId.SessionSchema.optional(),
      subdomain: TaskIdSchema,
    }),
  )
  .output(z.number())
  .handler(async ({ errors, input }) => {
    const { sessionId, subdomain } = input;
    const appConfig = createAppConfig({ subdomain });

    const messageIds = sessionId
      ? await Store.getMessageIds(sessionId, appConfig)
      : await Store.getAllMessageIds(appConfig);

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
        sessionId: StoreId.SessionSchema,
        subdomain: TaskIdSchema,
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
          if (payload.subdomain !== input.subdomain) {
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

const MessageRefSchema = z.object({
  messageId: StoreId.MessageSchema,
  sessionId: StoreId.SessionSchema,
});

const usageSummary = base
  .input(
    z.object({
      messages: z.array(MessageRefSchema),
      subdomain: TaskIdSchema,
    }),
  )
  .output(UsageSummarySchema)
  .handler(async ({ input, signal }) => {
    const { messages, subdomain } = input;
    const appConfig = createAppConfig({ subdomain });

    const results = await parallel(
      { limit: 10, signal },
      messages,
      async ({ messageId, sessionId }) => {
        const result = await Store.getMessageWithParts(
          { appConfig, messageId, sessionId },
          { signal },
        );
        return result.isOk() ? result.value : null;
      },
    );

    const loaded = results.filter((m) => m !== null);
    if (loaded.length === 0) {
      return emptyUsageSummary();
    }

    return getUsageSummaryFromMessages(loaded);
  });

export const message = {
  count,
  create,
  list: listWithParts,
  live,
  usageSummary,
};
