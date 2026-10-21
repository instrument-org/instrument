import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceMachineDir } from "@/electron-main/lib/get-workspace-folder";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  type FeatureName,
  FeatureNameSchema,
  type Features,
  FeaturesSchema,
} from "@/shared/features";
import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { APP_FLAVOR } from "@instrument-org/shared";
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

/**
 * Every feature, off. A file with a flag missing would leave a switch bound
 * to it reading nothing where the type promises a boolean, so the switch
 * would render uncontrolled; parsed rather than built, so the keys come from
 * the one list of them.
 */
function featuresAllOff(): Features {
  return FeaturesSchema.parse(
    Object.fromEntries(FeatureNameSchema.options.map((name) => [name, false])),
  );
}

/**
 * What a person chose for this workspace on this computer, kept in its
 * machine folder: another computer, or another person sharing the
 * workspace, makes choices of its own. Machine-wide choices are in
 * `machine/preferences.ts`.
 */
export const WorkspacePreferencesSchema = z.object({
  agentCompletionNotifications:
    AgentCompletionNotificationModeSchema.catch("unfocused"),
  // Ads and trackers blocked in the in-app browser; see content-blocking.ts.
  blockAds: z.boolean().catch(true),
  defaultModelURI: AIGatewayModelURI.Schema.optional().catch(undefined),
  // On from the start in a development run and in a preview, which are both
  // built to be looked into.
  developerMode: z
    .boolean()
    .catch(import.meta.env.DEV || APP_FLAVOR.kind === "preview"),
  /**
   * The experimental features the developer panel turns on. Here rather than
   * in a `features.json` of its own: a flag is one of the person's choices
   * for the workspace like the rest of these, and one file is one read, one
   * write and one event. Read flag by flag, so a file from a build with
   * fewer flags keeps the ones it has, and one this build does not know is
   * dropped.
   */
  features: z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((stored) =>
      FeaturesSchema.parse({
        ...featuresAllOff(),
        ...Object.fromEntries(
          Object.entries(stored).filter(
            ([name, value]) =>
              FeatureNameSchema.safeParse(name).success &&
              typeof value === "boolean",
          ),
        ),
      }),
    ),
  theme: z.enum(["light", "dark", "system"]).catch("system"),
});

type WorkspacePreferences = z.output<typeof WorkspacePreferencesSchema>;

let STORE: null | Store<WorkspacePreferences> = null;

export const getWorkspacePreferences = (): Store<WorkspacePreferences> => {
  if (STORE === null) {
    const defaults = WorkspacePreferencesSchema.parse({});
    STORE = new Store<WorkspacePreferences>({
      cwd: workspaceMachineDir(),
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

/** Every experimental feature and whether it is on, each by name. */
export function getWorkspaceFeatures(): Features {
  return FeaturesSchema.parse({
    ...featuresAllOff(),
    ...getWorkspacePreferences().get("features"),
  });
}

export function setWorkspaceFeature(
  feature: FeatureName,
  enabled: boolean,
): void {
  getWorkspacePreferences().set("features", {
    ...getWorkspaceFeatures(),
    [feature]: enabled,
  });
}
