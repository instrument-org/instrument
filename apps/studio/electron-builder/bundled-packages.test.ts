import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  BUNDLES,
  packageDirOfModule,
  readBundledPackages,
} from "./bundled-packages";

describe("packageDirOfModule", () => {
  it.each([
    [
      "/repo/node_modules/.pnpm/react@19.2.1/node_modules/react/cjs/react.js",
      "/repo/node_modules/.pnpm/react@19.2.1/node_modules/react",
    ],
    [
      "/repo/node_modules/.pnpm/@scope+pkg@1.0.0/node_modules/@scope/pkg/dist/index.js?commonjs-es-import",
      "/repo/node_modules/.pnpm/@scope+pkg@1.0.0/node_modules/@scope/pkg",
    ],
    [
      "\0/repo/node_modules/a/node_modules/b/index.js?commonjs-proxy",
      "/repo/node_modules/a/node_modules/b",
    ],
    [
      String.raw`C:\repo\node_modules\katex\dist\katex.css`,
      "C:/repo/node_modules/katex",
    ],
    ["/repo/packages/shared/src/index.ts", undefined],
    ["\0vite/preload-helper.js", undefined],
    ["/repo/node_modules/.pnpm/lock.yaml", undefined],
  ])("%s belongs to %s", (id, expected) => {
    expect(packageDirOfModule(id)).toBe(expected);
  });
});

describe("readBundledPackages", () => {
  function writeManifests(skip?: string) {
    const outDir = mkdtempSync(path.join(tmpdir(), "bundled-packages-"));
    for (const [name, folder] of Object.entries(BUNDLES)) {
      if (name === skip) {
        continue;
      }
      mkdirSync(path.join(outDir, folder), { recursive: true });
      writeFileSync(
        path.join(outDir, folder, `${name}.bundled-packages.json`),
        JSON.stringify(
          name === "main"
            ? [
                {
                  dir: "../../node_modules/react",
                  name: "react",
                  version: "1.0.0",
                },
              ]
            : [],
        ),
      );
    }
    return outDir;
  }

  it("resolves each package's folder against its manifest's folder", () => {
    const outDir = writeManifests();
    expect(readBundledPackages({ outDir })).toEqual([
      {
        dir: path.resolve(outDir, "main", "../../node_modules/react"),
        name: "react",
        version: "1.0.0",
      },
    ]);
  });

  it("throws when a build left no manifest", () => {
    const outDir = writeManifests("renderer");
    expect(() => readBundledPackages({ outDir })).toThrow(
      /recordBundledPackages\("renderer"\)/,
    );
  });
});
