import fs from "node:fs";
import path from "node:path";

/**
 * Settings that have to be applied before Chromium starts, from a file rather
 * than the environment.
 *
 * Both of these already have environment variables, and an environment variable
 * is unreachable for the user who needs one. The app is launched from a desktop
 * entry, a dock, or a compositor keybind, none of which run a shell the user
 * can export into, so acting on the advice means hand-editing a `.desktop`
 * file. That is the gap this closes: the settings that answer a display or
 * graphics problem are the settings whose owner cannot reach the environment.
 *
 * A file also survives what the environment does not. It stays put across an
 * update, a relaunch the updater performs, and a launch from a different
 * launcher, so a user who fixed their machine once does not find it broken
 * again after the next release.
 */
export interface LaunchOverrides {
  /**
   * Draw without the GPU. The way out for a machine whose driver leaves the
   * app blank, corrupted, or repainting far slower than software would.
   */
  disableHardwareAcceleration: boolean;
  /**
   * A display protocol to pin, carried as written and left for
   * `resolveOzonePlatform` to validate, so one place decides what counts as a
   * platform name and the environment variable and the file cannot disagree.
   */
  ozonePlatform: string | undefined;
}

export interface LaunchOverridesResult {
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

const NO_OVERRIDES: LaunchOverrides = {
  disableHardwareAcceleration: false,
  ozonePlatform: undefined,
};

/**
 * Split from the read so the shapes a hand-edited file arrives in can be
 * exercised without one on disk.
 */
export function parseLaunchOverrides(contents: string): LaunchOverridesResult {
  const problems: string[] = [];

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

  const ozonePlatform = record["ozone-platform"];
  if (ozonePlatform !== undefined && typeof ozonePlatform !== "string") {
    problems.push("ozone-platform must be a string");
  }

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
      ozonePlatform:
        typeof ozonePlatform === "string" ? ozonePlatform : undefined,
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
  let contents: string;
  try {
    contents = fs.readFileSync(
      path.join(userDataPath, LAUNCH_OVERRIDES_FILENAME),
      "utf8",
    );
  } catch {
    // Absent is the normal case and says nothing worth logging.
    return { overrides: NO_OVERRIDES, problems: [] };
  }
  return parseLaunchOverrides(contents);
}
