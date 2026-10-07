import { z } from "zod";

export const FeatureNameSchema = z.enum([
  "bash_summary_chip",
  "computer_use",
  "context_ring",
  "external_browser",
]);
export type FeatureName = z.output<typeof FeatureNameSchema>;

export const FeaturesSchema = z.record(FeatureNameSchema, z.boolean());

export type Features = z.output<typeof FeaturesSchema>;

export const FEATURE_METADATA: Record<
  FeatureName,
  { description: string; title: string }
> = {
  bash_summary_chip: {
    description: "Show compact bash command names in tool call summaries.",
    title: "Bash Summary Chip",
  },
  computer_use: {
    description:
      "With Computer Use, the agent can work in your other apps the way you would, usually without moving your pointer.",
    title: "Computer Use",
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
};
