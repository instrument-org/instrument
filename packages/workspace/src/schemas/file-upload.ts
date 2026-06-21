import { z } from "zod";

import { AbsolutePathSchema } from "./paths";

export namespace FileUpload {
  const Base64Schema = z.object({
    content: z.string(),
    filename: z.string(),
  });

  const LocalPathSchema = z.object({
    filename: z.string(),
    mimeType: z.string(),
    path: AbsolutePathSchema,
    size: z.number(),
  });

  export const Schema = z.union([Base64Schema, LocalPathSchema]);

  export type Input = z.input<typeof Schema>;
  export type Type = z.output<typeof Schema>;
}
