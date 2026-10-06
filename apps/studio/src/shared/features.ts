import { z } from "zod";

export const FeatureNameSchema = z.enum([
  "bash_summary_chip",
  "context_ring",
  "external_browser",
  "one_agent",
  "one_agent_foreground",
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
  one_agent: {
    description:
      "Chats run one agent that does quick work itself and forks multi-step work to the background with the conversation in hand, instead of briefing a separate task agent. Takes effect for a chat the next time its session starts.",
    title: "One Agent",
  },
  one_agent_foreground: {
    description:
      "With One Agent on, the chat does every job itself in the conversation, with no background work. For comparing against One Agent's forks.",
    title: "One Agent, No Background",
  },
};
