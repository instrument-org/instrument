import { Result } from "typescript-result";
import { z } from "zod";

import { type AIGatewayProviderConfig } from "../../schemas/provider-config";
import { TypedError } from "../errors";
import { apiURL } from "./api-url";
import { setProviderAuthHeaders } from "./set-auth-headers";

const OpenRouterCreditsResponseSchema = z.object({
  data: z.object({
    total_credits: z.number(),
    total_usage: z.number(),
  }),
});

const OpenRouterKeyResponseSchema = z.object({
  data: z.object({
    // Null for a key with no spending limit of its own.
    limit_remaining: z.number().nullable(),
  }),
});

/**
 * What an OpenRouter key can still spend: the account's balance, or less when
 * the key has a limit of its own, since a key draws on the account and stops
 * at whichever runs out first.
 */
export function fetchCredits(
  config: Pick<AIGatewayProviderConfig.Type, "apiKey" | "baseURL" | "type">,
) {
  if (config.type !== "openrouter") {
    return Result.error(
      new TypedError.Fetch(
        `Credits fetching is not supported for provider: ${config.type}`,
      ),
    );
  }

  return Result.fromAsync(async () => {
    const headers = new Headers({ "Content-Type": "application/json" });
    setProviderAuthHeaders(headers, config);

    const read = async <T>(path: `/${string}`, schema: z.ZodType<T>) => {
      const response = await fetch(apiURL({ config, path }), { headers });
      if (!response.ok) {
        throw new Error(`Failed to fetch ${path} (${String(response.status)})`);
      }
      return schema.parse(await response.json());
    };

    return Result.try(
      async () => {
        const [account, key] = await Promise.all([
          read("/credits", OpenRouterCreditsResponseSchema),
          read("/key", OpenRouterKeyResponseSchema),
        ]);
        const accountRemaining =
          account.data.total_credits - account.data.total_usage;
        const keyRemaining = key.data.limit_remaining;
        return {
          remaining:
            keyRemaining === null
              ? accountRemaining
              : Math.min(keyRemaining, accountRemaining),
        };
      },
      (error) =>
        new TypedError.Fetch("Failed to fetch credits", {
          cause: error,
        }),
    );
  });
}
