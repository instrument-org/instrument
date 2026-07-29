import { getToken } from "@/electron-main/platform-api/utils";
import {
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
    response = await fetch(
      `${import.meta.env.MAIN_VITE_APP_API_BASE_URL}/search`,
      {
        body: JSON.stringify(input),
        headers: {
          ...getPlatformApiHeaders(),
          "content-type": "application/json",
        },
        method: "POST",
        signal,
      },
    );
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
    try {
      const errorJson: unknown = JSON.parse(responseBody);
      const parsedError = ErrorResponseSchema.safeParse(errorJson);
      if (parsedError.success) {
        errorMessage = parsedError.data.error;
      }
    } catch {
      // Preserve the status-based message when the server did not return JSON.
    }
    return {
      errorMessage,
      errorType: "request-failed",
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
