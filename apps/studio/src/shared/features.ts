import { z } from "zod";

export const FeatureNameSchema = z.enum([
  "activity_headings",
  "bash_summary_chip",
  "context_ring",
  "external_browser",
  "skills",
]);
export type FeatureName = z.output<typeof FeatureNameSchema>;

export const FeaturesSchema = z.record(FeatureNameSchema, z.boolean());

export type Features = z.output<typeof FeaturesSchema>;

export const FEATURE_METADATA: Record<
  FeatureName,
  { description: string; title: string }
> = {
  activity_headings: {
    description:
      "Give task agents the start_activity tool, which heads each phase of work with a title. Off because models always send it as a step of its own, a model round trip that does nothing else.",
    title: "Activity Headings",
  },
  bash_summary_chip: {
    description: "Show compact bash command names in tool call summaries.",
    title: "Bash Summary Chip",
  },
  context_ring: {
    description:
      "Show a context window usage ring in the prompt input for the active session.",
    title: "Context Ring",
  },
  external_browser: {
    description:
      "Let the agent drive a browser outside the app: the user's own Chrome profile and its logins, a Chromium already running with remote debugging, or a cloud browser. macOS asks for a system permission the first time.",
    title: "External Browser",
  },
  skills: {
    description:
      "Offer installed agent skills in the composer, from its plus menu or by typing / in the prompt.",
    title: "Skills",
  },
};
