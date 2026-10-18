import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { type ReadRefusal, readRefusalOf } from "../read-refusal";
import { getWorkspaceConfig } from "../workspace-config";
import { WINDOWS_TMP } from "../workspace-fs-layout";
import { resolveThroughAliases } from "./finder-entries";
import { resolveICloudPath } from "./icloud-drive";

/**
 * What is at a path a person typed or pasted, asked once they press Return:
 * a folder or a file to open, nothing (with the closest folder above it that
 * opens), a place the system would not let this app read, or a read that
 * failed some other way. Inside a folder the Mac protects, a missing name and
 * a refused one answer the same, so `refused` never says nothing is there.
 */
export const LocatedPathSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("folder"), path: z.string() }),
  z.object({ kind: z.literal("file"), path: z.string() }),
  z.object({
    kind: z.literal("missing"),
    /** The closest folder above the path that this app can open. */
    nearest: z.string().optional(),
    path: z.string(),
  }),
  z.object({
    kind: z.literal("refused"),
    path: z.string(),
    reason: z.enum(["account", "system"]) satisfies z.ZodType<ReadRefusal>,
  }),
  z.object({
    /** The system's error code, when the read carried one; absent for words that are no path. */
    code: z.string().optional(),
    kind: z.literal("failed"),
    path: z.string(),
  }),
]);
export type LocatedPath = z.output<typeof LocatedPathSchema>;

/**
 * The folders the Mac's Data volume holds under `/System/Volumes/Data` and
 * shows again at the root, so a path spelled through the volume names the
 * same place as the one without it.
 */
const DATA_VOLUME_FIRMLINKS =
  /^\/System\/Volumes\/Data(\/(?:Applications|Library|Users|Volumes|opt|private|usr\/local)(?:\/|$))/;

/** What a Terminal escapes with a backslash when a name is dragged or completed into it. */
const SHELL_ESCAPED = /\\([ !"#$&'()*,;<=>?@[\\\]^`{|}~])/g;

/**
 * Words a person typed or pasted as a host path in the computer's own
 * spelling, or undefined when they are no path from the root: quotes around
 * them and a Terminal's escapes undone, a `file://` address read as the path
 * it names (`file:///~/x` as the home folder's), `~` as the home folder, and on
 * Windows the shell's spelling (`/c/Users`, `/tmp`) as the drive's.
 */
export function hostPathFromTyped(
  typed: string,
  {
    home,
    platform,
    tmp,
  }: { home: string; platform: NodeJS.Platform; tmp: string },
): string | undefined {
  const isWindows = platform === "win32";
  const paths = isWindows ? path.win32 : path.posix;
  let written = typed.trim();
  const quoted = /^(["'])(.*)\1$/s.exec(written);
  if (quoted) {
    written = (quoted[2] ?? "").trim();
  }
  if (/^file:/i.test(written)) {
    let url: URL;
    try {
      url = new URL(written);
    } catch {
      return;
    }
    const pathname = safeDecode(url.pathname);
    if (pathname === undefined) {
      return;
    }
    // A browser keeps `~` as a name; the person meant their home folder.
    if (url.host === "" && /^\/~(?:\/|$)/.test(pathname)) {
      written = pathname.slice(1);
    } else {
      try {
        written = fileURLToPath(url, { windows: isWindows });
      } catch {
        return;
      }
    }
  } else if (!isWindows) {
    written = written.replace(SHELL_ESCAPED, "$1");
  }
  if (written === "~" || (isWindows ? /^~[\\/]/ : /^~\//).test(written)) {
    written = paths.join(home, written.slice(1));
  } else if (isWindows) {
    const tmpPath = /^\/tmp(?:\/(.*))?$/i.exec(written);
    const drive = /^\/([a-z])(?:\/(.*))?$/i.exec(written);
    if (tmpPath) {
      written = path.win32.join(tmp, tmpPath[1] ?? "");
    } else if (drive) {
      written = `${(drive[1] ?? "").toUpperCase()}:\\${drive[2] ?? ""}`;
    } else if (/^[a-z]:$/i.test(written)) {
      written = `${written}\\`;
    }
  }
  if (
    !paths.isAbsolute(written) ||
    (isWindows && /^[\\/](?![\\/])/.test(written))
  ) {
    // A Windows path from the root of no drive in particular is no place.
    return;
  }
  if (platform === "darwin") {
    written = written.replace(DATA_VOLUME_FIRMLINKS, "$1");
  }
  const normalized = paths.normalize(written);
  return normalized === paths.parse(normalized).root
    ? normalized
    : normalized.replace(/[\\/]+$/, "");
}

/** What is at a typed path on this computer, read as the app's own user. */
export async function locateComputerPath(typed: string): Promise<LocatedPath> {
  const written = hostPathFromTyped(typed, {
    home: os.homedir(),
    platform: process.platform,
    tmp: WINDOWS_TMP,
  });
  if (written === undefined) {
    return { kind: "failed", path: typed.trim() };
  }
  const hostPath = await resolveThroughAliases(
    await resolveICloudPath(written, isPresent),
    getWorkspaceConfig().resolveAlias,
  );
  try {
    const stats = await fs.stat(hostPath);
    return { kind: stats.isDirectory() ? "folder" : "file", path: hostPath };
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") {
      const nearest = await nearestOpenFolder(hostPath);
      return {
        kind: "missing",
        ...(nearest === undefined ? {} : { nearest }),
        path: hostPath,
      };
    }
    const reason = readRefusalOf(error);
    if (reason !== undefined) {
      return { kind: "refused", path: hostPath, reason };
    }
    return {
      ...(code === undefined ? {} : { code }),
      kind: "failed",
      path: hostPath,
    };
  }
}

/**
 * The closest folder above a path that opens: one the system refused is
 * passed over, since sending a person on from "nothing there" to "not
 * allowed" leaves them nowhere better.
 */
async function nearestOpenFolder(hostPath: string) {
  let folder = path.dirname(hostPath);
  for (;;) {
    try {
      const dir = await fs.opendir(folder);
      await dir.close();
      return folder;
    } catch {
      const parent = path.dirname(folder);
      if (parent === folder) {
        return;
      }
      folder = parent;
    }
  }
}

async function isPresent(hostPath: string) {
  try {
    await fs.lstat(hostPath);
    return true;
  } catch {
    return false;
  }
}

function safeDecode(pathname: string) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return;
  }
}

/** The system error code a failed read carries, if it carries one. */
function errorCode(error: unknown) {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
