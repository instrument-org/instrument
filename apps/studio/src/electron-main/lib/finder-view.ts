import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { logger } from "@/electron-main/lib/electron-logger";

import { getKeptState, setKeptState } from "../stores/workspace/kept-state";

const run = promisify(execFile);

/** The Files layout a folder opens in when it has none of its own (`computerViewAtom`). */
const VIEW_KEY = "computer-view.v2";

/**
 * Files' layout for each of the Finder's (`FXPreferredViewStyle`): its list,
 * with a column per detail, is Files' table. Gallery has no button in Files,
 * so it opens as the grid.
 */
const FINDER_VIEWS: Record<string, string> = {
  clmv: "columns",
  glyv: "icons",
  icnv: "icons",
  Nlsv: "table",
};

/**
 * Opens Files in the layout the person uses in the Finder, until they pick
 * one in Files. Read from the Finder's preferences, which need no
 * permission. Before any window loads, since a window reads its kept state
 * as it loads.
 */
export async function adoptFinderViewOnce(): Promise<void> {
  if (
    process.platform !== "darwin" ||
    getKeptState("view", VIEW_KEY) !== undefined
  ) {
    return;
  }
  try {
    const { stdout } = await run(
      "/usr/bin/defaults",
      ["read", "com.apple.finder", "FXPreferredViewStyle"],
      { timeout: 2000 },
    );
    const view = FINDER_VIEWS[stdout.trim()];
    if (view !== undefined) {
      setKeptState("view", VIEW_KEY, view);
    }
  } catch (error) {
    // A Mac whose Finder was never set to a layout has no value to read.
    logger.info("No Finder layout to adopt", error);
  }
}
