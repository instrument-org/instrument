import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { REVIEWED } from "./unsandboxed-uutils";

/**
 * Whether a uutils binary is the one the rules were reviewed against, before
 * it runs outside the sandbox. Skipping the sandbox runs whatever sits at the
 * app's uutils folder, which in a development checkout, or an install in a
 * folder the agent may change, the agent could replace. So each binary is
 * hashed once, against the sha256 `REVIEWED` holds for this build's target
 * (in the app's own code rather than a manifest beside the binaries, which
 * whoever could change a binary could change too), and before each run
 * after that its identity on disk (device, inode, size, change and
 * modification times) is compared with what was hashed. Anything else, a
 * binary that differs or a target with no hashes, runs sandboxed.
 */

type Identity = {
  ctimeMs: number;
  dev: number;
  ino: number;
  mtimeMs: number;
  size: number;
};

/** What each binary was when it was last hashed, and whether it matched. */
const hashed = new Map<string, Identity & { reviewed: boolean }>();

function identityOf(file: string): Identity | undefined {
  try {
    const { ctimeMs, dev, ino, mtimeMs, size } = statSync(file);
    return { ctimeMs, dev, ino, mtimeMs, size };
  } catch {
    return undefined;
  }
}

function sameIdentity(a: Identity, b: Identity): boolean {
  return (
    a.ctimeMs === b.ctimeMs &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.mtimeMs === b.mtimeMs &&
    a.size === b.size
  );
}

/** The reviewed sha256 for a binary on this target, by its base name. */
export function reviewedSha256(
  file: string,
  target = `${process.platform}-${process.arch}`,
): string | undefined {
  const targets: Record<string, { files: Record<string, string> }> =
    REVIEWED.targets;
  const name = path.basename(file).replace(/\.exe$/i, "");
  return targets[target]?.files[name];
}

/**
 * Whether `file` may run outside the sandbox: its bytes hash to the reviewed
 * sha256 for this target, checked by hash the first time and whenever its
 * identity on disk changed since, and by identity otherwise.
 */
export function uutilsBinaryReviewed(
  file: string,
  expected = reviewedSha256(file),
): boolean {
  if (expected === undefined) {
    return false;
  }
  const before = identityOf(file);
  if (before === undefined) {
    return false;
  }
  const known = hashed.get(file);
  if (known && sameIdentity(known, before)) {
    return known.reviewed;
  }
  hashed.delete(file);
  let actual: string;
  try {
    actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch {
    return false;
  }
  const after = identityOf(file);
  // Changed while it was read: neither the hash nor the identity is
  // known to belong to what will run.
  if (!after || !sameIdentity(before, after)) {
    return false;
  }
  const reviewed = actual === expected;
  hashed.set(file, { ...after, reviewed });
  return reviewed;
}
