import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceSettingsDir } from "@/electron-main/lib/get-workspace-folder";
import { publisher } from "@/electron-main/rpc/publisher";
import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import Store from "electron-store";
import { z } from "zod";

// "unfocused" notifies only when Instrument is not the active window.
export const AgentCompletionNotificationModeSchema = z.enum([
  "always",
  "unfocused",
  "never",
]);

export type AgentCompletionNotificationMode = z.output<
  typeof AgentCompletionNotificationModeSchema
>;

/** What a person chose for this workspace. Machine-wide choices are in `machine/preferences.ts`. */
export const WorkspacePreferencesSchema = z.object({
  agentCompletionNotifications:
    AgentCompletionNotificationModeSchema.catch("unfocused"),
  defaultModelURI: AIGatewayModelURI.Schema.optional().catch(undefined),
  developerMode: z.boolean().catch(import.meta.env.DEV), // Default to true when running app in development mode
  theme: z.enum(["light", "dark", "system"]).catch("system"),
});

type WorkspacePreferences = z.output<typeof WorkspacePreferencesSchema>;

let STORE: null | Store<WorkspacePreferences> = null;

export const getWorkspacePreferences = (): Store<WorkspacePreferences> => {
  if (STORE === null) {
    const defaults = WorkspacePreferencesSchema.parse({});
    STORE = new Store<WorkspacePreferences>({
      cwd: workspaceSettingsDir(),
      defaults,
      deserialize: (value) => {
        const parsed = WorkspacePreferencesSchema.safeParse(JSON.parse(value));

        if (parsed.success) {
          return parsed.data;
        }

        logger.error("Failed to parse workspace preferences", parsed.error);

        return defaults;
      },
      name: "preferences",
    });

    STORE.onDidAnyChange(() => {
      publisher.publish("preferences.updated", null);
    });
  }

  return STORE;
};

export function getDefaultModelURI(): AIGatewayModelURI.Type | undefined {
  return getWorkspacePreferences().get("defaultModelURI");
}

export function isDeveloperMode() {
  return getWorkspacePreferences().get("developerMode");
}

export function setDefaultModelURI(modelURI: AIGatewayModelURI.Type): void {
  getWorkspacePreferences().set("defaultModelURI", modelURI);
}
