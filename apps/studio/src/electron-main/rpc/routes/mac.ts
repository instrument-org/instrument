import {
  dataAccess,
  notificationStatus,
  requestNotifications,
} from "@/electron-main/lib/mac-native";
import { getMacAppIconUrl } from "@/electron-main/lib/file-open-target";
import { refreshNotificationsForSetup } from "@/electron-main/lib/setup-facts";
import { showTestNotification } from "@/electron-main/lib/test-notification";
import {
  microphoneAccess,
  openMicrophoneSettings,
  requestMicrophoneAccess,
} from "@/electron-main/lib/microphone-access";
import { base } from "@/electron-main/rpc/base";
import { appBundleId } from "@instrument-org/workspace/electron";
import { z } from "zod";

/**
 * The Mac bridge (lib/mac-native.ts), for pages that ask the user for
 * something macOS guards before the first task needs it: setup's
 * notifications and Mac-data steps, dictation asking for the microphone, and
 * Settings showing where each stands.
 * Off macOS, every status is `unsupported`.
 */

const DataKindSchema = z.enum(["calendars", "contacts", "reminders"]);

const notifications = {
  /** Never asked, allowed, provisional, or denied; `unsupported` where it cannot be known. */
  status: base.handler(() => notificationStatus()),
  /** The system's prompt when nobody has answered it; the standing answer otherwise. */
  request: base.handler(async () => {
    const answer = await requestNotifications();
    void refreshNotificationsForSetup();
    return answer;
  }),
  /**
   * Setup's test notification: answers `clicked` when the person clicks it,
   * or `timed-out` after `timeoutMs`.
   */
  test: base
    .input(z.object({ timeoutMs: z.number().int().positive().max(600_000) }))
    .handler(({ input }) => showTestNotification(input)),
};

const access = {
  /** Where the user stands on Calendars, Reminders, or Contacts, without asking. */
  status: base
    .input(z.object({ kind: DataKindSchema }))
    .handler(({ input }) => dataAccess(input.kind)),
  /** The system's prompt for one kind when nobody has answered it. */
  request: base
    .input(z.object({ kind: DataKindSchema }))
    .handler(({ input }) => dataAccess(input.kind, { request: true })),
};

/**
 * A Mac app's own icon, by the name a permission card or Settings shows it
 * by, or by its bundle id: null off macOS, or where no app goes by it.
 */
const appIcon = base
  .input(z.object({ app: z.string() }))
  .output(z.object({ url: z.string().nullable() }))
  .handler(async ({ input }) => {
    const bundleId = await appBundleId(input.app);
    return {
      url:
        bundleId === undefined
          ? null
          : await getMacAppIconUrl(bundleId).catch(() => null),
    };
  });

const microphone = {
  /** Granted, denied, restricted, or never asked; `unsupported` off macOS. */
  status: base.handler(() => microphoneAccess()),
  /** The system's prompt when nobody has answered it; the standing answer otherwise. */
  request: base.handler(() => requestMicrophoneAccess()),
  /** The microphone pane of System Settings, where a refusal is undone. */
  openSettings: base.handler(() => openMicrophoneSettings()),
};

export const mac = { access, appIcon, microphone, notifications };
