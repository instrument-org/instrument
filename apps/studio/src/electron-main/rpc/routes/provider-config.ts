import { liveRead } from "@instrument-org/workspace/electron";
import { startAuthCallbackServer } from "@/electron-main/auth/server";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import {
  cancelOpenRouterConnect,
  connectOpenRouter,
  type OpenRouterConnectResult,
} from "@/electron-main/lib/openrouter-connect";
import { setDefaultModel } from "@/electron-main/lib/set-default-model";
import { base } from "@/electron-main/rpc/base";
import { getWorkspaceState } from "@/electron-main/stores/workspace/state";
import { ClientAIProviderConfigSchema } from "@/shared/schemas/provider";
import {
  AIGatewayProviderConfig,
  baseURLWithDefault,
  fetchCredits,
  getAllProviderMetadata,
  getProviderMetadata,
  ProviderMetadataSchema,
  verifyAPIKey,
} from "@instrument-org/ai-gateway";
import { AIProviderConfigIdSchema, APP_DOMAIN } from "@instrument-org/shared";
import { call, eventIterator } from "@orpc/server";
import { safeStorage } from "electron";
import ms from "ms";
import { ulid } from "ulid";
import { z } from "zod";

import { getProviderConfigsStore } from "../../stores/workspace/provider-configs";
import { cacheMiddleware } from "../middleware/cache";
import { publisher } from "../publisher";

const list = base.output(z.array(ClientAIProviderConfigSchema)).handler(() => {
  const providersStore = getProviderConfigsStore();
  return providersStore.get("providers").map(({ apiKey, ...provider }) => ({
    ...provider,
    maskedApiKey: apiKey
      ? `${apiKey.slice(0, 4)}${"·".repeat(28)}${apiKey.slice(-4)}`
      : "",
  }));
});

const remove = base
  .input(z.object({ id: AIProviderConfigIdSchema }))
  .handler(({ context, errors, input }) => {
    const providersStore = getProviderConfigsStore();

    const providerConfig = providersStore
      .get("providers")
      .find((p) => p.id === input.id);

    if (!providerConfig) {
      throw errors.NOT_FOUND({ message: "Provider not found" });
    }

    providersStore.set(
      "providers",
      providersStore.get("providers").filter((p) => p.id !== input.id),
    );

    context.workspaceConfig.captureEvent("provider.removed", {
      provider_type: providerConfig.type,
    });
  });

const update = base
  .input(
    z.object({
      displayName: z.string().optional(),
      id: AIProviderConfigIdSchema,
    }),
  )
  .handler(({ errors, input }) => {
    const providersStore = getProviderConfigsStore();
    const providerConfigs = providersStore.get("providers");

    const providerIndex = providerConfigs.findIndex((c) => c.id === input.id);

    if (providerIndex === -1) {
      throw errors.NOT_FOUND({ message: "Provider not found" });
    }

    const updatedConfigs = [...providerConfigs];
    const existingConfig = updatedConfigs[providerIndex];
    if (!existingConfig) {
      throw errors.NOT_FOUND({ message: "Provider config not found" });
    }
    updatedConfigs[providerIndex] = {
      ...existingConfig,
      displayName: input.displayName,
    };

    providersStore.set("providers", updatedConfigs);
  });

/** Why a config of this type can't take this name, when one already has it. */
function duplicateNameMessage({
  displayName,
  type,
}: Pick<AIGatewayProviderConfig.Type, "displayName" | "type">) {
  const taken = getProviderConfigsStore()
    .get("providers")
    .some((p) => p.type === type && p.displayName === displayName);
  return taken
    ? `A provider of type "${type}" with the name "${displayName ?? ""}" already exists`
    : undefined;
}

const create = base
  .errors({ BAD_REQUEST: {} })
  .input(
    z.object({
      config: AIGatewayProviderConfig.Schema.omit({
        cacheIdentifier: true,
        id: true,
      }),
      skipValidation: z.boolean().optional(),
    }),
  )
  .handler(
    async ({
      context,
      errors,
      input: { config: newConfig, skipValidation },
    }) => {
      const providersStore = getProviderConfigsStore();
      const existingConfigs = providersStore.get("providers");

      const duplicateName = duplicateNameMessage(newConfig);
      if (duplicateName) {
        throw errors.BAD_REQUEST({ message: duplicateName });
      }

      const providerMetadata = getProviderMetadata(newConfig.type);

      if (!providerMetadata.requiresAPIKey) {
        const newConfigBaseURL = baseURLWithDefault(newConfig);
        const duplicateProviderByBaseURL = existingConfigs.find((p) => {
          const existingBaseURL = baseURLWithDefault(p);
          return (
            p.type === newConfig.type && existingBaseURL === newConfigBaseURL
          );
        });

        if (duplicateProviderByBaseURL) {
          throw errors.BAD_REQUEST({
            message: `A provider of type "${providerMetadata.name}" with the base URL "${newConfigBaseURL}" already exists.`,
          });
        }
      }

      if (!skipValidation) {
        const result = await verifyAPIKey(newConfig);

        if (!result.ok) {
          context.workspaceConfig.captureEvent("provider.verification_failed", {
            provider_type: newConfig.type,
          });

          throw errors.UNAUTHORIZED({
            cause: result.error,
            message: result.error.message,
          });
        }
      }

      const configToSave = {
        ...newConfig,
        // OpenRouter uses `user` for per-client cache keys; keep one stable id per config.
        // Prefix with app domain so their dashboard shows which product it is, not a bare uuid.
        cacheIdentifier: `${APP_DOMAIN}-${crypto.randomUUID()}`,
        id: AIProviderConfigIdSchema.parse(ulid()),
      };

      providersStore.set("providers", [...existingConfigs, configToSave]);

      getWorkspaceState().set("hasCompletedProviderSetup", true);

      void setDefaultModel({ onlyIfUnset: true });

      context.workspaceConfig.captureEvent("provider.created", {
        provider_type: configToSave.type,
      });
    },
  );

