import { beforeAll, describe, expect, it } from "vitest";

// Node has no DOMParser, as react-xlsx's worker has none, so importing the
// module installs it here the way it does there.
beforeAll(async () => {
  expect(typeof globalThis.DOMParser).toBe("undefined");
  await import("./xlsx-worker-dom");
});

const SHEET = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><conditionalFormatting sqref="A1:A8"><cfRule type="dataBar" priority="1"/></conditionalFormatting></worksheet>`;

describe("the worker's DOMParser", () => {
  it("parses workbook XML the way the worker reads it", () => {
    const document = new DOMParser().parseFromString(SHEET, "application/xml");
    const elements = Array.from(document.getElementsByTagName("*"));
    const rule = elements.find((node) => node.localName === "cfRule");

    expect(document.querySelector("parsererror")).toBeNull();
    expect(elements.map((node) => node.localName)).toEqual([
      "worksheet",
      "conditionalFormatting",
      "cfRule",
    ]);
    expect(rule?.nodeType).toBe(Node.ELEMENT_NODE);
    expect(rule?.getAttribute("type")).toBe("dataBar");
    expect(elements[1]?.namespaceURI).toBe(
      "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    );
  });

  it("answers malformed XML with a parsererror document, as a browser does", () => {
    const document = new DOMParser().parseFromString(
      "<worksheet><sheetData></worksheet>",
      "application/xml",
    );

    expect(document.querySelector("parsererror")).not.toBeNull();
  });
});
