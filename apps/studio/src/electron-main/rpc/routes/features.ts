import { liveRead } from "@instrument-org/workspace/electron";
import {
  getWorkspaceFeatures,
  setWorkspaceFeature,
} from "@/electron-main/stores/workspace/preferences";
import { FeatureNameSchema, FeaturesSchema } from "@/shared/features";
import { eventIterator } from "@orpc/server";
import { shell } from "electron";
import { z } from "zod";

import { base } from "../base";
import { publisher } from "../publisher";

const setEnabled = base
  .input(z.object({ enabled: z.boolean(), feature: FeatureNameSchema }))
  .handler(({ input }) => {
    setWorkspaceFeature(input.feature, input.enabled);
  });

/**
 * A pane of Privacy & Security, where what the Mac refused this app is
 * allowed after the fact: Files and Folders for a protected folder, the
 * app's own pane for Calendars, Reminders or Contacts, and Automation for an
 * app the app controls. The system asks once and never again, so the pane's
 * row is the only way back once the ask was declined.
 */
const openPrivacySettings = base
  .input(
    z.object({
      pane: z.enum([
        "Automation",
        "Calendars",
        "Contacts",
        "FilesAndFolders",
        "Reminders",
      ]),
    }),
  )
  .output(z.object({ opened: z.boolean() }))
  .handler(async ({ input }) => {
    if (process.platform !== "darwin") {
      return { opened: false };
    }
    await shell.openExternal(
      `x-apple.systempreferences:com.apple.preference.security?Privacy_${input.pane}`,
    );
    return { opened: true };
  });

/**
 * Windows Security's page for letting a program through ransomware
 * protection, where a program it blocked is allowed by hand.
 */
const openRansomwareProtection = base
  .output(z.object({ opened: z.boolean() }))
  .handler(async () => {
    if (process.platform !== "win32") {
      return { opened: false };
    }
    await shell.openExternal("windowsdefender://allowappthroughfolder/");
    return { opened: true };
  });

const live = {
  getAll: base.output(eventIterator(FeaturesSchema)).handler(async function* ({
    signal,
  }) {
    yield* liveRead({
      changes: [publisher.subscribe("preferences.updated", { signal })],
      read: getWorkspaceFeatures,
    });
  }),
};

export const features = {
  live,
  openPrivacySettings,
  openRansomwareProtection,
  setEnabled,
};
