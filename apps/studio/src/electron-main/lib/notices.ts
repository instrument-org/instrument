import { getPlatformApiHeaders } from "@/electron-main/platform-api/headers";
import { publisher } from "@/electron-main/rpc/publisher";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import {
  type BellNotice,
  NoticeSchema,
  NoticesResponseSchema,
} from "@/shared/notices";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { createScopedLogger } from "./electron-logger";

const log = createScopedLogger("Notices");

/** How often to ask when the service doesn't say. */
const DEFAULT_POLL_SECONDS = 6 * 60 * 60;

/** The least time between asks, whatever the service says. */
const MIN_POLL_SECONDS = 15 * 60;

/** How long dismissed and seen ids are kept, past which a notice is long gone. */
const FORGET_AFTER_MS = 180 * 24 * 60 * 60 * 1000;

const StateSchema = z.object({
  dismissed: z.record(z.string(), z.number()).default({}),
  etag: z.string().optional(),
  fetchedAt: z.number().default(0),
  notices: z.array(NoticeSchema).default([]),
  pollAfter: z.number().default(DEFAULT_POLL_SECONDS),
  seen: z.record(z.string(), z.number()).default({}),
  toasted: z.record(z.string(), z.number()).default({}),
});

type State = z.output<typeof StateSchema>;

let pollTimer: NodeJS.Timeout | undefined;
let inFlight: Promise<void> | undefined;
// At most one toast per launch, whatever arrives.
let toastedThisLaunch = false;

function getStatePath() {
  return path.join(app.getPath("userData"), "notices.json");
}

function readState(): State {
  try {
    return StateSchema.parse(
      JSON.parse(fs.readFileSync(getStatePath(), "utf8")),
    );
  } catch {
    return StateSchema.parse({});
  }
}

function writeState(state: State) {
  try {
    fs.writeFileSync(getStatePath(), JSON.stringify(state, null, 2));
  } catch (error) {
    log.warn(new Error("Could not save the notices", { cause: error }));
  }
  publisher.publish("notices.updated", null);
}

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
    const state = readState();
    const url = new URL("/notices", base);
    url.searchParams.set("version", app.getVersion());
    url.searchParams.set("platform", process.platform);
    url.searchParams.set("arch", process.arch);
    url.searchParams.set("channel", currentChannel());
    try {
      const response = await fetch(url, {
        headers: {
          ...getPlatformApiHeaders(),
          ...(state.etag ? { "if-none-match": state.etag } : {}),
        },
      });
      if (response.status === 304) {
        writeState({ ...state, fetchedAt: Date.now() });
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
      writeState({
        ...state,
        etag: response.headers.get("etag") ?? undefined,
        fetchedAt: Date.now(),
        notices,
        pollAfter: body.pollAfter,
      });
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
    const seconds = Math.max(MIN_POLL_SECONDS, readState().pollAfter);
    pollTimer = setTimeout(() => {
      void fetchNotices().then(schedule);
    }, seconds * 1000);
  };
  void fetchNotices().then(schedule);
  app.on("browser-window-focus", () => {
    const state = readState();
    const staleAfter = Math.max(MIN_POLL_SECONDS, state.pollAfter) * 1000;
    if (Date.now() - state.fetchedAt > staleAfter) {
      void fetchNotices().then(schedule);
    }
  });
}

/** The notices the bell shows: not dismissed and not past their end. */
export function listNotices(now = Date.now()): BellNotice[] {
  const state = readState();
  return state.notices
    .filter(
      (notice) =>
        !(notice.id in state.dismissed) &&
        !(notice.endsAt && Date.parse(notice.endsAt) <= now),
    )
    .map((notice) => ({ ...notice, seen: notice.id in state.seen }))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export function dismissNotice(id: string) {
  const state = readState();
  writeState(
    forgetOld({
      ...state,
      dismissed: { ...state.dismissed, [id]: Date.now() },
    }),
  );
}

/** Opening the bell has shown these, so their dot goes. */
export function markNoticesSeen(ids: string[]) {
  const state = readState();
  const unseen = ids.filter((id) => !(id in state.seen));
  if (unseen.length === 0) {
    return;
  }
  const now = Date.now();
  writeState(
    forgetOld({
      ...state,
      seen: {
        ...state.seen,
        ...Object.fromEntries(unseen.map((id) => [id, now])),
      },
    }),
  );
}

/**
 * Whether the window may toast this notice now: it is loud enough, has never
 * been toasted, and nothing else has been toasted this launch. Saying yes
 * records it, so each notice toasts once, ever.
 */
export function claimNoticeToast(id: string): boolean {
  const state = readState();
  const notice = state.notices.find((n) => n.id === id);
  if (
    toastedThisLaunch ||
    !notice ||
    notice.severity === "info" ||
    id in state.toasted ||
    id in state.dismissed
  ) {
    return false;
  }
  toastedThisLaunch = true;
  writeState(
    forgetOld({ ...state, toasted: { ...state.toasted, [id]: Date.now() } }),
  );
  return true;
}

function forgetOld(state: State): State {
  const cutoff = Date.now() - FORGET_AFTER_MS;
  const keep = (marks: Record<string, number>) =>
    Object.fromEntries(Object.entries(marks).filter(([, at]) => at > cutoff));
  return {
    ...state,
    dismissed: keep(state.dismissed),
    seen: keep(state.seen),
    toasted: keep(state.toasted),
  };
}
