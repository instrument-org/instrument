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
  const { chatsLeftBehind, missingFolders } = getNoticesStore().store;
  if (missingFolders) {
    all.push(missingFoldersNotice(missingFolders));
  }
  if (chatsLeftBehind) {
    all.push(chatsLeftBehindNotice(chatsLeftBehind));
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
 * The notice for folders that have gone from the workspace's top level, which
 * the app makes itself. It only says so: nothing is restored or recreated, and
 * the next thing the app writes there makes the folder again.
 *
 * Its id carries when as well as which, like the update notice, so a folder
 * that goes again after the person dismissed the last one is a notice of its
 * own. Without the stamp, dismissing it once silenced that folder for good.
 */
function missingFoldersNotice({
  at,
  names,
}: NonNullable<NoticesStore["missingFolders"]>): Omit<BellNotice, "seen"> {
  const listed = formatList(names);
  return {
    body:
      names.length > 1
        ? `Your ${listed} folders aren't in your Instrument folder any more. Nothing is lost, and Instrument makes them again the next time it saves a chat.`
        : `Your ${listed} folder isn't in your Instrument folder any more. Nothing is lost, and Instrument makes it again the next time it saves a chat.`,
    id: `missing-folders-${[...names].toSorted().join("-")}-${at}`,
    kind: "announcement",
    publishedAt: new Date(at).toISOString(),
    severity: "info",
    title:
      names.length > 1
        ? "Some of your folders are gone"
        : `Your ${listed} folder is gone`,
  };
}

/**
 * The notice for chats the conversion left on their database, which read as
 * empty until a later launch brings them over. The app makes it itself.
 *
 * It says how many rather than which: a chat's title comes from its records,
 * and a chat with none is listed by its id, which says nothing to anyone.
 * Its id carries the count and when, so a chat that is left behind after the
 * person dismissed the last notice is a notice of its own.
 */
function chatsLeftBehindNotice({
  at,
  count,
}: NonNullable<NoticesStore["chatsLeftBehind"]>): Omit<BellNotice, "seen"> {
  return {
    body:
      count > 1
        ? `${APP_NAME} couldn't finish bringing ${count.toString()} of your chats over, so they look empty right now. Their conversations are safe where they are, and ${APP_NAME} tries again the next time it starts.`
        : `${APP_NAME} couldn't finish bringing one of your chats over, so it looks empty right now. The conversation is safe where it is, and ${APP_NAME} tries again the next time it starts.`,
    id: `chats-left-behind-${count.toString()}-${at}`,
    kind: "announcement",
    publishedAt: new Date(at).toISOString(),
    severity: "important",
    title:
      count > 1
        ? "Some chats are still being brought over"
        : "One chat is still being brought over",
  };
}

/**
 * Records how many chats the conversion left on their database, or clears the
 * record when it left none.
 *
 * Writing the same count again changes nothing, so a launch that leaves the
 * same chats behind does not remake a notice the person dismissed.
 */
export function noteChatsLeftBehind(count: number): void {
  const held = getNoticesStore().store.chatsLeftBehind;
  if (count <= 0) {
    if (held) {
      getNoticesStore().delete("chatsLeftBehind");
    }
    return;
  }
  if (held?.count === count) {
    return;
  }
  getNoticesStore().set("chatsLeftBehind", { at: Date.now(), count });
}

/**
 * Records which of the six folders have gone from the workspace open now, or
 * clears the record when none has.
 *
 * Writing the same set again changes nothing, so a watch that fires on every
 * save does not keep remaking a notice the person dismissed.
 */
export function noteMissingFolders(root: string, names: string[]): void {
  const held = getNoticesStore().store.missingFolders;
  if (names.length === 0) {
    if (held) {
      getNoticesStore().delete("missingFolders");
    }
    return;
  }
  if (
    held?.root === root &&
    held.names.length === names.length &&
    held.names.every((name, index) => name === names[index])
  ) {
    return;
  }
  getNoticesStore().set("missingFolders", { at: Date.now(), names, root });
}

/**
 * The folders of the six that have gone, for the list that would be empty
 * because of one. The bell says it too; this is so the column the person is
 * looking at can say it before they go looking for the bell.
 */
export function missingFolderNames(): string[] {
  return getNoticesStore().store.missingFolders?.names ?? [];
}

/** `Chats`, `Chats and Drafts`, `Chats, Drafts and Topics`. */
function formatList(names: readonly string[]): string {
  const last = names.at(-1);
  if (names.length <= 1 || last === undefined) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} and ${last}`;
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
