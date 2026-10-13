import { liveRead } from "@instrument-org/workspace/electron";
import { showAgentCompletionTestNotification } from "@/electron-main/lib/agent-completion-notifications";
import { base } from "@/electron-main/rpc/base";
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
  getDefaultModelURI,
  getWorkspacePreferences,
  WorkspacePreferencesSchema,
} from "@/electron-main/stores/workspace/preferences";
import {
  pinPlace,
  restoreDefaultPlaces,
  type SidebarPlaces,
  unpinPlace,
} from "@/shared/sidebar-places";
import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { APP_BUNDLE_ID } from "@instrument-org/shared";
import { call, eventIterator } from "@orpc/server";
import { app, shell } from "electron";
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

// The OS notification settings deep link. macOS won't let apps prompt for
// notification permission, so surfacing the settings pane is the best we can
// offer when a user isn't seeing notifications. The macOS `?id=` bundle hint
// selects this app's row (honored on Ventura+, otherwise it lands on the
// Notifications list).
function notificationSettingsUrl(): string | undefined {
  switch (process.platform) {
    case "darwin": {
      return `x-apple.systempreferences:com.apple.preference.notifications?id=${APP_BUNDLE_ID}`;
    }
    case "win32": {
      return "ms-settings:notifications";
    }
    default: {
      return undefined;
    }
  }
}

const openNotificationSettings = base
  .output(z.object({ opened: z.boolean() }))
  .handler(async () => {
    const url = notificationSettingsUrl();
    if (url) {
      await shell.openExternal(url);
    }
    return { opened: url !== undefined };
  });

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

const checkForUpdates = base
  .input(
    z.object({
      notify: z.boolean().optional().default(true),
    }),
  )
  .handler(async ({ context, input }) => {
    setLastUpdateCheck();

    return context.appUpdater.checkForUpdates({ notify: input.notify });
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
        changes: [publisher.subscribe("preferences.updated", { signal })],
        read: getDefaultModelURI,
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
  checkForUpdates,
  get,
  getAppVersion,
  live,
  openNotificationSettings,
  pinSidebarPlace,
  quitAndInstall,
  restoreDefaultSidebarPlaces,
  sendTestNotification,
  setAgentCompletionNotifications,
  setBlockAds,
  setDefaultModelURI,
  setDeveloperMode,
  setReleaseChannel,
  setTheme,
  unpinSidebarPlace,
};
