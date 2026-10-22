import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The workspace package has to run where Electron is not: in a utility
 * process, whose `electron` has almost none of the main process's API, and in
 * plain Node for the command line and evals. Nothing type-checks that, since
 * Studio's own `electron` resolves from anywhere in the monorepo, so an import
 * slips in looking ordinary and breaks only the hosts that are not main.
 *
 * Two halves. Every source file of the package and of the monorepo packages it
 * depends on, read as text, since an import added anywhere in the package can
 * be reached later. Then every package its runtime dependencies pull in, read
 * from their `package.json`s, since a library that needs Electron brings it in
 * without any import of ours naming it.
 */
const PACKAGE_DIR = path.resolve(import.meta.dirname, "..");

/** `electron` itself, and the families of packages that require it at runtime. */
const ELECTRON_PACKAGE = /^(?:electron(?:$|\/|-)|@electron(?:-toolkit)?\/)/;

const SOURCE_FILE = /\.(?:[cm]?[jt]s|tsx)$/;
const SKIPPED_DIRS = new Set(["coverage", "fixtures", "node_modules"]);
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

describe("workspace package", () => {
  it("imports nothing from Electron in its own sources or its monorepo dependencies", () => {
    const offenders = monorepoPackageDirs(PACKAGE_DIR).flatMap((dir) =>
      sourceFiles(dir).flatMap((file) =>
        [...fs.readFileSync(file, "utf8").matchAll(SPECIFIER)]
          .flatMap(([, specifier]) =>
            specifier !== undefined && ELECTRON_PACKAGE.test(specifier)
              ? [specifier]
              : [],
          )
          .map(
            (specifier) =>
              `${path.relative(path.dirname(PACKAGE_DIR), file)} imports ${specifier}`,
          ),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it("depends on no Electron package, however indirectly", () => {
    expect(electronDependencyChains(PACKAGE_DIR)).toEqual([]);
  });
});

type Manifest = {
  dependencies?: Record<string, string>;
  name?: string;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function readManifest(dir: string): Manifest {
  // `as`: JSON.parse is untyped, and a package.json is this shape or a broken
  // install the walk would fail on anyway.
  return JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  ) as Manifest;
}

/** What a package needs at runtime; its devDependencies never ship. */
function runtimeDependencies(dir: string): Record<string, string> {
  const manifest = readManifest(dir);
  return {
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
    ...manifest.dependencies,
  };
}

/** The package and every `workspace:` package it depends on, transitively. */
function monorepoPackageDirs(root: string): string[] {
  const found = new Set<string>();
  const queue = [fs.realpathSync(root)];
  while (queue.length > 0) {
    const dir = queue.pop();
    if (!dir || found.has(dir)) {
      continue;
    }
    found.add(dir);
    for (const [name, version] of Object.entries(runtimeDependencies(dir))) {
      const resolved = version.startsWith("workspace:")
        ? resolvePackage(dir, name)
        : undefined;
      if (resolved) {
        queue.push(resolved);
      }
    }
  }
  return [...found];
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(entry.parentPath, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_DIRS.has(entry.name) || entry.name.startsWith(".")
        ? []
        : sourceFiles(full);
    }
    return entry.isFile() && SOURCE_FILE.test(entry.name) ? [full] : [];
  });
}

/** Node's lookup: the nearest `node_modules/<name>` at or above `from`. */
function resolvePackage(from: string, name: string): string | undefined {
  let dir = from;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return fs.realpathSync(candidate);
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Every path from the package to an Electron package through runtime
 * dependencies, as `a > b > electron`. Each package is visited from its
 * installed folder, which pnpm gives a `node_modules` of exactly its own
 * dependencies, so the lookup finds the versions it really gets.
 */
function electronDependencyChains(root: string): string[] {
  const visited = new Set<string>();
  const chains: string[] = [];
  const queue: { chain: string[]; dir: string }[] = [
    { chain: [], dir: fs.realpathSync(root) },
  ];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || visited.has(current.dir)) {
      continue;
    }
    visited.add(current.dir);
    const chain = [
      ...current.chain,
      readManifest(current.dir).name ?? current.dir,
    ];
    for (const name of Object.keys(runtimeDependencies(current.dir))) {
      if (ELECTRON_PACKAGE.test(name)) {
        chains.push([...chain, name].join(" > "));
        continue;
      }
      const dir = resolvePackage(current.dir, name);
      if (dir) {
        queue.push({ chain, dir });
      }
    }
  }
  return chains;
}
