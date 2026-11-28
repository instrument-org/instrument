import { deflateRawSync } from "node:zlib";
import { expect, it } from "vitest";

import { ZipPackage } from "./zip";

/** A one-part package whose directory says the part inflates to `claimed` bytes. */
function packageOf(part: Buffer, claimed: number): Buffer {
  const name = Buffer.from("xl/sheet1.xml");
  const data = deflateRawSync(part);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(claimed, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(claimed, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

it("reads a part that inflates to the size its directory says", () => {
  const part = Buffer.from("<sheet/>".repeat(100));
  expect(
    ZipPackage.read(packageOf(part, part.length)).text("xl/sheet1.xml"),
  ).toBe(part.toString());
});

it("stops a part that inflates past the size its directory says", () => {
  const part = Buffer.alloc(1024 * 1024);
  expect(() =>
    ZipPackage.read(packageOf(part, 1024)).get("xl/sheet1.xml"),
  ).toThrow();
});

it("refuses a part whose directory says it inflates past what is read", () => {
  expect(() =>
    ZipPackage.read(packageOf(Buffer.from("x"), 0xfffffff0)).get(
      "xl/sheet1.xml",
    ),
  ).toThrow("too large");
});
