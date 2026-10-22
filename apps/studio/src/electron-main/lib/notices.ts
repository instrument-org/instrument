import { platformApiBaseUrl } from "@/electron-main/platform-api/base-url";
import { getPlatformApiHeaders } from "@/electron-main/platform-api/headers";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import { getDefaultModelURI } from "@/electron-main/stores/workspace/preferences";
import {
  getNoticesStore,
  type NoticesStore,
} from "@/electron-main/stores/machine/notices";
import {
  type BellNotice,
  NoticeSchema,
  NoticesResponseSchema,
  SIGN_IN_ACCOUNT_NAMES,
  type SignedOutAccount,
  type SignInAccountType,
} from "@/shared/notices";
import { chromiumSandboxOff } from "@/electron-main/lib/chromium-sandbox";
import { type Condition } from "@/shared/problem-reports";
import {
  BROWSER_SANDBOX_OFF_COPY,
  SANDBOX_OFF_COPY,
  WINDOWS_SANDBOX_OFF_COPY,
} from "@/shared/sandbox-off";
import { modelNameFromURI, readModelURI } from "@instrument-org/ai-gateway";
import { APP_NAME, BROWSER_SANDBOX_OFF_URL } from "@instrument-org/shared";
import {
  nativeSandboxOff,
  type SandboxOff,
} from "@instrument-org/workspace/electron";
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
    const store = getNoticesStore();
    const url = new URL("/notices", platformApiBaseUrl());
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
  const off = nativeSandboxOff();
  if (off === "windows") {
    all.push(windowsSandboxOffNotice());
  } else if (off) {
    all.push(sandboxOffNotice(off));
  }
  if (chromiumSandboxOff()) {
    all.push(browserSandboxOffNotice());
  }
  const { chatsLeftBehind } = getNoticesStore().store;
  if (chatsLeftBehind) {
    all.push(chatsLeftBehindNotice(chatsLeftBehind));
  }
  all.push(...signedOutAccounts().map(signedOutNotice));
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

/** When this process started, which a notice about this launch is dated by. */
const LAUNCHED_AT = new Date().toISOString();

/**
 * The notice for programs the agent runs having no sandbox on macOS or Linux,
 * which the app makes itself while none holds them. Until the person decides,
 * it is critical: it toasts, stays until closed, and keeps the bell's dot
 * red. Its id carries the reason, the choice and the build, so a dismissed
 * one comes back with the next update while the cause is still there.
 */
function sandboxOffNotice(
  off: Exclude<SandboxOff, "windows">,
): Omit<BellNotice, "seen"> {
  // Once the person chose to run the programs anyway there is nothing left
  // to decide, so it stays in the bell without toasting again.
  const allowed = getMachinePreferences().get("runProgramsWithoutSandbox");
  const copy = SANDBOX_OFF_COPY[allowed ? "allowed" : "refused"];
  return {
    action: { label: "Open Settings", settings: "Permissions" },
    body: copy.notice,
    id: `sandbox-off-${off}-${allowed ? "allowed" : "refused"}-${app.getVersion()}`,
    kind: "security",
    publishedAt: LAUNCHED_AT,
    severity: allowed ? "info" : "critical",
    title: copy.title,
  };
}

/**
 * The notice for programs the agent runs having no sandbox on Windows, where
 * they run anyway. It is critical, so it toasts and stays until closed, and
 * its id carries the build, so a dismissed one comes back with the next
 * update while Windows' sandbox still can't hold them.
 */
function windowsSandboxOffNotice(): Omit<BellNotice, "seen"> {
  return {
    action: { label: "Open Settings", settings: "Permissions" },
    body: WINDOWS_SANDBOX_OFF_COPY.notice,
    id: `sandbox-off-windows-${app.getVersion()}`,
    kind: "security",
    publishedAt: LAUNCHED_AT,
    severity: "critical",
    title: WINDOWS_SANDBOX_OFF_COPY.title,
  };
}

/**
 * What a report about a condition says the app found, read here at the time
 * of the report, and the fingerprint that makes every report of the same
 * cause one problem.
 */
