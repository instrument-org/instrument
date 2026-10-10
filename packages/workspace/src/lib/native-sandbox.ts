import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { getWorkspaceConfig } from "./workspace-config";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/**
 * Places in the home folder that hold sign-ins rather than work: keys, cloud
 * and CLI credentials, password stores, and browser profiles with their
 * cookies. A native command never needs to read one to do a task, and any of
 * them is enough to act as the person somewhere else.
 *
 * `~/.npmrc` and `~/.gitconfig` stay reachable: pnpm and uv read them for
 * registry and proxy settings, and git's own env already ignores the config.
 */
const CREDENTIAL_PLACES = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".config/gcloud",
  ".kube",
  ".docker/config.json",
  ".netrc",
  ".git-credentials",
  ".config/gh",
  ".config/op",
  ".password-store",
  "Library/Keychains",
  "Library/Cookies",
  "Library/Application Support/Google/Chrome",
  "Library/Application Support/BraveSoftware",
  "Library/Application Support/Microsoft Edge",
  "Library/Application Support/Arc",
  "Library/Application Support/Firefox",
  "Library/Group Containers/2BUA8C4S2C.com.1password",
];

/** The credential places as absolute paths in this person's home folder. */
export function credentialPlaces(home = os.homedir()): string[] {
  return CREDENTIAL_PLACES.map((place) => path.join(home, place));
}

/**
 * A Seatbelt profile that allows everything but reading or writing the given
 * paths. Allow-by-default keeps every system directory, cache, and device a
 * binary expects where it was, so a command that worked unsandboxed works the
 * same unless it reaches into a denied place.
 *
 * Seatbelt compares real paths, so each one is resolved through any symlink
 * first; a path that does not exist yet is denied as written.
 */
export function seatbeltProfile(denied: readonly string[]): string {
  const rules = denied.map((deniedPath) => {
    const real = resolveReal(deniedPath);
    return `(deny file-read* file-write* (subpath ${sbplString(real)}))`;
  });
  return ["(version 1)", "(allow default)", ...rules].join("\n");
}

function resolveReal(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

function sbplString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

let available: boolean | undefined;

/**
 * Whether a profile can be applied from this process. False off macOS, and on
 * macOS when this process is itself sandboxed (Seatbelt does not nest), which
 * is the case under some agent harnesses and in a test runner run inside one.
 */
export function seatbeltAvailable(): boolean {
  if (process.platform !== "darwin") {
    return false;
  }
  if (available === undefined) {
    try {
      execFileSync(
        SANDBOX_EXEC,
        ["-p", "(version 1)(allow default)", "/usr/bin/true"],
        {
          stdio: "ignore",
          timeout: 5000,
        },
      );
      available = true;
    } catch {
      available = false;
    }
  }
  return available;
}

/**
 * The command to spawn for a native binary, held out of `denied` on macOS.
 * Elsewhere, or when Seatbelt cannot apply, the command comes back unchanged
 * and `sandboxed` says so.
 */
export function wrapNativeCommand(
  file: string,
  args: readonly string[],
  denied: readonly string[] = getWorkspaceConfig().nativeSandboxPlaces ?? [],
): {
  args: string[];
  denied: readonly string[];
  file: string;
  sandboxed: boolean;
} {
  // A binary that is not there is left to fail as itself, so the shim's
  // not-found diagnostic names it rather than sandbox-exec's execvp error.
  if (
    denied.length === 0 ||
    !seatbeltAvailable() ||
    (path.isAbsolute(file) && !existsSync(file))
  ) {
    return { args: [...args], denied, file, sandboxed: false };
  }
  return {
    args: ["-p", seatbeltProfile(denied), file, ...args],
    denied,
    file: SANDBOX_EXEC,
    sandboxed: true,
  };
}

/**
 * The denied place a failed command's output names, if any, so the agent is
 * told the place was kept from it on purpose rather than left to read a bare
 * "Operation not permitted" as something to work around.
 */
export function deniedPlaceIn(
  output: string,
  denied: readonly string[],
): string | undefined {
  if (!output.includes("not permitted")) {
    return undefined;
  }
  return denied.find(
    (deniedPath) =>
      output.includes(deniedPath) || output.includes(resolveReal(deniedPath)),
  );
}

/** What the agent reads when a denied place stopped a native command. */
export function deniedPlaceNote(
  deniedPath: string,
  home = os.homedir(),
): string {
  const shown = deniedPath.startsWith(`${home}/`)
    ? `~/${deniedPath.slice(home.length + 1)}`
    : deniedPath;
  return `${shown} is kept out of reach of the commands Instrument runs, because it holds passwords or sign-ins. Don't look for another way in; tell the person what you needed it for.`;
}
