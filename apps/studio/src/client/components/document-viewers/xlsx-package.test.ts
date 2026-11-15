import {
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import { relativeTargets, withRelativeTargets } from "./xlsx-package";

describe("relativeTargets", () => {
  it.each([
    [
      "xl/worksheets/_rels/sheet1.xml.rels",
      "/xl/drawings/drawing1.xml",
      "../drawings/drawing1.xml",
    ],
    [
      "xl/_rels/workbook.xml.rels",
      "/xl/worksheets/sheet1.xml",
      "worksheets/sheet1.xml",
    ],
    ["_rels/.rels", "/xl/workbook.xml", "xl/workbook.xml"],
    [
      "xl/drawings/_rels/drawing1.xml.rels",
      "/xl/charts/chart1.xml",
      "../charts/chart1.xml",
    ],
  ])("rewrites a target in %s", (rels, target, expected) => {
    const xml = `<Relationships><Relationship Id="rId1" Target="${target}" Type="t"/></Relationships>`;
    expect(relativeTargets(rels, xml)).toBe(
      `<Relationships><Relationship Id="rId1" Target="${expected}" Type="t"/></Relationships>`,
    );
  });

  it("leaves relative and external targets alone, whichever attribute comes first", () => {
    const xml =
      '<Relationship Id="a" Target="../media/image1.png"/><Relationship Id="b" TargetMode="External" Target="/Users/someone/book.xlsx"/><Relationship Id="c" Target="/Users/someone/other.xlsx" TargetMode="External"/>';
    expect(relativeTargets("xl/drawings/_rels/drawing1.xml.rels", xml)).toBe(
      xml,
    );
  });
});

describe("withRelativeTargets", () => {
  const zip = async (parts: Record<string, string>) => {
    const writer = new ZipWriter(new Uint8ArrayWriter());
    for (const [name, text] of Object.entries(parts)) {
      await writer.add(name, new TextReader(text));
    }
    return writer.close();
  };
  const unzip = async (bytes: Uint8Array) => {
    const reader = new ZipReader(new Uint8ArrayReader(bytes));
    const parts: Record<string, string> = {};
    for (const entry of await reader.getEntries()) {
      if (!entry.directory) {
        parts[entry.filename] = await entry.getData(new TextWriter());
      }
    }
    await reader.close();
    return parts;
  };

  it("hands back a workbook with only relative targets untouched", async () => {
    const bytes = await zip({
      "xl/_rels/workbook.xml.rels":
        '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>',
      "xl/worksheets/sheet1.xml": "<worksheet/>",
    });
    expect(await withRelativeTargets(bytes)).toBe(bytes);
  });

  it("rewrites absolute targets and keeps every other part", async () => {
    const bytes = await zip({
      "xl/drawings/drawing1.xml": "<drawing/>",
      "xl/worksheets/_rels/sheet1.xml.rels":
        '<Relationship Id="rId1" Target="/xl/drawings/drawing1.xml"/>',
      "xl/worksheets/sheet1.xml": "<worksheet/>",
    });
    expect(await unzip(await withRelativeTargets(bytes))).toEqual({
      "xl/drawings/drawing1.xml": "<drawing/>",
      "xl/worksheets/_rels/sheet1.xml.rels":
        '<Relationship Id="rId1" Target="../drawings/drawing1.xml"/>',
      "xl/worksheets/sheet1.xml": "<worksheet/>",
    });
  });
});
