import { logger } from "@/electron-main/lib/electron-logger";
import { publisher } from "@/electron-main/rpc/publisher";
import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { app } from "electron";
import Store from "electron-store";
import semver from "semver";
import { z } from "zod";

function getDefaultEnableUsageMetrics() {
  return process.env.ELECTRON_USE_NEW_USER_FOLDER !== "true";
}

// "unfocused" notifies only when Instrument is not the active window.
export const AgentCompletionNotificationModeSchema = z.enum([
  "always",
  "unfocused",
  "never",
]);

export type AgentCompletionNotificationMode = z.output<
  typeof AgentCompletionNotificationModeSchema
>;

/* eslint-disable unicorn/prefer-top-level-await */
export const PreferencesStoreSchema = z.object({
  agentCompletionNotifications:
    AgentCompletionNotificationModeSchema.catch("unfocused"),
  defaultModelURI: AIGatewayModelURI.Schema.optional().catch(undefined),
  developerMode: z.boolean().catch(import.meta.env.DEV), // Default to true when running app in development mode
  enableUsageMetrics: z.boolean().catch(getDefaultEnableUsageMetrics()),
  lastLaunchedVersion: z.string().optional(),
  lastUpdateCheck: z.number().optional(),
  preferApiKeyOverAccount: z.boolean().catch(false),
  // Release channels are not exposed to the user and are used internally for testing
  releaseChannel: z
    .enum(["latest", "beta", "alpha"])
    .optional()
    .catch(undefined),
  theme: z.enum(["light", "dark", "system"]).catch("system"),
});
/* eslint-enable unicorn/prefer-top-level-await */

type PreferencesStore = z.output<typeof PreferencesStoreSchema>;

let PREFERENCES_STORE: null | Store<PreferencesStore> = null;

export const getPreferencesStore = (): Store<PreferencesStore> => {
  if (PREFERENCES_STORE === null) {
    const defaultPreferences = PreferencesStoreSchema.parse({});
    PREFERENCES_STORE = new Store<PreferencesStore>({
      defaults: defaultPreferences,
      deserialize: (value) => {
        const parsed = PreferencesStoreSchema.safeParse(JSON.parse(value));

        if (parsed.success) {
          return parsed.data;
        }

        logger.error("Failed to parse preferences state", parsed.error);

        return defaultPreferences;
      },
      name: "preferences",
    });

    PREFERENCES_STORE.onDidAnyChange(() => {
      publisher.publish("preferences.updated", null);
    });
  }

  return PREFERENCES_STORE;
};

interface VersionBump {
  from: string;
  to: string;
}

export function getDefaultModelURI(): AIGatewayModelURI.Type | undefined {
  const store = getPreferencesStore();
  return store.get("defaultModelURI");
}

export function isDeveloperMode() {
  const store = getPreferencesStore();
  return store.get("developerMode");
}

export function setDefaultModelURI(modelURI: AIGatewayModelURI.Type): void {
  const store = getPreferencesStore();
  store.set("defaultModelURI", modelURI);
}

export function setLastUpdateCheck(): void {
  const store = getPreferencesStore();
  store.set("lastUpdateCheck", Date.now());
}

// Computed once at startup and consumed exactly once, so the "updated" toast
// fires for the launch that followed the update and not again on a later
// renderer reload.
let recentVersionBump: null | VersionBump = null;
let versionBumpChecked = false;

// Compares the version we last launched with the version running now. A
// strictly-newer running version means the app was updated since the last
// launch. Persists the current version so the next launch has a baseline.
//
// Only packaged builds can be updated, and only there does the version track
// installs: unpackaged builds read it from the checked-out package.json, so
// every release commit pulled in reads as an update. Dev instances also share
// one userData directory, so worktrees on different commits trade the baseline
// back and forth and each relaunch of the newer one claims a bump.
// FORCE_DEV_AUTO_UPDATE, which already puts the updater itself in its packaged
// behavior, is the way to exercise this in dev.
export function checkRecentVersionBump(): void {
  if (versionBumpChecked) {
    return;
  }
  versionBumpChecked = true;

  if (!app.isPackaged && process.env.FORCE_DEV_AUTO_UPDATE !== "true") {
    return;
  }

  const store = getPreferencesStore();
  const previous = store.get("lastLaunchedVersion");
  const current = app.getVersion();

  if (
    previous &&
    previous !== current &&
    semver.valid(previous) &&
    semver.valid(current) &&
    semver.gt(current, previous)
  ) {
    recentVersionBump = { from: previous, to: current };
  }

  store.set("lastLaunchedVersion", current);
}

// Returns the pending version bump and clears it, so only the first caller sees
// it however many times the renderer asks.
export function consumeRecentVersionBump(): null | VersionBump {
  const bump = recentVersionBump;
  recentVersionBump = null;
  return bump;
}

/**
 * Queues a bump for the next reader, for the dev panel's simulation. The real
 * one is computed once at startup from a version the developer cannot move
 * without editing their own config, so this is the only way to see the toast
 * outside an actual update. Consumed the same way, by whoever asks first.
 */
export function setRecentVersionBump(bump: VersionBump): void {
  recentVersionBump = bump;
}
