import fs from "node:fs";
import path from "node:path";

/**
 * Settings that have to be applied before Chromium starts, from a file rather
 * than the environment.
 *
 * The environment is unreachable for the user who needs this. The app is
 * launched from a desktop entry, a dock, or a compositor keybind, none of which
 * run a shell to export into, so acting on the advice would mean hand-editing a
 * `.desktop` file. A file also survives what the environment does not: an
 * update, a relaunch the updater performs, and a launch from a different
 * launcher.
 */
export interface LaunchOverrides {
  /**
   * Draw without the GPU. The way out for a machine whose driver leaves the
   * app blank, corrupted, or repainting far slower than software would, which
   * is the state in which no setting inside the app can be reached to fix it.
   */
  disableHardwareAcceleration: boolean;
}

export interface LaunchOverridesResult {
  /**
   * Where the file is looked for, whether or not it is there, so a log can
   * name it. Nothing else records the path, and an override nobody can find is
   * the same as one that does not exist.
   */
  filePath: string;
  overrides: LaunchOverrides;
  /**
   * What the file held and the app could not use. Collected rather than thrown
   * so one bad key does not discard the others, and reported so a user editing
   * this by hand is told when it did nothing.
   */
  problems: string[];
}

/** Sits in `userData` so it survives updates and is per-installation. */
export const LAUNCH_OVERRIDES_FILENAME = "launch-overrides.json";

const NO_OVERRIDES: LaunchOverrides = { disableHardwareAcceleration: false };

/**
 * Split from the read so the shapes a hand-edited file arrives in can be
 * exercised without one on disk.
 */
export function parseLaunchOverrides(contents: string): {
  overrides: LaunchOverrides;
  problems: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return {
      overrides: NO_OVERRIDES,
      problems: [`${LAUNCH_OVERRIDES_FILENAME} is not valid JSON`],
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      overrides: NO_OVERRIDES,
      problems: [`${LAUNCH_OVERRIDES_FILENAME} is not an object`],
    };
  }

  const record: Record<string, unknown> = { ...parsed };
  const problems: string[] = [];

  const disableHardwareAcceleration = record["disable-hardware-acceleration"];
  if (
    disableHardwareAcceleration !== undefined &&
    typeof disableHardwareAcceleration !== "boolean"
  ) {
    problems.push("disable-hardware-acceleration must be true or false");
  }

  return {
    overrides: {
      disableHardwareAcceleration: disableHardwareAcceleration === true,
    },
    problems,
  };
}

/**
 * Read the file, treating every way it can be wrong as an absence plus a note.
 *
 * Nothing here can throw. It runs before the app has a window, so a syntax
 * error in a file the user typed by hand must not be the thing that stops the
 * app from starting.
 */
export function readLaunchOverrides(
  userDataPath: string,
): LaunchOverridesResult {
  const filePath = path.join(userDataPath, LAUNCH_OVERRIDES_FILENAME);

  let contents: string;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch {
    // Absent is the normal case and says nothing worth logging.
    return { filePath, overrides: NO_OVERRIDES, problems: [] };
  }

  return { filePath, ...parseLaunchOverrides(contents) };
}
