import { APICallError } from "ai";
import { z } from "zod";

export const gatewayResponseBodySchema = z
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
      // Only the two fields anything here reads. `code` is deliberately absent:
      // providers disagree about whether it is a string or the HTTP status as a
      // number, and demanding either made every body carrying the other one
      // fail to parse, taking `message` and `retryable` down with it.
      error: z
        .object({
          message: z.string().optional(),
          retryable: z.boolean().optional(),
        })
        .optional(),
    }),
  );

export function isNonRetryableGatewayError(error: unknown): boolean {
  if (!APICallError.isInstance(error) || !error.responseBody) {
    return false;
  }
  const result = gatewayResponseBodySchema.safeParse(error.responseBody);
  return result.success && result.data.error?.retryable === false;
}
