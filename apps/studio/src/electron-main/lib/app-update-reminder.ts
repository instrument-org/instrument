import { type AppUpdateReminder } from "./app-updates";

export const DEFAULT_REMINDER_HOURS = 24;

// Decides whether the ignored-too-long reminder should show. Kept free of
// electron/store imports so the gating rules stay unit-testable.
export function deriveUpdateReminder({
  hasStagedUpdate,
  isPackaged,
  now,
  ready,
  reminderAfterHours,
}: {
  // Whether the updater reported a `downloaded` status this session. A
  // persisted marker alone (e.g. right after a relaunch) does not mean there is
  // anything for quitAndInstall to apply yet.
  hasStagedUpdate: boolean;
  // Dev/unpacked builds are never nudged; debug triggers publish fake
  // `downloaded` statuses.
  isPackaged: boolean;
  now: number;
  ready: undefined | { firstSeenAt: number; version: string };
  reminderAfterHours: number;
}): AppUpdateReminder {
  if (!isPackaged || !hasStagedUpdate || !ready) {
    return { show: false };
  }

  // A negative or non-finite threshold is server misconfiguration; fall back
  // to the default rather than reminding immediately.
  const thresholdHours =
    Number.isFinite(reminderAfterHours) && reminderAfterHours >= 0
      ? reminderAfterHours
      : DEFAULT_REMINDER_HOURS;

  const elapsed = now - ready.firstSeenAt;
  return elapsed >= thresholdHours * 60 * 60 * 1000
    ? { show: true, version: ready.version }
    : { show: false };
}
