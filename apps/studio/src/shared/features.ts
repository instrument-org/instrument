import { z } from "zod";

export const FeatureNameSchema = z.enum([
  "browser_extensions",
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
  browser_extensions: {
    description:
      "The in-app browser can run 1Password from the Chrome Web Store. Relaunch Instrument after you change this.",
    title: "Browser Extensions",
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
