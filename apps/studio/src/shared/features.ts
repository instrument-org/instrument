import { z } from "zod";

export const FeatureNameSchema = z.enum([
  "bash_summary_chip",
  "context_ring",
  "external_browser",
  "prompt_queue",
  "quick_capture_overlay",
  "skills",
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
  prompt_queue: {
    description:
      "Queue follow-up prompts while the agent is running; each is sent automatically when the current turn finishes.",
    title: "Prompt Queue",
  },
  quick_capture_overlay: {
    description:
      "Summon a floating panel from anywhere with Option+Space to start a task, switch between tasks, and read a transcript without opening the main window.",
    title: "Quick Capture Overlay",
  },
  skills: {
    description:
      "Browse installed agent skills from the sidebar and invoke one by typing / in the prompt.",
    title: "Skills",
  },
};
