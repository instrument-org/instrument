import { showAgentCompletionTestNotification } from "@/electron-main/lib/agent-completion-notifications";
import { setDefaultModel } from "@/electron-main/lib/set-default-model";
import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  AgentCompletionNotificationModeSchema,
  consumeRecentVersionBump,
  getDefaultModelURI,
  getPreferencesStore,
  PreferencesStoreSchema,
  setLastUpdateCheck,
} from "@/electron-main/stores/preferences";
import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { APP_BUNDLE_ID } from "@instrument-org/shared";
import {
  TaskIdSchema,
  workspaceRouter,
} from "@instrument-org/workspace/electron";
import { call, eventIterator } from "@orpc/server";
import { app, shell } from "electron";
import { z } from "zod";

function getPreferencesData() {
  const preferencesStore = getPreferencesStore();
  return {
    agentCompletionNotifications: preferencesStore.get(
      "agentCompletionNotifications",
    ),
    developerMode: preferencesStore.get("developerMode"),
    enableUsageMetrics: preferencesStore.get("enableUsageMetrics"),
    lastUpdateCheck: preferencesStore.get("lastUpdateCheck"),
    preferApiKeyOverAccount: preferencesStore.get("preferApiKeyOverAccount"),
    releaseChannel: preferencesStore.get("releaseChannel"),
    theme: preferencesStore.get("theme"),
  };
}

const setPreferApiKeyOverAccount = base
  .input(z.object({ prefer: z.boolean() }))
  .handler(({ input }) => {
    const preferencesStore = getPreferencesStore();
    preferencesStore.set("preferApiKeyOverAccount", input.prefer);
  });

const setTheme = base
  .input(z.object({ theme: z.enum(["light", "dark", "system"]) }))
  .handler(({ input }) => {
    const preferencesStore = getPreferencesStore();
    preferencesStore.set("theme", input.theme);
  });

const setEnableUsageMetrics = base
  .input(z.object({ enabled: z.boolean() }))
  .handler(({ input }) => {
    const preferencesStore = getPreferencesStore();
    preferencesStore.set("enableUsageMetrics", input.enabled);
  });

const setAgentCompletionNotifications = base
  .input(z.object({ mode: AgentCompletionNotificationModeSchema }))
  .handler(({ input }) => {
    const preferencesStore = getPreferencesStore();
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
      // cspell:ignore systempreferences
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

const setDeveloperMode = base
  .input(z.object({ enabled: z.boolean() }))
  .handler(({ input }) => {
    const preferencesStore = getPreferencesStore();
    preferencesStore.set("developerMode", input.enabled);
  });

const setReleaseChannel = base
  .input(z.object({ channel: z.enum(["latest", "beta", "alpha"]).optional() }))
  .handler(({ context, input }) => {
    const preferencesStore = getPreferencesStore();
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
    context.workspaceConfig.captureEvent("app.manual_check_for_updates");
    return context.appUpdater.checkForUpdates({ notify: input.notify });
  });

const quitAndInstall = base.handler(({ context }) => {
  return context.appUpdater.quitAndInstall();
});

const getAppVersion = base.handler(() => {
  return { version: app.getVersion() };
});

// Returns the version jump if the app was updated since the previous launch,
// otherwise null. Reading it consumes it, so a reload does not replay the toast.
const getRecentUpdate = base
  .output(z.object({ from: z.string(), to: z.string() }).nullable())
  .handler(() => {
    return consumeRecentVersionBump();
  });

const ensureTaskDefaultModelURI = base
  .input(z.object({ id: TaskIdSchema }))
  .output(z.object({ modelURI: AIGatewayModelURI.Schema.optional() }))
  .handler(async ({ context, input }) => {
    const taskState = await call(workspaceRouter.task.state.get, input, {
      context,
    });

    if (taskState.selectedModelURI) {
      return { modelURI: taskState.selectedModelURI };
    }

    await setDefaultModel({ onlyIfUnset: true });
    const modelURI = getDefaultModelURI();

    if (modelURI) {
      await call(
        workspaceRouter.task.state.set,
        {
          id: input.id,
          state: { selectedModelURI: modelURI },
        },
        { context },
      );
    }

    return { modelURI };
  });

const setDefaultModelURI = base
  .input(z.object({ modelURI: AIGatewayModelURI.Schema }))
  .handler(({ input }) => {
    const preferencesStore = getPreferencesStore();
    preferencesStore.set("defaultModelURI", input.modelURI);
  });

const get = base.output(PreferencesStoreSchema).handler(() => {
  return getPreferencesData();
});

const live = {
  defaultModelURI: base
    .output(eventIterator(AIGatewayModelURI.Schema.optional()))
    .handler(async function* ({ signal }) {
      yield getDefaultModelURI();

      for await (const _payload of publisher.subscribe("preferences.updated", {
        signal,
      })) {
        yield getDefaultModelURI();
      }
    }),
  get: base.handler(async function* ({ context, signal }) {
    yield call(get, {}, { context, signal });

    for await (const _payload of publisher.subscribe("preferences.updated", {
      signal,
    })) {
      yield call(get, {}, { context, signal });
    }
  }),
};

export const preferences = {
  checkForUpdates,
  ensureTaskDefaultModelURI,
  get,
  getAppVersion,
  getRecentUpdate,
  live,
  openNotificationSettings,
  quitAndInstall,
  sendTestNotification,
  setAgentCompletionNotifications,
  setDefaultModelURI,
  setDeveloperMode,
  setEnableUsageMetrics,
  setPreferApiKeyOverAccount,
  setReleaseChannel,
  setTheme,
};
