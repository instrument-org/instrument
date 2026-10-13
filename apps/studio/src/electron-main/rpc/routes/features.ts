import { liveRead } from "@instrument-org/workspace/electron";
import { getFeaturesStore } from "@/electron-main/stores/workspace/features";
import { FeatureNameSchema, FeaturesSchema } from "@/shared/features";
import { eventIterator } from "@orpc/server";
import { shell } from "electron";
import { z } from "zod";

import { base } from "../base";
import { publisher } from "../publisher";

const setEnabled = base
  .input(z.object({ enabled: z.boolean(), feature: FeatureNameSchema }))
  .handler(({ input }) => {
    const store = getFeaturesStore();
    store.set(input.feature, input.enabled);
  });

/**
 * The Files and Folders pane, where a folder the Mac refused this app is
 * granted after the fact. The system asks once, at the first read of a
 * protected folder, and never again for that folder: the pane's row is the
 * only way back once the ask was declined.
 */
const openFilesAndFoldersSettings = base
  .output(z.object({ opened: z.boolean() }))
  .handler(async () => {
    if (process.platform !== "darwin") {
      return { opened: false };
    }
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders",
    );
    return { opened: true };
  });

const live = {
  getAll: base.output(eventIterator(FeaturesSchema)).handler(async function* ({
    signal,
  }) {
    yield* liveRead({
      changes: [publisher.subscribe("features.updated", { signal })],
      read: () => getFeaturesStore().store,
    });
  }),
};

export const features = {
  live,
  openFilesAndFoldersSettings,
  setEnabled,
};
