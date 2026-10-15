import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { findUnlicensedBinaries } from "./verify-licenses";

const HEADERS = {
  elf: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02]),
  macho: Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c]),
  pe: portableExecutable(),
  wasm: Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01]),
};

/** "MZ", the PE header's offset at 0x3C, and "PE\0\0" there. */
function portableExecutable() {
  const body = Buffer.alloc(0x84);
  body.write("MZ", 0, "latin1");
  body.writeUInt32LE(0x80, 0x3c);
  body.write("PE\0\0", 0x80, "latin1");
  return body;
}

function writeTree(files: Record<string, Buffer | string>) {
  const root = mkdtempSync(path.join(tmpdir(), "verify-licenses-"));
  for (const [relative, body] of Object.entries(files)) {
    const file = path.join(root, ...relative.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return root;
}

describe("findUnlicensedBinaries", () => {
  it("names each native program and wasm module no component covers", () => {
    const unpackedDir = writeTree({
      "node_modules/covered/bin/tool": HEADERS.elf,
      "node_modules/covered/bin/tool.exe": HEADERS.pe,
      "node_modules/new-addon/build/addon.node": HEADERS.macho,
      "node_modules/new-addon/index.js": "module.exports = {};",
      "resources/vendor/known.wasm": HEADERS.wasm,
      "resources/vendor/new.wasm": HEADERS.wasm,
      "resources/icon.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });

    expect(
      findUnlicensedBinaries({
        components: [
          { ships: ["node_modules/covered/"] },
          { ships: ["resources/vendor/known.wasm"] },
        ],
        unpackedDir,
      }),
    ).toMatchInlineSnapshot(`
      [
        "node_modules/new-addon/build/addon.node",
        "resources/vendor/new.wasm",
      ]
    `);
  });

  it("passes a tree whose every binary is covered", () => {
    const unpackedDir = writeTree({
      "node_modules/covered/bin/tool": HEADERS.elf,
      "resources/readme.txt": `MZ is how this line happens to start, and it runs on long enough to fill a header.`,
      "resources/vendor/stub.exe": "MZ",
    });

    expect(
      findUnlicensedBinaries({
        components: [{ ships: ["node_modules/covered/"] }],
        unpackedDir,
      }),
    ).toEqual([]);
  });
});
