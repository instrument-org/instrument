import { getAnonymousPlatformApiHeaders } from "@/electron-main/platform-api/headers";
import { applyServedAppCatalog } from "@instrument-org/workspace/electron";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { createScopedLogger } from "./electron-logger";

/**
 * The app directory as our API serves it, so a fix to the directory (a moved
 * endpoint, a new sign-in client, a new service) reaches builds already
 * installed. The last copy used is kept in userData and used at the next
 * launch before the window asks for the directory, so a launch without the
 * network keeps the fixes it already had. The built-in directory stands in
 * until a copy arrives, and whenever one is older than it.
 */

const log = createScopedLogger("AppCatalog");

/** How often to ask while the app stays open. */
const POLL_MS = 6 * 60 * 60 * 1000;

const StateSchema = z.object({
  document: z.unknown().optional(),
  etag: z.string().optional(),
  fetchedAt: z.number().default(0),
});

type State = z.output<typeof StateSchema>;

let inFlight: Promise<void> | undefined;

function getStatePath() {
  return path.join(app.getPath("userData"), "app-catalog.json");
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
    fs.writeFileSync(getStatePath(), JSON.stringify(state));
  } catch (error) {
    log.warn(new Error("Could not save the app directory", { cause: error }));
  }
}

/**
 * Asks for the directory, sending the last ETag so an unchanged one is a 304.
 * A copy is kept only once it has been used, so one this build refuses is
 * asked for whole next time rather than matched by its ETag.
 */
export function fetchAppCatalog(): Promise<void> {
  inFlight ??= (async () => {
    const base = import.meta.env.MAIN_VITE_APP_API_BASE_URL;
    if (!base) {
      return;
    }
    const state = readState();
    try {
      const response = await fetch(`${base}/apps/catalog`, {
        headers: {
          ...getAnonymousPlatformApiHeaders(),
          ...(state.etag ? { "if-none-match": state.etag } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 304) {
        writeState({ ...state, fetchedAt: Date.now() });
        return;
      }
      if (!response.ok) {
        throw new Error(`The app directory answered ${response.status}`);
      }
      const document: unknown = await response.json();
      const outcome = applyServedAppCatalog(document);
      if (outcome !== "used") {
        log.warn(
          `Kept the app directory as it was: the served one is ${outcome}`,
        );
        return;
      }
      writeState({
        document,
        etag: response.headers.get("etag") ?? undefined,
        fetchedAt: Date.now(),
      });
    } catch (error) {
      log.warn(
        new Error("Could not fetch the app directory", { cause: error }),
      );
    }
  })().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

/**
 * Uses the copy kept from the last launch, then asks for a newer one now,
 * every few hours, and when the window comes back after that long.
 */
export function startAppCatalog() {
  const { document } = readState();
  if (document !== undefined) {
    const outcome = applyServedAppCatalog(document);
    if (outcome !== "used") {
      // Older than this build's own, which it was updated past.
      writeState({ fetchedAt: 0 });
    }
  }
  void fetchAppCatalog();
  setInterval(() => void fetchAppCatalog(), POLL_MS);
  app.on("browser-window-focus", () => {
    if (Date.now() - readState().fetchedAt > POLL_MS) {
      void fetchAppCatalog();
    }
  });
}
