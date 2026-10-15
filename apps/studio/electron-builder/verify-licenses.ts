// Guards against shipping a native program or WebAssembly module without its
// license: every such file in `app.asar.unpacked` has to fall under a
// component in third-party-licenses.ts. Run from the afterPack hook, so a newly
// bundled binary fails packaging until it has an entry. The same hook checks
// that the JavaScript packages' notices file was written and lists packages.
//
// Files are recognized by their first bytes rather than their names or modes,
// so a Windows build made on macOS is checked the same way as one made on
// Windows.

import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
} from "node:fs";
import path from "node:path";

import type { ThirdPartyComponent } from "./third-party-licenses";

const MAGIC_NUMBERS = [
  // Mach-O, 64-bit and 32-bit, and universal (fat) binaries.
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xce, 0xfa, 0xed, 0xfe],
  [0xca, 0xfe, 0xba, 0xbe],
  // ELF.
  [0x7f, 0x45, 0x4c, 0x46],
  // WebAssembly: "\0asm".
  [0x00, 0x61, 0x73, 0x6d],
];

// A Windows executable or DLL starts "MZ" and names, at 0x3C, the offset of
// its "PE\0\0" signature. Checking both keeps a text file that happens to
// start with "MZ" from counting.
const PE_SIGNATURE = Buffer.from("PE\0\0", "latin1");

function isNativeOrWasm(file: string) {
  const fd = openSync(file, "r");
  try {
    const header = Buffer.alloc(64);
    const read = readSync(fd, header, 0, header.length, 0);
    if (
      MAGIC_NUMBERS.some((magic) =>
        magic.every((byte, i) => header[i] === byte),
      )
    ) {
      return true;
    }
    if (read < header.length || header.toString("latin1", 0, 2) !== "MZ") {
      return false;
    }
    const signature = Buffer.alloc(PE_SIGNATURE.length);
    readSync(fd, signature, 0, signature.length, header.readUInt32LE(0x3c));
    return signature.equals(PE_SIGNATURE);
  } finally {
    closeSync(fd);
  }
}

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/**
 * The native programs and WebAssembly modules under `unpackedDir` that no
 * component's `ships` covers, as paths relative to it with forward slashes.
 */
export function findUnlicensedBinaries({
  components,
  unpackedDir,
}: {
  components: Pick<ThirdPartyComponent, "ships">[];
  unpackedDir: string;
}) {
  const prefixes = components.flatMap((component) => component.ships);
  const unlicensed: string[] = [];
  for (const file of walkFiles(unpackedDir)) {
    const relative = path.relative(unpackedDir, file).split(path.sep).join("/");
    if (prefixes.some((prefix) => relative.startsWith(prefix))) {
      continue;
    }
    if (isNativeOrWasm(file)) {
      unlicensed.push(relative);
    }
  }
  return unlicensed.toSorted();
}

/**
 * Throws unless the notices file at `file` exists and lists at least one
 * package, so a packaging change that leaves it out or writes it empty fails
 * the build rather than shipping without it.
 */
export function verifyThirdPartyNotices(file: string) {
  if (!existsSync(file)) {
    throw new Error(`The third-party notices file is missing at ${file}.`);
  }
  const listed = /^Packages \((\d+)\)$/m.exec(readFileSync(file, "utf8"));
  if (!listed || Number(listed[1]) === 0) {
    throw new Error(
      `The third-party notices file at ${file} lists no packages.`,
    );
  }
}
