import {
  allowProgramsWithoutSandbox,
  liveRead,
} from "@instrument-org/workspace/electron";
import { showAgentCompletionTestNotification } from "@/electron-main/lib/agent-completion-notifications";
import {
  notificationSettingsTarget,
  openNotificationSettings as openSystemNotificationSettings,
} from "@/electron-main/lib/notification-settings";
import { effectiveDefaultModelURI } from "@/electron-main/lib/set-default-model";
import { canRelaunch, relaunchApp } from "@/electron-main/lib/relaunch";
import {
  buildDefaultPlatformApiBaseUrl,
  platformApiBaseUrl,
} from "@/electron-main/platform-api/base-url";
import { base, devOnly } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  getMachinePreferences,
  MachinePreferencesSchema,
} from "@/electron-main/stores/machine/preferences";
import {
  getMachineState,
  setLastUpdateCheck,
} from "@/electron-main/stores/machine/state";
import {
  AgentCompletionNotificationModeSchema,
  getWorkspacePreferences,
  WorkspacePreferencesSchema,
} from "@/electron-main/stores/workspace/preferences";
import {
  pinPlace,
  restoreDefaultPlaces,
  type SidebarPlaces,
  unpinPlace,
} from "@/shared/sidebar-places";
import {
  offersAnyPlatformApiServer,
  PlatformApiServerSchema,
  platformApiServerLabel,
  resolvePlatformApiBaseUrl,
} from "@/shared/platform-api-server";
import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { APP_FLAVOR } from "@instrument-org/shared";
import { call, eventIterator } from "@orpc/server";
import { app } from "electron";
import { z } from "zod";

/** Both halves, as one settings screen reads them. */
const PreferencesSchema = WorkspacePreferencesSchema.extend(
  MachinePreferencesSchema.shape,
).extend({ lastUpdateCheck: z.number().optional() });

function getPreferencesData(): z.output<typeof PreferencesSchema> {
  return {
    ...getWorkspacePreferences().store,
    ...getMachinePreferences().store,
    lastUpdateCheck: getMachineState().get("lastUpdateCheck"),
  };
}

const setTheme = base
  .input(z.object({ theme: z.enum(["light", "dark", "system"]) }))
  .handler(({ input }) => {
    const preferencesStore = getWorkspacePreferences();
    preferencesStore.set("theme", input.theme);
  });

const setAgentCompletionNotifications = base
  .input(z.object({ mode: AgentCompletionNotificationModeSchema }))
  .handler(({ input }) => {
    const preferencesStore = getWorkspacePreferences();
    preferencesStore.set("agentCompletionNotifications", input.mode);
  });

const sendTestNotification = base
  .output(z.object({ supported: z.boolean() }))
  .handler(() => {
    return showAgentCompletionTestNotification();
  });

/** Whether this computer has notification settings the app can open. */
const canOpenNotificationSettings = base.output(z.boolean()).handler(
  async () =>
    (await notificationSettingsTarget({
      env: process.env,
      platform: process.platform,
    })) !== undefined,
);

const openNotificationSettings = base
  .output(z.object({ opened: z.boolean() }))
  .handler(async () => ({ opened: await openSystemNotificationSettings() }));

/** The Files sidebar's Pinned section, changed by `change` and kept. */
function changeSidebarPlaces(change: (places: SidebarPlaces) => SidebarPlaces) {
  const store = getMachinePreferences();
  store.set("sidebarPlaces", change(store.get("sidebarPlaces")));
}

/** Pins a folder to the Files sidebar, or puts back a default unpinned before. */
const pinSidebarPlace = base
  .input(z.object({ path: z.string() }))
  .handler(({ input }) => {
    changeSidebarPlaces((places) => pinPlace(places, input.path));
  });

/** Takes a place off the Files sidebar's Pinned section; a default is hidden until restored. */
const unpinSidebarPlace = base
  .input(z.object({ path: z.string() }))
  .handler(({ input }) => {
    changeSidebarPlaces((places) => unpinPlace(places, input.path));
  });

/** Brings back every default place unpinned, and keeps what the person pinned. */
const restoreDefaultSidebarPlaces = base.handler(() => {
  changeSidebarPlaces(restoreDefaultPlaces);
});

/**
 * Lets the programs the agent runs go ahead with no sandbox on this
 * computer, where none holds them, or stops them again.
 */
const setRunProgramsWithoutSandbox = base
  .input(z.object({ enabled: z.boolean() }))
  .handler(({ input }) => {
    getMachinePreferences().set("runProgramsWithoutSandbox", input.enabled);
    allowProgramsWithoutSandbox(input.enabled);
    publisher.publish("notices.updated", null);
  });