/**
 * Adds OpenRouter by having OpenRouter create a key in the browser rather than
 * by a pasted one, with the name and base URL the form holds. Answers how it
 * ended, with what went wrong when it failed.
 */
const connectOpenRouterProvider = base
  .input(
    z.object({
      baseURL: z.string().optional(),
      displayName: z.string().optional(),
    }),
  )
  .handler(
    async ({
      context,
      input,
    }): Promise<
      OpenRouterConnectResult | { error: string; outcome: "failed" }
    > => {
      try {
        // Checked before the browser opens, so a name that can't be saved
        // never costs a key on OpenRouter.
        const duplicateName = duplicateNameMessage({
          displayName: input.displayName,
          type: "openrouter",
        });
        if (duplicateName) {
          return { error: duplicateName, outcome: "failed" };
        }
        const server = await startAuthCallbackServer();
        if (!server) {
          throw new Error("The sign-in callback server isn't running");
        }
        return await connectOpenRouter({
          callbackPort: server.port,
          // The first config takes the provider's own name, which says
          // nothing on OpenRouter's keys page.
          keyLabel:
            input.displayName === getProviderMetadata("openrouter").name
              ? undefined
              : input.displayName,
          // The key was just created for this, so checking it again would only
          // race OpenRouter's own propagation.
          save: (apiKey) =>
            call(
              create,
              {
                config: { ...input, apiKey, type: "openrouter" },
                skipValidation: true,
              },
              { context },
            ),
        });
      } catch (error) {
        captureServerException(
          new Error("Connecting OpenRouter failed", { cause: error }),
          { scopes: ["auth"] },
        );
        return {
          error:
            error instanceof Error
              ? error.message
              : "Couldn't connect OpenRouter",
          outcome: "failed",
        };
      }
    },
  );

const cancelConnectOpenRouter = base.handler(() => {
  cancelOpenRouterConnect();
});

const credits = base
  .use(async ({ next }) => {
    return next({
      context: {
        cacheTTL: ms("30 seconds"),
      },
    });
  })
  .use(cacheMiddleware)
  .errors({ FETCH_FAILED: {} })
  .input(z.object({ id: AIProviderConfigIdSchema }))
  .output(
    z.object({
      credits: z.object({ remaining: z.number() }),
    }),
  )
  .handler(async ({ errors, input }) => {
    const providersStore = getProviderConfigsStore();
    const providerConfig = providersStore
      .get("providers")
      .find((p) => p.id === input.id);

    if (!providerConfig) {
      throw errors.NOT_FOUND();
    }

    const result = await fetchCredits(providerConfig);
    if (!result.ok) {
      throw errors.FETCH_FAILED({ message: result.error.message });
    }

    return {
      credits: result.value,
    };
  });

const live = {
  list: base
    .output(eventIterator(z.array(ClientAIProviderConfigSchema)))
    .handler(async function* ({ context, signal }) {
      yield* liveRead({
        changes: [publisher.subscribe("provider-config.updated", { signal })],
        read: () => call(list, {}, { context, signal }),
      });
    }),
};

const safeStorageInfo = base
  .output(
    z.object({
      backend: z.string().nullable(),
      isAvailable: z.boolean(),
    }),
  )
  .handler(() => {
    const isAvailable = safeStorage.isEncryptionAvailable();
    const backend =
      process.platform === "linux"
        ? safeStorage.getSelectedStorageBackend()
        : null;

    return {
      backend,
      isAvailable,
    };
  });

const listMetadata = base
  .output(z.array(ProviderMetadataSchema))
  .handler(() => {
    return getAllProviderMetadata();
  });

export const providerConfig = {
  cancelConnectOpenRouter,
  connectOpenRouter: connectOpenRouterProvider,
  create,
  credits,
  list,
  live,
  metadata: {
    list: listMetadata,
  },
  remove,
  safeStorageInfo,
  update,
};
