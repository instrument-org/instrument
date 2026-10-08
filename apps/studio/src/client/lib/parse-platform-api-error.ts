import { OUR_MODELS } from "@instrument-org/shared";
import { type SessionMessage } from "@instrument-org/workspace/client";
import { z } from "zod";

const platformApiErrorResponseSchema = z
  .string()
  .transform((jsonString, ctx) => {
    try {
      return JSON.parse(jsonString) as unknown;
    } catch (error: unknown) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid JSON",
      });
      return z.NEVER;
    }
  })
  .pipe(
    z.object({
      error: z.object({
        code: z.string(),
        message: z.string().optional(),
        reason: z.string().optional(),
        resetsAt: z.string().optional(),
        retryable: z.boolean().optional(),
        window: z.string().optional(),
      }),
    }),
  );

/**
 * A refusal from our own platform, read off the response body. `reason` comes
 * with `subscription-required` (`trial-ended`, `no-plan`, ...); `window` and
 * `resetsAt` with `usage-limit-exceeded`.
 */
interface PlatformApiError {
  code: PlatformApiErrorCode;
  message?: string;
  reason?: string;
  resetsAt?: string;
  retryable?: boolean;
  window?: string;
}

type PlatformApiErrorCode =
  | "concurrency-limit"
  | "meter-unavailable"
  | "model-not-allowed"
  | "model-not-found"
  | "no-model-requested"
  | "rate-limit-exceeded"
  | "subscription-required"
  | "usage-limit-exceeded";

export function parsePlatformApiError(
  message: SessionMessage.Assistant,
): null | PlatformApiError {
  const metadataError = message.metadata.error;
  if (
    metadataError?.kind !== "api-call" ||
    message.metadata.aiGatewayModel?.params.provider !== OUR_MODELS.providerType
  ) {
    return null;
  }

  if (!metadataError.responseBody) {
    return null;
  }

  const result = platformApiErrorResponseSchema.safeParse(
    metadataError.responseBody,
  );
  if (!result.success) {
    return null;
  }
  const { code, ...rest } = result.data.error;
  return { ...rest, code: code as PlatformApiErrorCode };
}

export function requiresAutoModelRecovery(
  message: SessionMessage.Assistant,
): boolean {
  const error = parsePlatformApiError(message);
  return (
    error?.code === "model-not-allowed" ||
    error?.code === "model-not-found" ||
    error?.code === "no-model-requested"
  );
}
