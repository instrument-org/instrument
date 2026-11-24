import { Arch } from "electron-builder";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { pruneForeignBinaries } from "./prune-foreign-binaries";

const PNPM_REFLINK_PACKAGES = [
  "reflink-darwin-x64",
  "reflink-darwin-arm64",
  "reflink-win32-x64-msvc",
  "reflink-win32-arm64-msvc",
];

function makeUnpackedFixture() {
  const unpackedDir = mkdtempSync(path.join(tmpdir(), "prune-unpacked-"));

  const reflinkDir = path.join(
    unpackedDir,
    "node_modules",
    "pnpm",
    "dist",
    "node_modules",
    "@reflink",
  );
  for (const pkg of PNPM_REFLINK_PACKAGES) {
    mkdirSync(path.join(reflinkDir, pkg), { recursive: true });
    writeFileSync(
      path.join(reflinkDir, pkg, `${pkg.replace("reflink-", "reflink.")}.node`),
      "binary",
    );
  }

  return { reflinkDir, unpackedDir };
}

describe("pruneForeignBinaries", () => {
  it("keeps only the win32-x64 reflink package on a win32-x64 build", () => {
    const { reflinkDir, unpackedDir } = makeUnpackedFixture();

    pruneForeignBinaries({
      arch: Arch.x64,
      platformName: "win32",
      unpackedDir,
    });

    expect(readdirSync(reflinkDir).sort()).toMatchInlineSnapshot(`
      [
        "reflink-win32-x64-msvc",
      ]
    `);
  });

  it("keeps the win32-arm64 reflink package on a win32-arm64 build", () => {
    const { reflinkDir, unpackedDir } = makeUnpackedFixture();

    pruneForeignBinaries({
      arch: Arch.arm64,
      platformName: "win32",
      unpackedDir,
    });

    expect(readdirSync(reflinkDir).sort()).toMatchInlineSnapshot(`
      [
        "reflink-win32-arm64-msvc",
      ]
    `);
  });

  it("returns the list of removed package names", () => {
    const { unpackedDir } = makeUnpackedFixture();

    const removed = pruneForeignBinaries({
      arch: Arch.x64,
      platformName: "win32",
      unpackedDir,
    }).sort();

    expect(removed).toMatchInlineSnapshot(`
      [
        "reflink-darwin-arm64",
        "reflink-darwin-x64",
        "reflink-win32-arm64-msvc",
      ]
    `);
  });
});
