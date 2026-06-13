import { z } from "zod";

export namespace FileUpload {
  const AbsoluteLocalPathSchema = z
    .string()
    .refine(
      (value) => value.startsWith("/") || /^[a-z]:[\\/]/i.test(value),
      "Path must be absolute",
    );

  const Base64Schema = z.object({
    content: z.string(),
    filename: z.string(),
  });

  const LocalPathSchema = z.object({
    filename: z.string(),
    mimeType: z.string(),
    path: AbsoluteLocalPathSchema,
    size: z.number(),
  });

  export const Schema = z.union([Base64Schema, LocalPathSchema]);

  export type Type = z.output<typeof Schema>;
}
