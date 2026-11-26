// Keeps a dev server plugin's transforms on disk between runs. The React
// Compiler's Babel pass is most of what a dev boot spends: every client
// module goes through it again on every start, on the dev server's one
// thread, while the window waits. A module whose text, path and plugin
// versions are unchanged gets its last output back instead.
//
// The cache is shared by every checkout on the machine, so a new worktree's
// first boot finds what another checkout compiled. Paths are kept relative
// to the checkout, in the key and in the source map, which is all that
// differs between two checkouts' outputs for the same file.

import type { Rolldown } from "vite";

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

/** Entries nobody wrote in this long are deleted when a dev server starts. */
const KEEP_MS = 14 * 24 * 60 * 60 * 1000;

const CACHE_DIR = path.join(tmpdir(), "instrument-dev-transforms");

const ROOT_MARK = "<checkout>";

type Transformed = { code?: string; map?: unknown };

type Handler = (
  this: unknown,
  code: string,
  id: string,
  options?: unknown,
) => Promise<Transformed | null | undefined> | Transformed | null | undefined;

/**
 * What decides a transform's output besides the module: the installed
 * versions of `packages`, resolved from the directory `from`, and the text
 * of `files` (the config that sets the plugin's options).
 */
export function transformSalt(
  from: string,
  { files, packages }: { files: string[]; packages: string[] },
) {
  const require = createRequire(`${from}${path.sep}`);
  const parts = packages.map((name) => {
    // Some packages export no `package.json`, so it is found above the entry.
    for (
      let dir = path.dirname(require.resolve(name));
      dir !== path.dirname(dir);
      dir = path.dirname(dir)
    ) {
      try {
        const manifest = JSON.parse(
          readFileSync(path.join(dir, "package.json"), "utf8"),
        ) as { name?: string; version?: string }; // A package manifest.
        if (manifest.name === name && manifest.version) {
          return `${name}@${manifest.version}`;
        }
      } catch {
        // No manifest at this level.
      }
    }
    throw new Error(`No package.json found for ${name}`);
  });
  return [...parts, ...files.map((file) => readFileSync(file, "utf8"))].join(
    "\0",
  );
}

/**
 * `plugin` with its transform's output cached on disk under a key made of
 * `salt` ({@link transformSalt}), the module's path within `root`, its
 * module type and its text.
 */
export async function cacheTransforms(
  pending: Promise<Rolldown.Plugin>,
  { root, salt }: { root: string; salt: string },
): Promise<Rolldown.Plugin> {
  const plugin = await pending;
  const hook = plugin.transform;
  if (!hook || typeof hook === "function") {
    throw new Error(`${plugin.name} has no transform with a filter to cache`);
  }
  // The plugin sets its filter on this same object later, so only the
  // handler is replaced.
  const transform = hook.handler as Handler; // The hook's type, narrowed to the arguments read here.
  pruneOldEntries();
  const prefix = `${root}${path.sep}`;
  hook.handler = async function cachedTransform(
    this: { environment?: { name: string } },
    code: string,
    id: string,
    options?: unknown,
  ) {
    if (!id.startsWith(prefix)) {
      return transform.call(this, code, id, options);
    }
    const key = createHash("sha256")
      .update(salt)
      .update("\0")
      .update(this.environment?.name ?? "")
      .update("\0")
      .update(id.slice(prefix.length))
      .update("\0")
      .update(
        String((options as { moduleType?: string } | undefined)?.moduleType),
      )
      .update("\0")
      .update(code)
      .digest("hex");
    const file = path.join(CACHE_DIR, key.slice(0, 2), `${key}.json`);
    try {
      return fromCache(await fs.readFile(file, "utf8"), root);
    } catch {
      // Not compiled before, or written by an interrupted run.
    }
    const result = await transform.call(this, code, id, options);
    if (result) {
      void write(file, toCache(result, root));
    }
    return result;
  } as typeof hook.handler;
  return plugin;
}

function toCache(result: Transformed, root: string) {
  return JSON.stringify(result).replaceAll(
    JSON.stringify(root).slice(1, -1),
    ROOT_MARK,
  );
}

function fromCache(text: string, root: string): Transformed {
  return JSON.parse(
    text.replaceAll(ROOT_MARK, JSON.stringify(root).slice(1, -1)),
  ) as Transformed; // Written by toCache from a transform's result.
}

/** Written whole or not at all, since another checkout may read it at once. */
async function write(file: string, text: string) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const staging = `${file}.${process.pid}.tmp`;
    await fs.writeFile(staging, text);
    await fs.rename(staging, file);
  } catch {
    // A transform that is not cached is only compiled again next time.
  }
}

/** Deletes entries no run has written for {@link KEEP_MS}, once per start. */
function pruneOldEntries() {
  const now = Date.now();
  setTimeout(() => {
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
      for (const bucket of readdirSync(CACHE_DIR)) {
        const dir = path.join(CACHE_DIR, bucket);
        for (const name of readdirSync(dir)) {
          const file = path.join(dir, name);
          if (now - statSync(file).mtimeMs > KEEP_MS) {
            void fs.rm(file, { force: true });
          }
        }
      }
    } catch {
      // Pruning is housekeeping; the next start tries again.
    }
  }, 60_000).unref();
}
