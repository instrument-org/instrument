// What the snapshot tools share: where the library is and how a state is read from it.
// A state is Studio's own page in one state, kept whole by the wireframe skill's
// snapshot.js as capture.mjs drove a booted app there; snap() in kit/snap.js draws a
// frame from one through the skill's snapshot frames.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The library: `SNAP_LIBRARY`, or `~/wireframes/snaps`. */
export const LIBRARY = process.env.SNAP_LIBRARY ?? path.join(os.homedir(), "wireframes/snaps");

/** A state's files in the library: `<name>.json` the snapshot, `.png` its picture, `.outline.txt` its names. */
export const stateFile = (/** @type {string} */ name, /** @type {string} */ ext) => path.join(LIBRARY, "states", `${name}${ext}`);

/** The library's states, by name. */
export const stateNames = () =>
  fs.existsSync(path.join(LIBRARY, "states"))
    ? fs
        .readdirSync(path.join(LIBRARY, "states"))
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5))
    : [];

/**
 * A state as the skill's snapshot.js returned it: `{ w, h, url, title, bg, notes, html }`.
 * @returns {{ w: number, h: number, url: string, title: string, bg: string, notes: string[], html: string }}
 */
export function loadState(/** @type {string} */ name) {
  const file = stateFile(name, ".json");
  if (!fs.existsSync(file))
    throw new Error(
      `snap("${name}"): the library at ${LIBRARY} has no such state. It has: ${stateNames().join(", ") || "nothing yet (run snap/capture.mjs, then snap/library.mjs)"}`,
    );
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
