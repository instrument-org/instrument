import { AIProviderTypeSchema } from "@instrument-org/shared";
import { z } from "zod";

const ProviderTagsSchema = z.enum([
  "imageGeneration",
  "recommended",
  "webSearch",
]);

const MediaCategorySchema = z.enum(["audio", "file", "image", "video"]);

const ProviderQuirksSchema = z
  .object({
    // Combinations where the upstream provider/author advertises support for a
    // media category but is known to reject (or mishandle) requests in
    // practice. Matched against the model's `author`. Takes precedence over
    // the model's `features` array.
    brokenMedia: z
      .array(
        z.object({
          author: z.string(),
          category: MediaCategorySchema,
        }),
      )
      .optional()
      .default([]),
    // The provider requires every file part to include a `filename`. Without
    // it some upstreams reject the request, e.g. xAI via OpenRouter:
    // "input_file.filename is required when file_data is set".
    requiresFilenameOnFileParts: z.boolean().optional().default(false),
    // Provider natively accepts multipart tool result outputs. When false,
    // multipart results must be split into a tool message + follow-up user
    // message before being sent.
    supportsMultipartToolResults: z.boolean().optional().default(false),
  })
  .optional()
  .prefault({});

export const ProviderMetadataSchema = z.object({
  api: z.object({
    // Usually this is the OpenAI API compatible URL, but sometimes it's the raw
    // API URL if they have their own API that expects a different path.
    // If that's the case, then openai-compatible-url.ts handles the mapping.
    defaultBaseURL: z.string(),
    keyFormat: z.string().optional(),
    keyURL: z.string().optional(),
  }),
  canAddManually: z.boolean().optional().default(true).meta({
    description:
      "Whether the provider can be added manually (usually via API key) by the user",
  }),
  description: z.string(),
  name: z.string(),
  quirks: ProviderQuirksSchema,
  requiresAPIKey: z.boolean().optional().default(true),
  tags: z.array(ProviderTagsSchema).optional().default([]),
  type: AIProviderTypeSchema,
  url: z.string(),
});

export type ProviderMetadata = z.output<typeof ProviderMetadataSchema>;
export type ProviderMetadataInput = z.input<typeof ProviderMetadataSchema>;