const setBlockAds = base
  .input(z.object({ enabled: z.boolean() }))
  .handler(({ input }) => {
    getWorkspacePreferences().set("blockAds", input.enabled);
  });

const setDeveloperMode = base
  .input(z.object({ enabled: z.boolean() }))
  .handler(({ input }) => {
    const preferencesStore = getWorkspacePreferences();
    preferencesStore.set("developerMode", input.enabled);
  });

const setReleaseChannel = base
  .input(z.object({ channel: z.enum(["latest", "beta", "alpha"]).optional() }))
  .handler(({ context, input }) => {
    const preferencesStore = getMachinePreferences();
    if (input.channel === undefined) {
      preferencesStore.delete("releaseChannel");
    } else {
      preferencesStore.set("releaseChannel", input.channel);
    }
    setLastUpdateCheck();
    return context.appUpdater.checkForUpdates({ notify: true });
  });

/**
 * The platform API server this process talks to, settled at startup, and
 * what the window calls it: nothing for production.
 */
const platformApiServer = base
  .output(z.object({ baseUrl: z.string(), label: z.string().optional() }))
  .handler(() => {
    const baseUrl = platformApiBaseUrl();
    return { baseUrl, label: platformApiServerLabel(baseUrl) };
  });

/**
 * Point this computer at another platform API server, which takes a restart.
 * A choice that is the build's own server is kept as no choice, so the build
 * decides again after an update. Local and typed-in servers are offered to a
 * development build alone.
 */
const setPlatformApiServer = devOnly
  .input(z.object({ server: PlatformApiServerSchema }))
  .handler(async ({ errors, input }) => {
    const buildDefault = buildDefaultPlatformApiBaseUrl();
    const baseUrl = resolvePlatformApiBaseUrl({
      buildDefault,
      choice: input.server,
      flavor: APP_FLAVOR,
    });
    const offered =
      input.server === "production" ||
      input.server === "staging" ||
      offersAnyPlatformApiServer(APP_FLAVOR);
    if (!offered) {
      throw errors.UNAUTHORIZED({
        message: "This build talks to production or staging only",
      });
    }
    const choose = () => {
      const store = getMachinePreferences();
      if (baseUrl === buildDefault) {
        store.delete("platformApiServer");
      } else {
        store.set("platformApiServer", input.server);
      }
    };
    // A build that cannot restart itself talks to the chosen server the next
    // time it is started by hand.
    if (!canRelaunch()) {
      choose();
      return { outcome: "unsupported" as const };
    }
    return { outcome: await relaunchApp({ beforeRestart: choose }) };
  });

const checkForUpdates = base.handler(async ({ context }) => {
  setLastUpdateCheck();

  return context.appUpdater.checkForUpdates({ notify: true });
});

const quitAndInstall = base.handler(({ context }) => {
  return context.appUpdater.quitAndInstall();
});

const getAppVersion = base.handler(() => {
  return { version: app.getVersion() };
});

const setDefaultModelURI = base
  .input(z.object({ modelURI: AIGatewayModelURI.Schema }))
  .handler(({ input }) => {
    const preferencesStore = getWorkspacePreferences();
    preferencesStore.set("defaultModelURI", input.modelURI);
  });

const get = base.output(PreferencesSchema).handler(() => {
  return getPreferencesData();
});

const live = {
  defaultModelURI: base
    .output(eventIterator(AIGatewayModelURI.Schema.optional()))
    .handler(async function* ({ signal }) {
      yield* liveRead({
        changes: [
          publisher.subscribe("preferences.updated", { signal }),
          publisher.subscribe("provider-config.updated", { signal }),
        ],
        read: effectiveDefaultModelURI,
      });
    }),
  get: base.handler(async function* ({ context, signal }) {
    yield* liveRead({
      changes: [publisher.subscribe("preferences.updated", { signal })],
      read: () => call(get, {}, { context, signal }),
    });
  }),
};

export const preferences = {
  canOpenNotificationSettings,
  checkForUpdates,
  get,
  getAppVersion,
  live,
  openNotificationSettings,
  pinSidebarPlace,
  platformApiServer,
  quitAndInstall,
  restoreDefaultSidebarPlaces,
  sendTestNotification,
  setAgentCompletionNotifications,
  setBlockAds,
  setRunProgramsWithoutSandbox,
  setDefaultModelURI,
  setDeveloperMode,
  setPlatformApiServer,
  setReleaseChannel,
  setTheme,
  unpinSidebarPlace,
};
