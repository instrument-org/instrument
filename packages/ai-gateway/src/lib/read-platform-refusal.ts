import { z } from "zod";

import { type PlatformRefusal } from "../types";

/** The statuses our platform refuses a hosted request with. */
export const REFUSAL_STATUSES = new Set([402, 429, 503]);

const PlatformRefusalBodySchema = z.object({
  error: z.looseObject({ code: z.string(), message: z.string().optional() }),
});

/**
 * A refusal's code and fields, read off a copy of the response so the caller
 * still streams the original. Anything without an `error.code` (an upstream
 * provider's own 429 passed through, say) is not one of ours.
 */
export async function readPlatformRefusal(
  response: Response,
  path: string,
): Promise<PlatformRefusal | undefined> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return;
  }
  const parsed = PlatformRefusalBodySchema.safeParse(body);
  if (!parsed.success) {
    return;
  }
  const { code, message, ...details } = parsed.data.error;
  const retryAfter = Number(response.headers.get("retry-after"));
  return {
    at: Date.now(),
    code,
    details,
    message,
    path,
    ...(Number.isFinite(retryAfter) &&
      retryAfter > 0 && { retryAfterSeconds: retryAfter }),
    status: response.status,
  };
}
