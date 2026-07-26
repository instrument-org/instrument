import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { type AbsolutePath } from "../schemas/paths";
import { getIgnore } from "./get-ignore";
import { SKILL_COPY_IGNORE } from "./skill-artifact-ignore";

interface CachedFingerprint {
  fingerprint: string;
  signature: string;
}

interface PackageEntry {
  absolutePath: string;
  kind: "directory" | "file" | "symlink";
  relativePath: string;
  stamp: string;
}

const CACHE_ENTRY_LIMIT = 256;
const CACHE = new Map<string, CachedFingerprint>();

/**
 * Hashes the authored package that `load_skill` copies, reusing the digest
 * while its recursive metadata signature is unchanged.
 */
export async function getSkillPackageFingerprint(skillDir: AbsolutePath) {
  const entries = await readPackageEntries(skillDir);
  const signatureHash = createHash("sha256");
  for (const { kind, relativePath, stamp } of entries) {
    signatureHash.update(kind);
    signatureHash.update("\0");
    signatureHash.update(relativePath);
    signatureHash.update("\0");
    signatureHash.update(stamp);
    signatureHash.update("\0");
  }
  const signature = signatureHash.digest("hex");
  const cached = CACHE.get(skillDir);
  if (cached?.signature === signature) {
    CACHE.delete(skillDir);
    CACHE.set(skillDir, cached);
    return cached.fingerprint;
  }

  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(entry.kind);
    hash.update("\0");
    hash.update(entry.relativePath);
    hash.update("\0");
    if (entry.kind === "file") {
      hash.update(await hashFile(entry.absolutePath));
    } else if (entry.kind === "symlink") {
      hash.update(await fs.readlink(entry.absolutePath));
    }
    hash.update("\0");
  }
  const fingerprint = hash.digest("hex");
  CACHE.set(skillDir, { fingerprint, signature });
  if (CACHE.size > CACHE_ENTRY_LIMIT) {
    const oldest = CACHE.keys().next().value;
    if (oldest !== undefined) {
      CACHE.delete(oldest);
    }
  }
  return fingerprint;
}

async function hashFile(filePath: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest();
}

async function readPackageEntries(skillDir: AbsolutePath) {
  const baseIgnore = await getIgnore(skillDir);
  const ignore = baseIgnore.add(SKILL_COPY_IGNORE);
  const results: PackageEntry[] = [];

  async function walk(dir: string, relativeDir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      const relativePath = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;
      if (ignore.ignores(relativePath) || ignore.ignores(`${relativePath}/`)) {
        continue;
      }
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push({
          absolutePath,
          kind: "directory",
          relativePath,
          stamp: "",
        });
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) {
        continue;
      }
      const stats = await fs.lstat(absolutePath, { bigint: true });
      results.push({
        absolutePath,
        kind: entry.isSymbolicLink() ? "symlink" : "file",
        relativePath,
        stamp: [stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(":"),
      });
    }
  }

  await walk(skillDir, "");
  return results;
}
