import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";

import { canonicalizeThroughMissing } from "../host-path";

/** The app's own environment, read live, as any process's. */
export const appEnv: NodeJS.ProcessEnv = process.env;

/**
 * The places native tools keep as their own: macOS's per-user cache folder,
 * which the frameworks a native tool loads write to. ~/Library/Caches stays
 * as the rules say: other apps keep code there they run later outside any
 * sandbox (Playwright's browsers, Go's builds).
 */
export function toolCaches(): string[] {
  const userCache = darwinUserCacheDir();
  return userCache ? [userCache] : [];
}

/**
 * The per-user cache folder macOS gives every program
 * (`DARWIN_USER_CACHE_DIR`), beside the temp folder it also gives
 * (`/var/folders/<id>/T`), and written to by the frameworks a native tool
 * loads. Undefined anywhere the temp folder is not laid out that way.
 */
function darwinUserCacheDir(): string | undefined {
  if (process.platform !== "darwin") {
    return undefined;
  }
  const temp = resolveReal(os.tmpdir());
  return path.basename(temp) === "T"
    ? path.join(path.dirname(temp), "C")
    : undefined;
}

export function depthOf(hostPath: string): number {
  return path.resolve(hostPath).split(path.sep).filter(Boolean).length;
}

export function resolveReal(target: string): string {
  return canonicalizeThroughMissing(target) ?? target;
}

/**
 * A path as written and, where a link is on the way, where it really is.
 * Seatbelt checks both the link it opens through and what it lands on, so a
 * rule names the two.
 */
export function spellings(
  target: string,
  real: (target: string) => string = resolveReal,
): string[] {
  const written = path.resolve(target);
  const resolved = real(target);
  return resolved === written ? [written] : [written, resolved];
}

export function canWrite(target: string): boolean {
  try {
    accessSync(target, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
