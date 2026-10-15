import { createPackage } from "@electron/asar";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  collectPackages,
  indexPnpmStore,
  listAsarPackages,
  packagesToReview,
  readPackageNotice,
  renderThirdPartyNotices,
  writeThirdPartyNotices,
} from "./third-party-notices";

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), "third-party-notices-"));
}

function writeFiles(root: string, files: Record<string, string>) {
  for (const [relative, body] of Object.entries(files)) {
    const file = path.join(root, ...relative.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return root;
}

function manifest(fields: Record<string, unknown>) {
  return JSON.stringify(fields);
}

describe("readPackageNotice", () => {
  it("reads the declared license and every license, copying and notice file", () => {
    const dir = writeFiles(tempDir(), {
      "LICENSE-MIT": "mit text\r\n",
      "NOTICE.md": "notice text",
      "license.js": "module.exports = 1",
      "package.json": manifest({ license: "MIT OR Apache-2.0" }),
      "src/LICENSE": "nested, not read",
    });

    expect(readPackageNotice({ dir, name: "pkg", version: "1.0.0" }))
      .toMatchInlineSnapshot(`
      {
        "license": "MIT OR Apache-2.0",
        "name": "pkg",
        "texts": [
          "mit text",
          "notice text",
        ],
        "version": "1.0.0",
      }
    `);
  });

  it.each([
    [{ license: { type: "ISC" } }, "ISC"],
    [{ licenses: [{ type: "MIT" }, { type: "GPL-2.0" }] }, "MIT OR GPL-2.0"],
    [{ licenses: { type: "BSD" } }, "BSD"],
    [{}, "UNKNOWN"],
  ])("reads the legacy license field %j as %s", (fields, expected) => {
    const dir = writeFiles(tempDir(), { "package.json": manifest(fields) });
    expect(
      readPackageNotice({ dir, name: "pkg", version: "1.0.0" }).license,
    ).toBe(expected);
  });

  it("keeps a package with no folder, with no texts", () => {
    expect(
      readPackageNotice({ dir: undefined, name: "gone", version: "2.0.0" }),
    ).toEqual({
      license: "UNKNOWN",
      name: "gone",
      texts: [],
      version: "2.0.0",
    });
  });
});

describe("indexPnpmStore", () => {
  it("indexes each entry's own folder and skips the links to its dependencies", () => {
    const store = tempDir();
    writeFiles(store, {
      "@scope+b@2.0.0/node_modules/@scope/b/package.json": manifest({
        name: "@scope/b",
        version: "2.0.0",
      }),
      "a@1.0.0_peer@3.0.0/node_modules/a/package.json": manifest({
        name: "a",
        version: "1.0.0",
      }),
      "lock.yaml": "",
    });
    symlinkSync(
      path.join(store, "@scope+b@2.0.0/node_modules/@scope/b"),
      path.join(store, "a@1.0.0_peer@3.0.0/node_modules/b-link"),
    );

    const index = indexPnpmStore(store);

    expect(Object.fromEntries(index)).toEqual({
      "@scope/b@2.0.0": path.join(
        store,
        "@scope+b@2.0.0/node_modules/@scope/b",
      ),
      "a@1.0.0": path.join(store, "a@1.0.0_peer@3.0.0/node_modules/a"),
    });
  });
});

describe("collectPackages", () => {
  it("joins bundled and archived packages once each, without the repo's own", () => {
    const refs = collectPackages({
      asarPackages: [
        { name: "zod", version: "4.0.0" },
        { name: "react", version: "19.0.0" },
        { name: "@instrument-org/shared", version: "0.0.0" },
        { name: "missing", version: "1.0.0" },
      ],
      bundled: [{ dir: "/bundled/react", name: "react", version: "19.0.0" }],
      store: new Map([["zod@4.0.0", "/store/zod"]]),
    });

    expect(refs).toEqual([
      { dir: undefined, name: "missing", version: "1.0.0" },
      { dir: "/bundled/react", name: "react", version: "19.0.0" },
      { dir: "/store/zod", name: "zod", version: "4.0.0" },
    ]);
  });
});

describe("renderThirdPartyNotices", () => {
  it("indexes every package and prints a shared text once", () => {
    expect(
      renderThirdPartyNotices([
        { license: "MIT", name: "a", texts: ["MIT text"], version: "1.0.0" },
        {
          license: "Apache-2.0",
          name: "long-name",
          texts: ["Apache text", "NOTICE text"],
          version: "2.0.0",
        },
        { license: "MIT", name: "b", texts: ["MIT text"], version: "3.0.0" },
        { license: "MIT", name: "c", texts: [], version: "4.0.0" },
      ]),
    ).toMatchInlineSnapshot(`
      "Third-party notices for Instrument

      Instrument includes the open source JavaScript packages below. Each is
      listed with its version and declared license, and the license texts the
      packages ship follow the list. A text several packages share is printed
      once, under the names of every package that ships it.

      Packages (4)

        a 1.0.0          MIT
        long-name 2.0.0  Apache-2.0
        b 3.0.0          MIT
        c 4.0.0          MIT (the package ships no license text)

      ========================================================================
      a 1.0.0
      b 3.0.0
      ------------------------------------------------------------------------
      MIT text

      ========================================================================
      long-name 2.0.0
      ------------------------------------------------------------------------
      Apache text

      ========================================================================
      long-name 2.0.0
      ------------------------------------------------------------------------
      NOTICE text
      "
    `);
  });
});

describe("packagesToReview", () => {
  it("flags copyleft, unknown and textless packages", () => {
    const notice = (name: string, license: string, texts = ["text"]) => ({
      license,
      name,
      texts,
      version: "1.0.0",
    });
    expect(
      packagesToReview([
        notice("mit", "MIT"),
        notice("gpl", "GPL-3.0-or-later"),
        notice("lgpl", "LGPL-2.1"),
        notice("mpl", "(MPL-2.0 OR Apache-2.0)"),
        notice("unknown", "UNKNOWN"),
        notice("see", "SEE LICENSE IN README.md"),
        notice("textless", "MIT", []),
      ]).map((entry) => entry.name),
    ).toEqual(["gpl", "lgpl", "mpl", "unknown", "see", "textless"]);
  });
});

describe("writeThirdPartyNotices", () => {
  it("lists what the archive and the bundles carry, with texts from the store", async () => {
    const app = writeFiles(tempDir(), {
      "node_modules/dep/node_modules/nested/package.json": manifest({
        name: "nested",
        version: "2.0.0",
      }),
      "node_modules/dep/package.json": manifest({
        name: "dep",
        version: "1.0.0",
      }),
      "node_modules/dep/sub/package.json": manifest({ type: "module" }),
      "out/main/index.js": "",
    });
    const asarPath = path.join(tempDir(), "app.asar");
    await createPackage(app, asarPath);

    const dep = writeFiles(tempDir(), {
      "LICENSE.md": "dep license",
      "package.json": manifest({ license: "MIT" }),
    });
    const nested = writeFiles(tempDir(), {
      "package.json": manifest({ license: "ISC" }),
    });
    const bundled = writeFiles(tempDir(), {
      LICENSE: "bundled license",
      "package.json": manifest({ license: "BSD-3-Clause" }),
    });
    const outDir = tempDir();

    expect(
      listAsarPackages(asarPath).toSorted((a, b) =>
        a.name.localeCompare(b.name),
      ),
    ).toEqual([
      { name: "dep", version: "1.0.0" },
      { name: "nested", version: "2.0.0" },
    ]);

    const { file, notices, review } = writeThirdPartyNotices({
      asarPath,
      bundled: [{ dir: bundled, name: "bundled", version: "3.0.0" }],
      outDir,
      store: new Map([
        ["dep@1.0.0", dep],
        ["nested@2.0.0", nested],
      ]),
    });

    expect(notices.map((notice) => notice.name)).toEqual([
      "bundled",
      "dep",
      "nested",
    ]);
    expect(review.map((notice) => notice.name)).toEqual(["nested"]);
    expect(readFileSync(file, "utf8")).toContain("dep license");
  });
});
