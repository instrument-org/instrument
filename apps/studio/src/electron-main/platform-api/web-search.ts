import { noteHostedRefusal } from "@/electron-main/lib/hosted-features";
import { platformApiBaseUrl } from "@/electron-main/platform-api/base-url";
import { systemCountry } from "@/electron-main/lib/system-country";
import { getToken } from "@/electron-main/platform-api/utils";
import { PlanRefusalResponseSchema } from "@/shared/billing";
import {
  type PlatformSearchRefusal,
  type WebSearchClient,
  WebSearchResponseSchema,
} from "@instrument-org/workspace/electron";
import { z } from "zod";

import { getPlatformApiHeaders } from "./headers";

const ErrorResponseSchema = z.object({
  error: z.string(),
});

export const searchWeb: WebSearchClient = async ({ input, signal }) => {
  if (!getToken()) {
    return {
      errorMessage: "Sign in to Instrument to search the web.",
      errorType: "not-authenticated",
      ok: false,
    };
  }

  let response: Response;
  try {
    response = await fetch(`${platformApiBaseUrl()}/search`, {
      // The country biases ranking toward local results ("weather", "DMV
      // hours"); a server that predates the field drops it.
      body: JSON.stringify({ ...input, userLocation: systemCountry() }),
      headers: {
        ...getPlatformApiHeaders(),
        "content-type": "application/json",
      },
      method: "POST",
      signal,
    });
  } catch (error) {
    return {
      errorMessage: signal.aborted
        ? "Web search was cancelled."
        : `Web search request failed: ${error instanceof Error ? error.message : "unknown error"}.`,
      errorType: "request-failed",
      ok: false,
    };
  }

  const responseBody = await response.text();
  if (!response.ok) {
    let errorMessage = `Web search failed with status ${response.status}.`;
    let refusal: PlatformSearchRefusal | undefined;
    try {
      const errorJson: unknown = JSON.parse(responseBody);
      const parsedError = ErrorResponseSchema.safeParse(errorJson);
      if (parsedError.success) {
        errorMessage = parsedError.data.error;
      }
      const parsedRefusal = PlanRefusalResponseSchema.safeParse(errorJson);
      if (parsedRefusal.success) {
        refusal = parsedRefusal.data.error;
      }
    } catch {
      // Preserve the status-based message when the server did not return JSON.
    }
    // A refusal for the plan is news about what runs, so the status is read
    // again, and the next search is routed by it.
    if (refusal) {
      noteHostedRefusal({
        at: Date.now(),
        code: refusal.code,
        details: {},
        path: "search",
        status: response.status,
      });
    }
    return {
      errorMessage,
      ...(refusal && { refusal }),
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

  let responseJson: unknown;
  try {
    responseJson = JSON.parse(responseBody);
  } catch {
    return {
      errorMessage: "Web search returned an unexpected response.",
      errorType: "request-failed",
      ok: false,
      responseBody,
    };
  }
  const parsedResponse = WebSearchResponseSchema.safeParse(responseJson);
  if (!parsedResponse.success) {
    return {
      errorMessage: "Web search returned an unexpected response.",
      errorType: "request-failed",
      ok: false,
      responseBody,
    };
  }

  return { data: parsedResponse.data, ok: true };
};
