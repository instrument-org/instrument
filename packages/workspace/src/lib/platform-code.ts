import { z } from "zod";

/**
 * The `error.code` our own platform puts on a refusal, read off a response
 * body. Only for bodies already known to come from our platform: other
 * providers send `code` as a number as often as a string.
 */
export const platformCodeSchema = z
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
  .pipe(z.object({ error: z.object({ code: z.string() }) }));
