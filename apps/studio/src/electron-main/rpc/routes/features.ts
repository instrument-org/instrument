import { getFeaturesStore } from "@/electron-main/stores/features";
import { FeatureNameSchema, FeaturesSchema } from "@/shared/features";
import { call, eventIterator } from "@orpc/server";
import { shell } from "electron";
import { z } from "zod";

import { base } from "../base";
import { publisher } from "../publisher";

const getAll = base.output(FeaturesSchema).handler(() => {
  const store = getFeaturesStore();
  return store.store;
});

const setEnabled = base
  .input(z.object({ enabled: z.boolean(), feature: FeatureNameSchema }))
  .handler(({ input }) => {
    const store = getFeaturesStore();
    store.set(input.feature, input.enabled);
  });

/**
 * Opens the App Management pane, which is what stands between the external
 * browser and working. Launching the user's installed Chrome makes macOS
 * attribute Chrome's writes to its own bundle back to us, so the first launch
 * raises "wants to manage apps on this Mac".
 *
 * Sending the user there is all we can do. macOS exposes no way to request
 * this consent: Electron's only permission entry points are
 * `askForMediaAccess` (camera and microphone) and `isTrustedAccessibilityClient`
 * (Accessibility), and the OS has no equivalent for App Management, nor any way
 * to read back whether it was granted. The prompt appears when Chrome writes,
 * not on demand, so the pane may show no row for this app until then.
 */
const openAppManagementSettings = base
  .output(z.object({ opened: z.boolean() }))
  .handler(async () => {
    if (process.platform !== "darwin") {
      return { opened: false };
    }
    // cspell:ignore systempreferences
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles",
    );
    return { opened: true };
  });

const live = {
  getAll: base.output(eventIterator(FeaturesSchema)).handler(async function* ({
    context,
    signal,
  }) {
    yield call(getAll, {}, { context, signal });

    for await (const _ of publisher.subscribe("features.updated", {
      signal,
    })) {
      yield call(getAll, {}, { context, signal });
    }
  }),
};

export const features = {
  getAll,
  live,
  openAppManagementSettings,
  setEnabled,
};
