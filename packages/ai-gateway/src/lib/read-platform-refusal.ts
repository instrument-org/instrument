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

const PlanRefusalBodySchema = z.object({
  error: z.object({
    code: z.enum(["subscription-required", "usage-limit-exceeded"]),
    reason: z.string().optional(),
    resetsAt: z.string().optional(),
  }),
});

/**
 * Our platform turning a hosted request away for the account's plan: no
 * plan for it (402 `subscription-required`, with `reason`), or its usage
 * spent until `resetsAt` (429 `usage-limit-exceeded`).
 */
export type PlanRefusal = z.output<typeof PlanRefusalBodySchema>["error"];

/**
 * The plan refusal a response body says, from its text. Undefined for any
 * other body: a concurrency limit, a server error, or a provider's own 402
 * or 429 passed through.
 */
export function planRefusalIn(
  body: string | undefined,
): PlanRefusal | undefined {
  if (!body) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  const result = PlanRefusalBodySchema.safeParse(parsed);
  return result.success ? result.data.error : undefined;
}
