import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  THIRD_PARTY_COMPONENTS,
  type ThirdPartyComponent,
  writeThirdPartyLicenses,
} from "./third-party-licenses";

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), "third-party-licenses-"));
}

function writeFiles(root: string, files: Record<string, string>) {
  for (const [relative, body] of Object.entries(files)) {
    const file = path.join(root, ...relative.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
}

/** A package folder and a checked-in folder for one GPL-style component. */
function fixture() {
  const packageDir = tempDir();
  writeFiles(packageDir, {
    LICENSE: "wrapper license",
    "THIRD_PARTY/ISC.txt": "isc",
    "package.json": JSON.stringify({ version: "1.2.3" }),
  });
  const checkedInDir = tempDir();
  writeFiles(checkedInDir, { "tool/COPYING": "gpl text" });
  const component: ThirdPartyComponent = {
    checkedIn: ["COPYING"],
    files: [{ from: "LICENSE", to: "LICENSE.wrapper" }, "THIRD_PARTY"],
    id: "tool",
    license: (platform) =>
      platform === "darwin" ? "GPL-2.0-or-later" : "GPL-3.0-or-later",
    name: "Tool",
    origin: { dir: packageDir },
    pin: { installed: () => "1.2.3", version: "1.2.3" },
    ships: ["node_modules/tool/"],
    source: () => ["Source: https://example.com/tool/tree/v1.2.3"],
    version: () => "1.2.3",
  };
  return { checkedInDir, component, packageDir };
}

describe("writeThirdPartyLicenses", () => {
  it("copies each component's texts into its folder and indexes them", () => {
    const { checkedInDir, component } = fixture();
    const outDir = path.join(tempDir(), "licenses");

    writeThirdPartyLicenses({
      checkedInDir,
      components: [component],
      outDir,
      platformName: "darwin",
    });

    expect(readdirSync(path.join(outDir, "tool")).toSorted()).toEqual([
      "COPYING",
      "LICENSE.wrapper",
      "THIRD_PARTY",
    ]);
    expect(
      readFileSync(path.join(outDir, "tool", "THIRD_PARTY", "ISC.txt"), "utf8"),
    ).toBe("isc");
    expect(readFileSync(path.join(outDir, "README.txt"), "utf8"))
      .toMatchInlineSnapshot(`
      "Third-party software in Instrument

      Instrument includes the programs below, each under its own license. The
      folder named under each one holds its license texts.
      THIRD_PARTY_NOTICES.txt lists the open source JavaScript packages
      Instrument includes, with their licenses. Electron and Chromium's notices
      ship with the app as LICENSE.electron.txt and LICENSES.chromium.html.

      ------------------------------------------------------------------------
      Tool
      Version:  1.2.3
      License:  GPL-2.0-or-later
      Texts:    tool/
      Source:
        Source: https://example.com/tool/tree/v1.2.3
      "
    `);
  });

  it("replaces a folder left by an earlier run", () => {
    const { checkedInDir, component } = fixture();
    const outDir = path.join(tempDir(), "licenses");
    writeFiles(outDir, { "stale/LICENSE": "old" });

    writeThirdPartyLicenses({
      checkedInDir,
      components: [component],
      outDir,
      platformName: "linux",
    });

    expect(existsSync(path.join(outDir, "stale"))).toBe(false);
  });

  it("fails when the installed version moved past the checked-in texts", () => {
    const { checkedInDir, component } = fixture();

    expect(() =>
      writeThirdPartyLicenses({
        checkedInDir,
        components: [
          { ...component, pin: { installed: () => "1.3.0", version: "1.2.3" } },
        ],
        outDir: path.join(tempDir(), "licenses"),
        platformName: "darwin",
      }),
    ).toThrow(/Tool is 1\.3\.0, but the texts in licenses\/tool\//);
  });

  it("leaves out a component that ships on other platforms", () => {
    const { checkedInDir, component } = fixture();
    const outDir = path.join(tempDir(), "licenses");

    const entries = writeThirdPartyLicenses({
      checkedInDir,
      components: [
        component,
        { ...component, id: "windows-only", platforms: ["win32"] },
      ],
      outDir,
      platformName: "darwin",
    });

    expect(entries.map(({ folder }) => folder)).toEqual(["tool"]);
    expect(existsSync(path.join(outDir, "windows-only"))).toBe(false);
  });

  it("fails when a license file is missing", () => {
    const { checkedInDir, component } = fixture();

    expect(() =>
      writeThirdPartyLicenses({
        checkedInDir,
        components: [{ ...component, files: ["NOTICE"] }],
        outDir: path.join(tempDir(), "licenses"),
        platformName: "darwin",
      }),
    ).toThrow(/License file not found at .*NOTICE/);
  });

  // uv's texts are written by scripts/download-uv.ts, which a checkout that
  // installed before it did so has not rerun; packaging reruns it.
  it("finds every installed package's texts, at the pinned versions", () => {
    const outDir = path.join(tempDir(), "licenses");
    const entries = writeThirdPartyLicenses({
      components: THIRD_PARTY_COMPONENTS.filter(
        (component) => !("dir" in component.origin),
      ),
      outDir,
      platformName: "darwin",
    });

    expect(entries.map(({ folder, license }) => `${folder}: ${license}`))
      .toMatchInlineSnapshot(`
        [
          "ffmpeg: GPL-2.0-or-later",
          "git: GPL-2.0-only",
          "ripgrep: MIT OR Unlicense",
          "pnpm: MIT",
          "agent-browser: Apache-2.0",
          "pdfium: MIT AND BSD-3-Clause",
          "react-docx: MIT",
          "react-pptx: MIT",
          "react-xlsx: MIT",
          "sqlite: blessing",
          "velopack: MIT",
          "tailwindcss-browser: MIT",
        ]
      `);
  });
});
