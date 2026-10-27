import { APP_CLIENT_NAME_STUDIO } from "@instrument-org/shared";
import fs from "node:fs";
import { z } from "zod";

import {
  unavailableWebSearchClient,
  type WebSearchClient,
  WebSearchResponseSchema,
} from "../../src/schemas/web-search";

const AccountFileSchema = z.object({
  api: z.string().url(),
  token: z.string().min(1),
});

/**
 * Web search through the platform's own `/search`, as Studio searches, for a
 * run whose cost has to include what searching adds to a conversation.
 *
 * Opt-in: `EVAL_SEARCH_ACCOUNT` names an account file (`pnpm billing
 * scenario pro --env preview` in the internal repo writes one), and every
 * search is metered against that account. Without it search is unavailable,
 * as it has always been here, so an ordinary run spends nothing on it.
 */
export function platformSearchClient(): WebSearchClient {
  const file = process.env.EVAL_SEARCH_ACCOUNT;
  if (!file) {
    return unavailableWebSearchClient;
  }
  const account = AccountFileSchema.parse(
    JSON.parse(fs.readFileSync(file, "utf8")),
  );
  return async ({ input, signal }) => {
    let response: Response;
    try {
      response = await fetch(`${account.api}/search`, {
        body: JSON.stringify(input),
        headers: {
          authorization: `Bearer ${account.token}`,
          "content-type": "application/json",
          "x-client-name": APP_CLIENT_NAME_STUDIO,
          "x-client-version": "0.0.0-eval",
        },
        method: "POST",
        signal,
      });
    } catch (error) {
      return {
        errorMessage: `Web search request failed: ${error instanceof Error ? error.message : "unknown error"}.`,
        errorType: "request-failed",
        ok: false,
      };
    }
    const responseBody = await response.text();
    if (!response.ok) {
      return {
        errorMessage: `Web search failed with status ${response.status}.`,
        errorType:
          response.status === 401
            ? "not-authenticated"
            : response.status === 402
              ? "payment-required"
              : "request-failed",
        ok: false,
        responseBody,
      };
    }
    const parsed = WebSearchResponseSchema.safeParse(
      JSON.parse(responseBody) as unknown,
    );
    return parsed.success
      ? { data: parsed.data, ok: true }
      : {
          errorMessage: "Web search returned an unexpected response.",
          errorType: "request-failed",
          ok: false,
          responseBody,
        };
  };
}
