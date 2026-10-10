import { z } from "zod";

export const FeatureNameSchema = z.enum([
  "bash_summary_chip",
  "context_ring",
  "external_browser",
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
  bash_summary_chip: {
    code: "b",
    description: "Show compact bash command names in tool call summaries.",
    title: "Bash Summary Chip",
  },
  context_ring: {
    code: "c",
    description:
      "Show a context window usage ring in the prompt input for the active session.",
    title: "Context Ring",
  },
  external_browser: {
    code: "x",
    description:
      "Let the agent drive a browser outside the app: the user's own Chrome profile and its logins, a Chromium already running with remote debugging, or a cloud browser. macOS asks for a system permission the first time.",
    title: "External Browser",
  },
};
