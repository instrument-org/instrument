import { AIProviderTypeSchema } from "@instrument-org/shared";
import { z } from "zod";

const ProviderTagsSchema = z.enum([
  "imageGeneration",
  "recommended",
  "webSearch",
]);

const ProviderQuirksSchema = z
  .object({
    supportsMultipartToolResults: z.boolean().optional().default(false),
  })
  .optional()
  .prefault({});

// How large an image the provider renders before it downscales one server-side.
// Providers bill and sample images in square patches, so the budget has two
// halves: a longest-edge cap and a cap on the total patch count.
//
// The defaults are the smallest budget any provider we support is known to
// render at, not the largest. Sending an image the provider then downscales
// again would leave us describing a pixel space the model never saw, which is
// the failure this whole block exists to prevent. Raise a provider's numbers
// only where its floor is documented.
const ProviderImageViewSchema = z
  .object({
    maxEdge: z.number().int().positive().optional().default(1568),
    maxPatches: z.number().int().positive().optional().default(1568),
    patchSize: z.number().int().positive().optional().default(28),
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
  imageView: ProviderImageViewSchema,
  name: z.string(),
  quirks: ProviderQuirksSchema,
  requiresAPIKey: z.boolean().optional().default(true),
  tags: z.array(ProviderTagsSchema).optional().default([]),
  type: AIProviderTypeSchema,
  url: z.string(),
});

export type ProviderImageView = z.output<typeof ProviderImageViewSchema>;
export type ProviderMetadata = z.output<typeof ProviderMetadataSchema>;
export type ProviderMetadataInput = z.input<typeof ProviderMetadataSchema>;
