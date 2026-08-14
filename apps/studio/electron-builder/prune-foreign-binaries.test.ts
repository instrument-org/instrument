import { Arch } from "electron-builder";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { pruneForeignBinaries } from "./prune-foreign-binaries";

const AGENT_BROWSER_BINARIES = [
  "agent-browser-win32-x64.exe",
  "agent-browser-linux-x64",
  "agent-browser-linux-musl-x64",
  "agent-browser-linux-arm64",
  "agent-browser-linux-musl-arm64",
  "agent-browser-darwin-x64",
  "agent-browser-darwin-arm64",
  "agent-browser.js",
];

const PNPM_REFLINK_PACKAGES = [
  "reflink-darwin-x64",
  "reflink-darwin-arm64",
  "reflink-win32-x64-msvc",
  "reflink-win32-arm64-msvc",
];

function makeUnpackedFixture() {
  const unpackedDir = mkdtempSync(path.join(tmpdir(), "prune-unpacked-"));

  const agentBrowserBin = path.join(
    unpackedDir,
    "node_modules",
    "agent-browser",
    "bin",
  );
  mkdirSync(agentBrowserBin, { recursive: true });
  for (const name of AGENT_BROWSER_BINARIES) {
    writeFileSync(path.join(agentBrowserBin, name), "binary");
  }

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

  return {
    agentBrowserBin,
    reflinkDir,
    unpackedDir,
  };
}

describe("pruneForeignBinaries", () => {
  it("keeps only the win32-x64 agent-browser and reflink binaries", () => {
    const { agentBrowserBin, reflinkDir, unpackedDir } = makeUnpackedFixture();

    pruneForeignBinaries({
      arch: Arch.x64,
      platformName: "win32",
      unpackedDir,
    });

    expect(readdirSync(agentBrowserBin).sort()).toMatchInlineSnapshot(`
      [
        "agent-browser-win32-x64.exe",
        "agent-browser.js",
      ]
    `);
    expect(readdirSync(reflinkDir).sort()).toMatchInlineSnapshot(`
      [
        "reflink-win32-x64-msvc",
      ]
    `);
  });

  it("keeps win32-x64 agent-browser for a win32-arm64 build", () => {
    const { agentBrowserBin, reflinkDir, unpackedDir } = makeUnpackedFixture();

    pruneForeignBinaries({
      arch: Arch.arm64,
      platformName: "win32",
      unpackedDir,
    });

    expect(readdirSync(agentBrowserBin).sort()).toMatchInlineSnapshot(`
      [
        "agent-browser-win32-x64.exe",
        "agent-browser.js",
      ]
    `);
    expect(readdirSync(reflinkDir).sort()).toMatchInlineSnapshot(`
      [
        "reflink-win32-arm64-msvc",
      ]
    `);
  });

  it("keeps both linux glibc and musl agent-browser binaries for the arch", () => {
    const { agentBrowserBin, unpackedDir } = makeUnpackedFixture();

    pruneForeignBinaries({
      arch: Arch.arm64,
      platformName: "linux",
      unpackedDir,
    });

    expect(readdirSync(agentBrowserBin).sort()).toMatchInlineSnapshot(`
        [
          "agent-browser-linux-arm64",
          "agent-browser-linux-musl-arm64",
          "agent-browser.js",
        ]
      `);
  });

  it("keeps the darwin-x64 binary on an x64 mac build", () => {
    const { agentBrowserBin, unpackedDir } = makeUnpackedFixture();

    pruneForeignBinaries({
      arch: Arch.x64,
      platformName: "darwin",
      unpackedDir,
    });

    expect(readdirSync(agentBrowserBin).sort()).toMatchInlineSnapshot(`
      [
        "agent-browser-darwin-x64",
        "agent-browser.js",
      ]
    `);
  });

  it("returns the list of removed file names", () => {
    const { unpackedDir } = makeUnpackedFixture();

    const removed = pruneForeignBinaries({
      arch: Arch.x64,
      platformName: "win32",
      unpackedDir,
    }).sort();

    expect(removed).toMatchInlineSnapshot(`
      [
        "agent-browser-darwin-arm64",
        "agent-browser-darwin-x64",
        "agent-browser-linux-arm64",
        "agent-browser-linux-musl-arm64",
        "agent-browser-linux-musl-x64",
        "agent-browser-linux-x64",
        "reflink-darwin-arm64",
        "reflink-darwin-x64",
        "reflink-win32-arm64-msvc",
      ]
    `);
  });
});
