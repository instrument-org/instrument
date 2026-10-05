import {
  dataAccess,
  notificationStatus,
  requestNotifications,
} from "@/electron-main/lib/mac-native";
import { base } from "@/electron-main/rpc/base";
import { z } from "zod";

/**
 * The Mac bridge (lib/mac-native.ts), for pages that ask the user for
 * something macOS guards before the first task needs it: onboarding's
 * notifications and Mac-data steps, and Settings showing where each stands.
 * Off macOS, every status is `unsupported`.
 */

const DataKindSchema = z.enum(["calendars", "contacts", "reminders"]);

const notifications = {
  /** Never asked, allowed, provisional, or denied; `unsupported` where it cannot be known. */
  status: base.handler(() => notificationStatus()),
  /** The system's prompt when nobody has answered it; the standing answer otherwise. */
  request: base.handler(() => requestNotifications()),
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

export const mac = { access, notifications };
