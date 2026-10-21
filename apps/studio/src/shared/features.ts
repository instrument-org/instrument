import { z } from "zod";

export const FeatureNameSchema = z.enum([
  "context_ring",
  "suggestions_from_your_chats",
]);
export type FeatureName = z.output<typeof FeatureNameSchema>;

export const FeaturesSchema = z.record(FeatureNameSchema, z.boolean());

export type Features = z.output<typeof FeaturesSchema>;

/**
 * `code` is the flag's letter in the developer panel's strip, which is read by
 * position: each flag keeps its slot whether it is on or off, so letters only
 * have to be distinct from each other.
 */
export const FEATURE_METADATA: Record<
  FeatureName,
  { code: string; description: string; title: string }
> = {
  context_ring: {
    code: "c",
    description:
      "Show a context window usage ring in the prompt input for the active session.",
    title: "Context Ring",
  },
  suggestions_from_your_chats: {
    code: "s",
    description:
      "The decision model reads your chat titles, drafts, and topic names to find chats by meaning, file drafts and chats under topics, and suggest an emoji for a topic's name.",
    title: "Suggestions From Your Chats",
  },
};
