// Records which npm packages each Vite build compiled into its output, so the
// notices written at packaging time cover what the bundles really hold rather
// than everything a dependency walk can reach. Each build emits
// `<name>.bundled-packages.json` beside its output; electron-builder.ts keeps
// the manifests out of the packaged app.
//
// A package counts when one of its modules is rendered into a chunk or one of
// its files is emitted as an asset (a font a stylesheet points at, a worker).
// Modules tree-shaken away entirely do not count.

import type { Plugin } from "vite";

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Read only at packaging time: electron-vite inlines this module into the
// config it bundles, where `import.meta.dirname` is the config's folder.
const OUT_DIR = path.resolve(import.meta.dirname, "..", "out");

/**
 * Every build electron.vite.config.ts runs, by the name its manifest carries,
 * and the folder under `out/` it writes to.
 */
export const BUNDLES = {
  main: "main",
  "page-editor-guest": "page-editor",
  "page-editor-preload": "page-editor",
  preload: "preload",
  renderer: "renderer",
} as const;

export type BundleName = keyof typeof BUNDLES;

type BundledPackage = {
  /** The package folder, relative to the folder holding the manifest. */
  dir: string;
  name: string;
  version: string;
};

const MANIFEST_SUFFIX = ".bundled-packages.json";

/**
 * The folder of the npm package a module id belongs to, or `undefined` for
 * one of the app's own modules or a virtual one. Vite and Rolldown prefix
 * some ids with `\0` and suffix others with a query, and either can wrap a
 * real path.
 */
export function packageDirOfModule(id: string) {
  const file = id.replace(/^\0/, "").replace(/\?.*$/, "").replaceAll("\\", "/");
  const marker = "/node_modules/";
  const at = file.lastIndexOf(marker);
  if (at === -1) {
    return undefined;
  }
  const rest = file.slice(at + marker.length).split("/");
  const name = rest[0]?.startsWith("@") ? rest.slice(0, 2) : rest.slice(0, 1);
  if (
    name.length === 0 ||
    name.some((part) => part === "" || part === ".pnpm")
  ) {
    return undefined;
  }
  return `${file.slice(0, at + marker.length)}${name.join("/")}`;
}

type PackageJson = { name?: string; version?: string };

/** A Vite plugin that writes the manifest for the build named `name`. */
export function recordBundledPackages(name: BundleName): Plugin {
  // An asset's original file name is relative to the build's root.
  let root = process.cwd();
  return {
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    generateBundle(options, bundle) {
      const outDir = options.dir ?? root;
      const dirs = new Set<string>();
      for (const output of Object.values(bundle)) {
        const ids =
          output.type === "chunk" ? output.moduleIds : output.originalFileNames;
        for (const id of ids) {
          const dir = packageDirOfModule(
            path.isAbsolute(id) || id.startsWith("\0")
              ? id
              : path.resolve(root, id),
          );
          if (dir) {
            dirs.add(dir);
          }
        }
      }
      const packages = [...dirs]
        .map((dir): BundledPackage => {
          const { name: packageName, version } = JSON.parse(
            readFileSync(path.join(dir, "package.json"), "utf8"),
          ) as PackageJson; // The package's own manifest.
          return {
            dir: path.relative(outDir, dir).split(path.sep).join("/"),
            name: packageName ?? path.basename(dir),
            version: version ?? "",
          };
        })
        .toSorted((a, b) => a.dir.localeCompare(b.dir));
      this.emitFile({
        fileName: `${name}${MANIFEST_SUFFIX}`,
        source: `${JSON.stringify(packages, null, 2)}\n`,
        type: "asset",
      });
    },
    name: "record-bundled-packages",
  };
}

/**
 * The packages every build recorded, with absolute folders. Throws when a
 * build left no manifest, which means its output predates this check or the
 * plugin fell off its config.
 */
export function readBundledPackages({
  outDir = OUT_DIR,
}: { outDir?: string } = {}) {
  return Object.entries(BUNDLES).flatMap(([name, folder]) => {
    const file = path.join(outDir, folder, `${name}${MANIFEST_SUFFIX}`);
    if (!existsSync(file)) {
      throw new Error(
        `No bundled-package manifest at ${file}. Build with \`pnpm --filter @instrument-org/studio build\` before packaging, and keep recordBundledPackages("${name}") in electron.vite.config.ts.`,
      );
    }
    const packages = JSON.parse(readFileSync(file, "utf8")) as BundledPackage[]; // Written by recordBundledPackages above.
    return packages.map((entry) => ({
      ...entry,
      dir: path.resolve(path.dirname(file), entry.dir),
    }));
  });
}
