import { webContents } from "electron";

import { createScopedLogger } from "./electron-logger";
import { liveFileWatches } from "./watch-host-file";

const log = createScopedLogger("Load");

/** How long the counts settle after a change before they are logged. */
const SETTLE_MS = 2000;

/** The least time between two lines, so a busy hour logs a line a minute at most. */
const MIN_GAP_MS = 60_000;

type GuestCounts = { asleep: number; live: number; shown: number };

/** What each window draws, by its renderer's web contents, as it last said. */
const drawnByWindow = new Map<
  number,
  { drawnGroups: number; keptScreens: number }
>();

let countGuests: () => GuestCounts = () => ({ asleep: 0, live: 0, shown: 0 });
let timer: NodeJS.Timeout | undefined;
let lastAt = 0;
let lastLine = "";

/** Where the guest counts come from: the browser view manager, once it is made. */
export function countGuestsWith(count: () => GuestCounts) {
  countGuests = count;
}

/** A window's renderer saying how many groups it draws and how many screens it keeps. */
export function noteDrawn(
  webContentsId: number,
  drawn: { drawnGroups: number; keptScreens: number },
) {
  drawnByWindow.set(webContentsId, drawn);
  noteLoad();
}

/**
 * Logs what the windows draw and keep alive (groups drawn, screens kept,
 * guest pages live and asleep, files watched) once the counts settle after a
 * change, a minute apart at most, and only when the line differs from the
 * last one.
 */
export function noteLoad() {
  if (timer) {
    return;
  }
  timer = setTimeout(
    () => {
      timer = undefined;
      const line = loadLine();
      if (line !== lastLine) {
        lastLine = line;
        lastAt = Date.now();
        log.info(line);
      }
    },
    Math.max(SETTLE_MS, lastAt + MIN_GAP_MS - Date.now()),
  );
  timer.unref();
}

function loadLine() {
  let drawnGroups = 0;
  let keptScreens = 0;
  for (const [id, drawn] of drawnByWindow) {
    const window = webContents.fromId(id);
    if (!window || window.isDestroyed()) {
      drawnByWindow.delete(id);
      continue;
    }
    drawnGroups += drawn.drawnGroups;
    keptScreens += drawn.keptScreens;
  }
  const guests = countGuests();
  return `load windows=${String(drawnByWindow.size)} drawnGroups=${String(drawnGroups)} keptScreens=${String(keptScreens)} guestsLive=${String(guests.live)} guestsAsleep=${String(guests.asleep)} guestsShown=${String(guests.shown)} fileWatches=${String(liveFileWatches())}`;
}
