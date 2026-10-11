import { getPlatformApiHeaders } from "@/electron-main/platform-api/headers";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import {
  getNoticesStore,
  type NoticesStore,
} from "@/electron-main/stores/machine/notices";
import {
  type BellNotice,
  NoticeSchema,
  NoticesResponseSchema,
} from "@/shared/notices";
import { APP_NAME } from "@instrument-org/shared";
import { app } from "electron";

import { createScopedLogger } from "./electron-logger";

const log = createScopedLogger("Notices");

/** The least time between asks, whatever the service says. */
const MIN_POLL_SECONDS = 15 * 60;

/** How long a notice's marks are kept, past which it is long gone. */
const FORGET_AFTER_MS = 180 * 24 * 60 * 60 * 1000;

type Marks = NoticesStore["marks"][string];

let pollTimer: NodeJS.Timeout | undefined;
let inFlight: Promise<void> | undefined;
// At most one toast per launch, whatever arrives.
let toastedThisLaunch = false;

/**
 * Which builds this one updates from: the release channel set on this Mac,
 * or the one its own version names (`2.0.0-beta.58` is beta), or latest.
 */
function currentChannel(): string {
  const chosen = getMachinePreferences().get("releaseChannel");
  if (chosen) {
    return chosen;
  }
  const prerelease = /-(alpha|beta)\b/.exec(app.getVersion());
  return prerelease?.[1] ?? "latest";
}

/**
 * Asks the reports service for this build's notices and keeps the answer.
 * A 304 keeps what's there; a failure is logged and the last answer stays,
 * so a bell never empties because the network did.
 */
export function fetchNotices(): Promise<void> {
  inFlight ??= (async () => {
    const base = import.meta.env.MAIN_VITE_REPORTS_BASE_URL;
    if (!base) {
      return;
    }
    const store = getNoticesStore();
    const url = new URL("/notices", base);
    url.searchParams.set("version", app.getVersion());
    url.searchParams.set("platform", process.platform);
    url.searchParams.set("arch", process.arch);
    url.searchParams.set("channel", currentChannel());
    try {
      const response = await fetch(url, {
        headers: {
          ...getPlatformApiHeaders(),
          ...(store.store.etag ? { "if-none-match": store.store.etag } : {}),
        },
      });
      if (response.status === 304) {
        store.set("fetchedAt", Date.now());
        return;
      }
      if (!response.ok) {
        throw new Error(`The notices service answered ${response.status}`);
      }
      const body = NoticesResponseSchema.parse(await response.json());
      // One notice the app can't read is skipped rather than taking the rest
      // down with it, so an older build keeps working as notices grow.
      const notices = body.notices.flatMap((raw) => {
        const parsed = NoticeSchema.safeParse(raw);
        return parsed.success ? [parsed.data] : [];
      });
      const etag = response.headers.get("etag");
      store.set({
        ...(etag ? { etag } : {}),
        fetchedAt: Date.now(),
        notices,
        pollAfter: body.pollAfter,
      });
      if (!etag) {
        store.delete("etag");
      }
    } catch (error) {
      log.warn(new Error("Could not fetch notices", { cause: error }));
    }
  })().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

/**
 * Asks at launch and then every `pollAfter` seconds, and again when the
 * window comes back after the answer has gone stale.
 */
export function startNotices() {
  const schedule = () => {
    clearTimeout(pollTimer);
    const seconds = Math.max(
      MIN_POLL_SECONDS,
      getNoticesStore().get("pollAfter"),
    );
    pollTimer = setTimeout(() => {
      void fetchNotices().then(schedule);
    }, seconds * 1000);
  };
  void fetchNotices().then(schedule);
  app.on("browser-window-focus", () => {
    const { fetchedAt, pollAfter } = getNoticesStore().store;
    const staleAfter = Math.max(MIN_POLL_SECONDS, pollAfter) * 1000;
    if (Date.now() - fetchedAt > staleAfter) {
      void fetchNotices().then(schedule);
    }
  });
}

/** The notices the bell shows: not dismissed and not past their end. */
export function listNotices(now = Date.now()): BellNotice[] {
  const { marks, notices, updated } = getNoticesStore().store;
  const all: Omit<BellNotice, "seen">[] = [...notices];
  // Only while it's still the build running, so a later downgrade or a
  // simulated bump in development doesn't leave it behind.
  if (updated && updated.to === app.getVersion()) {
    all.push(updatedNotice(updated));
  }
  return all
    .filter(
      (notice) =>
        !marks[notice.id]?.dismissedAt &&
        !(notice.endsAt && Date.parse(notice.endsAt) <= now),
    )
    .map((notice) => ({ ...notice, seen: !!marks[notice.id]?.seenAt }))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/**
 * The notice for an update this computer launched into, which the app makes
 * itself. Its id carries when, so the same version installed again after a
 * downgrade is new rather than already dismissed.
 */
function updatedNotice({
  at,
  from,
  to,
}: NonNullable<NoticesStore["updated"]>): Omit<BellNotice, "seen"> {
  return {
    action: { href: "/release-notes", label: "What's new" },
    body: `See what's changed since version ${from}.`,
    id: `updated-${to}-${at}`,
    kind: "update",
    publishedAt: new Date(at).toISOString(),
    severity: "info",
    title: `${APP_NAME} updated to ${to}`,
  };
}

/**
 * Records that this computer launched into a newer build, replacing whatever
 * update it recorded before, read or not, so the bell holds one at most.
 */
export function noteUpdate({ from, to }: { from: string; to: string }) {
  getNoticesStore().set("updated", { at: Date.now(), from, to });
}

export function dismissNotice(id: string) {
  mark([id], "dismissedAt");
}

/** Opening the bell has shown these, so their dot goes. */
export function markNoticesSeen(ids: string[]) {
  const { marks } = getNoticesStore().store;
  const unseen = ids.filter((id) => !marks[id]?.seenAt);
  if (unseen.length > 0) {
    mark(unseen, "seenAt");
  }
}

/**
 * Whether the window may toast this notice now: it is loud enough, has never
 * been toasted or dismissed, and nothing else has been toasted this launch.
 * Saying yes records it, so each notice toasts once, ever.
 */
export function claimNoticeToast(id: string): boolean {
  const { marks, notices } = getNoticesStore().store;
  const notice = notices.find((n) => n.id === id);
  if (
    toastedThisLaunch ||
    !notice ||
    notice.severity === "info" ||
    marks[id]?.toastedAt ||
    marks[id]?.dismissedAt
  ) {
    return false;
  }
  toastedThisLaunch = true;
  mark([id], "toastedAt");
  return true;
}

/**
 * Stamps `key` now on each of these notices' marks, and drops the marks of
 * any notice untouched for six months, which is long gone.
 */
function mark(ids: string[], key: keyof Marks) {
  const store = getNoticesStore();
  const now = Date.now();
  const cutoff = now - FORGET_AFTER_MS;
  const kept = Object.entries(store.get("marks")).filter(([, marks]) =>
    Object.values(marks).some((at) => at > cutoff),
  );
  const marks: Record<string, Marks> = Object.fromEntries(kept);
  for (const id of ids) {
    marks[id] = { ...marks[id], [key]: now };
  }
  store.set("marks", marks);
}
