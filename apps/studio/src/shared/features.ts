import { z } from "zod";

export const FeatureNameSchema = z.enum([
  "computer_use",
  "context_ring",
  "suggestions_from_your_chats",
]);
export type FeatureName = z.output<typeof FeatureNameSchema>;

export const FeaturesSchema = z.record(FeatureNameSchema, z.boolean());

export type Features = z.output<typeof FeaturesSchema>;

export const FEATURE_METADATA: Record<
  FeatureName,
  { description: string; title: string }
> = {
  computer_use: {
    description:
      "Let the agent work in your other apps, each with your yes. Set it up under Computer Use in Settings.",
    title: "Computer Use",
  },
  context_ring: {
    description:
      "Show a context window usage ring in the prompt input for the active session.",
    title: "Context Ring",
  },
  suggestions_from_your_chats: {
    description:
      "The decision model reads your chat titles, drafts, and project names to find chats by meaning, file drafts and chats under projects, and suggest an emoji for a project's name.",
    title: "Suggestions From Your Chats",
  },
};
