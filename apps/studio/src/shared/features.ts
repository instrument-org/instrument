import { z } from "zod";

export const FeatureNameSchema = z.enum([
  "activity_headings",
  "bash_summary_chip",
  "context_ring",
  "external_browser",
  "float_every_draft",
  "instrument_2",
  "prompt_queue",
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
  float_every_draft: {
    description:
      "In Instrument 2.0, a thread started from Chat opens in the small view in the corner, the way one started from Files or Apps does, rather than lighting its row.",
    title: "Float every draft",
  },
  instrument_2: {
    description:
      "Open the app in the Instrument 2.0 window and keep the classic window out of sight. Takes effect on the next launch; this panel is in both windows, so it is also how you come back.",
    title: "Start in Instrument 2.0",
  },
  prompt_queue: {
    description:
      "Queue follow-up prompts while the agent is running; each is sent automatically when the current turn finishes.",
    title: "Prompt Queue",
  },
  skills: {
    description:
      "Browse installed agent skills from the sidebar and invoke one by typing / in the prompt.",
    title: "Skills",
  },
};
