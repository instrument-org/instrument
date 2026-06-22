import { setDefaultModel } from "@/electron-main/lib/set-default-model";
import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  getDefaultModelURI,
  getPreferencesStore,
  PreferencesStoreSchema,
  setLastUpdateCheck,
} from "@/electron-main/stores/preferences";
import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import {
  TaskIdSchema,
  workspaceRouter,
} from "@instrument-org/workspace/electron";
import { call, eventIterator } from "@orpc/server";
import { app } from "electron";
import { z } from "zod";

function getPreferencesData() {
  const preferencesStore = getPreferencesStore();
  return {
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

const setDeveloperMode = base
  .input(z.object({ enabled: z.boolean() }))
  .handler(({ input }) => {
    const preferencesStore = getPreferencesStore();
    preferencesStore.set("developerMode", input.enabled);
  });

const setReleaseChannel = base
  .input(z.object({ channel: z.enum(["latest", "beta", "alpha"]).optional() }))
  .handler(({ input }) => {
    const preferencesStore = getPreferencesStore();
    if (input.channel === undefined) {
      preferencesStore.delete("releaseChannel");
    } else {
      preferencesStore.set("releaseChannel", input.channel);
    }
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

const ensureProjectDefaultModelURI = base
  .input(z.object({ id: TaskIdSchema }))
  .output(z.object({ modelURI: AIGatewayModelURI.Schema.optional() }))
  .handler(async ({ context, input }) => {
    const projectState = await call(workspaceRouter.task.state.get, input, {
      context,
    });

    if (projectState.selectedModelURI) {
      return { modelURI: projectState.selectedModelURI };
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
  ensureProjectDefaultModelURI,
  get,
  getAppVersion,
  live,
  quitAndInstall,
  setDefaultModelURI,
  setDeveloperMode,
  setEnableUsageMetrics,
  setPreferApiKeyOverAccount,
  setReleaseChannel,
  setTheme,
};
