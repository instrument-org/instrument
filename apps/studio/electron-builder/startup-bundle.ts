// Records what each build loads at startup, so a check can fail when the
// startup path grows past its budget or takes in a package that belongs
// behind a dynamic import. The startup path is the static import closure of
// the build's entry chunks plus the chunks of `roots`: modules the entry
// imports dynamically but awaits before the app is up, such as main's
// `index.ts` behind `boot.ts`. Each build emits `<name>.startup-bundle.json`
// beside its output; electron-builder.ts keeps the manifests out of the
// packaged app, and `scripts/check-startup-bundle.ts` reads them.

import type { Plugin, Rolldown } from "vite";

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { BUNDLES, type BundleName } from "./bundled-packages.ts";

const MANIFEST_SUFFIX = ".startup-bundle.json";

export type StartupBundle = {
  /** JavaScript and CSS bytes on the startup path. */
  bytes: number;
  /** Output files on the startup path, each a request the app makes. */
  files: string[];
  /** Packages loaded from node_modules at runtime, imported statically on the startup path. */
  externals: string[];
  /** Rendered bytes per package, largest first; the app's own code is `(app)`. */
  packages: Record<string, number>;
};

/**
 * The package a bundled module belongs to: its npm name, the monorepo
 * package it comes from, or `(app)` for the build's own code.
 */
function packageOfModule(id: string) {
  const file = id.replace(/^\0/, "").replace(/\?.*$/, "").replaceAll("\\", "/");
  const marker = "/node_modules/";
  const at = file.lastIndexOf(marker);
  if (at !== -1) {
    const rest = file.slice(at + marker.length).split("/");
    return (
      rest[0]?.startsWith("@") ? rest.slice(0, 2) : rest.slice(0, 1)
    ).join("/");
  }
  const workspace = /\/packages\/([^/]+)\/src\//.exec(file)?.[1];
  if (workspace) {
    return `@instrument-org/${workspace}`;
  }
  return "(app)";
}

/** Measures the startup path of a finished bundle. */
export function measureStartup(
  bundle: Rolldown.OutputBundle,
  roots: RegExp[] = [],
): StartupBundle {
  const chunks = new Map<string, Rolldown.OutputChunk>();
  for (const output of Object.values(bundle)) {
    if (output.type === "chunk") {
      chunks.set(output.fileName, output);
    }
  }
  const files = new Set<string>();
  const externals = new Set<string>();
  const packages: Record<string, number> = {};
  let bytes = 0;
  const visit = (chunk: Rolldown.OutputChunk) => {
    if (files.has(chunk.fileName)) {
      return;
    }
    files.add(chunk.fileName);
    bytes += Buffer.byteLength(chunk.code);
    for (const [id, module] of Object.entries(chunk.modules)) {
      const name = packageOfModule(id);
      packages[name] = (packages[name] ?? 0) + module.renderedLength;
    }
    for (const css of chunk.viteMetadata?.importedCss ?? []) {
      const asset = bundle[css];
      if (asset?.type === "asset" && !files.has(css)) {
        files.add(css);
        bytes +=
          typeof asset.source === "string"
            ? Buffer.byteLength(asset.source)
            : asset.source.byteLength;
      }
    }
    for (const imported of chunk.imports) {
      const next = chunks.get(imported);
      if (next) {
        visit(next);
      } else {
        // A package's subpath counts as the package, for the bans.
        externals.add(
          imported
            .split("/")
            .slice(0, imported.startsWith("@") ? 2 : 1)
            .join("/"),
        );
      }
    }
  };
  const matched = new Set<RegExp>();
  for (const chunk of chunks.values()) {
    const facade = chunk.facadeModuleId?.replaceAll("\\", "/") ?? "";
    const rootsHere = roots.filter((root) => root.test(facade));
    for (const root of rootsHere) {
      matched.add(root);
    }
    if (rootsHere.length > 0 || (roots.length === 0 && chunk.isEntry)) {
      visit(chunk);
    }
  }
  // A root that names nothing would measure nothing and pass every check.
  const unmatched = roots.filter((root) => !matched.has(root));
  if (unmatched.length > 0) {
    throw new Error(
      `No chunk starts at ${unmatched.join(", ")}; update the startup roots in electron.vite.config.ts`,
    );
  }
  return {
    bytes,
    externals: [...externals].toSorted(),
    files: [...files].toSorted(),
    packages: Object.fromEntries(
      Object.entries(packages).toSorted(([, a], [, b]) => b - a),
    ),
  };
}

/**
 * A Vite plugin that writes the startup manifest for the build named
 * `name`. `roots` names the modules whose chunks start the startup path;
 * without it, every entry chunk does.
 */
export function recordStartupBundle(
  name: BundleName,
  { roots }: { roots?: RegExp[] } = {},
): Plugin {
  return {
    apply: "build",
    generateBundle(_options, bundle) {
      this.emitFile({
        fileName: `${name}${MANIFEST_SUFFIX}`,
        source: `${JSON.stringify(measureStartup(bundle, roots), null, 2)}\n`,
        type: "asset",
      });
    },
    name: "record-startup-bundle",
  };
}

/** The startup manifest a build wrote, or `undefined` when it wrote none. */
export function readStartupBundle(name: BundleName, outDir: string) {
  const file = path.join(outDir, BUNDLES[name], `${name}${MANIFEST_SUFFIX}`);
  if (!existsSync(file)) {
    return undefined;
  }
  return JSON.parse(readFileSync(file, "utf8")) as StartupBundle; // Written by recordStartupBundle above.
}
