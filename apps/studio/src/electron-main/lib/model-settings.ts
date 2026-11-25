import { platformApiBaseUrl } from "@/electron-main/platform-api/base-url";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  applyServedModelSettings,
  onReportedFastMode,
} from "@instrument-org/ai-gateway";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { createScopedLogger } from "./electron-logger";

/**
 * What our API says each model's thinking levels and fast mode are, for the
 * connections whose own model lists do not say. The last copy used is kept in
 * userData, so a launch without the network still has it.
 */

const log = createScopedLogger("ModelSettings");

/** How often to ask while the app stays open. */
const POLL_MS = 6 * 60 * 60 * 1000;

const StateSchema = z.object({
  document: z.unknown().optional(),
  etag: z.string().optional(),
  fetchedAt: z.number().default(0),
});

type State = z.output<typeof StateSchema>;

function getStatePath() {
  return path.join(app.getPath("userData"), "model-settings.json");
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
    log.warn(new Error("Could not save the model settings", { cause: error }));
  }
}

async function fetchModelSettings(): Promise<void> {
  const base = platformApiBaseUrl();
  if (!base) {
    return;
  }
  const state = readState();
  try {
    const response = await fetch(`${base}/models/settings`, {
      headers: state.etag ? { "if-none-match": state.etag } : {},
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 304) {
      writeState({ ...state, fetchedAt: Date.now() });
      return;
    }
    if (!response.ok) {
      throw new Error(`The model settings answered ${response.status}`);
    }
    const document: unknown = await response.json();
    if (!applyServedModelSettings(document)) {
      log.warn("Kept the model settings as they were: could not read the new");
      return;
    }
    writeState({
      document,
      etag: response.headers.get("etag") ?? undefined,
      fetchedAt: Date.now(),
    });
    publisher.publish("model-choices.updated", null);
  } catch (error) {
    log.warn(new Error("Could not fetch the model settings", { cause: error }));
  }
}

/**
 * Uses the copy kept from the last launch, then asks for a newer one now,
 * every few hours, and when the window comes back after that long.
 */
export function startModelSettings() {
  const { document } = readState();
  if (document !== undefined && !applyServedModelSettings(document)) {
    // Asked for whole, as its ETag would answer that nothing changed.
    writeState({ fetchedAt: 0 });
  }
  void fetchModelSettings();
  setInterval(() => void fetchModelSettings(), POLL_MS);
  app.on("browser-window-focus", () => {
    if (Date.now() - readState().fetchedAt > POLL_MS) {
      void fetchModelSettings();
    }
  });
  onReportedFastMode(() => {
    publisher.publish("model-choices.updated", null);
  });
}
