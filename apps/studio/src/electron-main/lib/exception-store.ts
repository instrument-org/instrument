import { logger } from "@/electron-main/lib/electron-logger";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  type ExceptionEvent,
  ExceptionEventSchema,
} from "@instrument-org/shared/exceptions";
import { app } from "electron";
import Store from "electron-store";
import { z } from "zod";

/** How many distinct problems are kept, the least recently seen dropped first. */
const MAX_STORED_PROBLEMS = 50;

/** How long a capture waits to be written, so a burst is one write. */
const WRITE_DELAY_MS = 1000;

/**
 * Each fingerprint's last event, oldest first, with how often it was seen and
 * when first and last. Pure, for the store and its test.
 */
export function collapseEvent(
  events: readonly ExceptionEvent[],
  event: ExceptionEvent,
  limit = MAX_STORED_PROBLEMS,
): ExceptionEvent[] {
  const same = events.find(
    (stored) => stored.fingerprint === event.fingerprint,
  );
  const others = events.filter((stored) => stored !== same);
  const collapsed: ExceptionEvent = same
    ? {
        ...event,
        count: same.count + event.count,
        firstAt: Math.min(same.firstAt, event.firstAt),
        lastAt: Math.max(same.lastAt, event.lastAt),
      }
    : event;
  return [...others, collapsed].slice(-limit);
}

const StoredExceptionsSchema = z.object({
  // Read one by one, so one event a later build cannot read loses only itself.
  events: z.array(z.unknown()).default([]),
});

type StoredExceptions = z.output<typeof StoredExceptionsSchema>;

let STORE: null | Store<StoredExceptions> = null;
let EVENTS: ExceptionEvent[] | null = null;
let writeTimer: NodeJS.Timeout | undefined;

/**
 * The exceptions this computer recorded, in the userData root whichever
 * workspace is open, so a report can carry what happened before it, even in
 * an earlier session.
 */
function getStore(): Store<StoredExceptions> {
  if (STORE === null) {
    const defaults = StoredExceptionsSchema.parse({});
    STORE = new Store<StoredExceptions>({
      cwd: app.getPath("userData"),
      defaults,
      deserialize: (value) => {
        const parsed = StoredExceptionsSchema.safeParse(JSON.parse(value));
        if (parsed.success) {
          return parsed.data;
        }
        logger.error("Failed to parse the recorded exceptions", parsed.error);
        return defaults;
      },
      name: "exceptions",
    });
    process.on("exit", flushExceptionStore);
  }
  return STORE;
}

/** Every recorded problem's last event, the most recently seen last. */
export function listExceptionEvents(): readonly ExceptionEvent[] {
  if (EVENTS === null) {
    EVENTS = getStore()
      .get("events")
      .flatMap((stored) => {
        const parsed = ExceptionEventSchema.safeParse(stored);
        return parsed.success ? [parsed.data] : [];
      });
  }
  return EVENTS;
}

const SESSION_STARTED_AT = Date.now();

/** The recorded problems seen again since this process started. */
export function listSessionExceptionEvents(): readonly ExceptionEvent[] {
  return listExceptionEvents().filter(
    (event) => event.lastAt >= SESSION_STARTED_AT,
  );
}

/** The recorded problem a fingerprint names, if one is kept. */
export function findExceptionEvent(
  fingerprint: string,
): ExceptionEvent | undefined {
  return listExceptionEvents().find(
    (event) => event.fingerprint === fingerprint,
  );
}

/**
 * Keep an event, counted into the problem its fingerprint names. `once`
 * leaves out an event already counted under its id, for one recorded twice
 * (a crash record read back after the store also kept it).
 */
export function storeExceptionEvent(
  event: ExceptionEvent,
  { once = false }: { once?: boolean } = {},
) {
  const events = listExceptionEvents();
  if (once && events.some((stored) => stored.id === event.id)) {
    return;
  }
  EVENTS = collapseEvent(events, event);
  scheduleWrite();
  publisher.publish("exceptions.updated", null);
}

export function clearExceptionEvents() {
  EVENTS = [];
  scheduleWrite();
  publisher.publish("exceptions.updated", null);
}

function scheduleWrite() {
  if (writeTimer) {
    return;
  }
  writeTimer = setTimeout(flushExceptionStore, WRITE_DELAY_MS);
  writeTimer.unref();
}

/** Write what is kept now, synchronously. Also run on exit. */
function flushExceptionStore() {
  clearTimeout(writeTimer);
  writeTimer = undefined;
  if (EVENTS === null) {
    return;
  }
  try {
    getStore().set("events", EVENTS);
  } catch {
    // The next capture tries again; the log has every one either way.
  }
}