export function describeCondition(condition: Condition): {
  fingerprint: string;
  found: string[];
} {
  switch (condition) {
    case "sandbox-off": {
      const off = nativeSandboxOff() ?? "none";
      return {
        fingerprint: `condition:sandbox-off:${off}`,
        found: [
          `sandboxOff: ${off}`,
          `runProgramsWithoutSandbox: ${String(getMachinePreferences().get("runProgramsWithoutSandbox"))}`,
          ...(process.platform === "linux"
            ? [`appImage: ${String(!!process.env.APPIMAGE)}`]
            : []),
        ],
      };
    }
  }
}

/**
 * The notice for a Claude or ChatGPT account signed out without the person
 * asking, which the app makes itself. Critical when new chats start on one of
 * its models, so it toasts and stays until closed, since nothing new can be
 * sent until it is fixed; otherwise a dot on the bell, for an account the
 * person may not use any more. Its action lights the account's row in
 * Settings, where signing in again, signing out and every other provider are.
 *
 * Its id carries when, so an account signed out again after the person
 * dismissed the last notice is a notice of its own.
 */
function signedOutNotice({
  at,
  id,
  label,
  type,
}: SignedOutAccount): Omit<BellNotice, "seen"> {
  const name = SIGN_IN_ACCOUNT_NAMES[type];
  const defaultURI = getDefaultModelURI();
  const isDefault =
    defaultURI !== undefined &&
    readModelURI(defaultURI)?.providerConfigId === id;
  const model = isDefault ? modelNameFromURI(defaultURI) : null;
  const signIn = label ? `Sign in to ${label} again` : "Sign in again";
  return {
    action: { label: "Sign in again", setting: type, settings: "Providers" },
    body: isDefault
      ? `${signIn} to keep using ${model ?? `${name}'s models`} in new chats.`
      : `${signIn} to use ${label ? "its" : `${name}'s`} models, or dismiss this if you don't need them.`,
    id: `signed-out-${id}-${at.toString()}`,
    kind: "account",
    publishedAt: new Date(at).toISOString(),
    severity: isDefault ? "critical" : "info",
    title: `You're signed out of ${name}`,
  };
}

/** The accounts signed out without the person asking, first seen first. */
export function signedOutAccounts(): SignedOutAccount[] {
  return Object.entries(getNoticesStore().store.signedOut)
    .map(([id, account]) => ({ ...account, id }))
    .toSorted((a, b) => a.at - b.at);
}

/**
 * Records which accounts of one type are signed out without the person
 * asking, replacing what was recorded for that type. One still signed out
 * keeps when it was first seen, so the same answer again changes nothing and
 * a dismissed notice stays dismissed.
 */
export function noteSignedOut(
  type: SignInAccountType,
  accounts: { id: string; label?: string }[],
): void {
  const held = getNoticesStore().store.signedOut;
  const next = Object.fromEntries(
    Object.entries(held).filter(([, account]) => account.type !== type),
  );
  for (const { id, label } of accounts) {
    next[id] = {
      at: held[id]?.at ?? Date.now(),
      ...(label && { label }),
      type,
    };
  }
  // Compared in one key order, since the entries are rebuilt in another.
  const sorted = (record: typeof held) =>
    JSON.stringify(
      Object.entries(record).toSorted(([a], [b]) => a.localeCompare(b)),
    );
  if (sorted(next) !== sorted(held)) {
    getNoticesStore().set("signedOut", next);
  }
}

/**
 * The notice for web pages in the browser running without Chromium's
 * sandbox, which the AppImage starts without where Linux blocks it. Nothing
 * in the app turns it back on, so it says where to get a build that has it,
 * toasts once per build and stays in the bell.
 */
function browserSandboxOffNotice(): Omit<BellNotice, "seen"> {
  return {
    action: { label: "Learn more", url: BROWSER_SANDBOX_OFF_URL },
    body: BROWSER_SANDBOX_OFF_COPY.notice,
    id: `browser-sandbox-off-${app.getVersion()}`,
    kind: "security",
    publishedAt: LAUNCHED_AT,
    severity: "important",
    title: BROWSER_SANDBOX_OFF_COPY.title,
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
 * been toasted or dismissed, and nothing else has been toasted this launch,
 * which a critical one goes ahead of. The notices the app makes itself count
 * as the service's do. Saying yes records it, so each notice toasts once,
 * ever.
 */
export function claimNoticeToast(id: string): boolean {
  const { marks } = getNoticesStore().store;
  const notice = listNotices().find((n) => n.id === id);
  if (
    !notice ||
    notice.severity === "info" ||
    (toastedThisLaunch && notice.severity !== "critical") ||
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
