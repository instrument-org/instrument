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
        retryable: z.boolean().optional(),
      }),
    }),
  );

interface PlatformApiError {
  code: PlatformApiErrorCode;
  message?: string;
  retryable?: boolean;
}

type PlatformApiErrorCode =
  | "insufficient-credits"
  | "model-not-allowed"
  | "model-not-found"
  | "no-model-requested";

export function parsePlatformApiError(
  message: SessionMessage.Assistant,
): null | PlatformApiError {
  const metadataError = message.metadata.error;
  if (
    !metadataError ||
    metadataError.kind !== "api-call" ||
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
  if (result.success) {
    return {
      code: result.data.error.code as PlatformApiErrorCode,
      message: result.data.error.message,
      retryable: result.data.error.retryable,
    };
  }

  if (
    metadataError.responseBody.toLowerCase().includes("insufficient credits")
  ) {
    return {
      code: "insufficient-credits",
      message: "Insufficient credits",
    };
  }

  return null;
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
