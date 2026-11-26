import { describe, expect, it } from "vitest";

import { parseOptions } from "./parse-options";

const TABLE = `| Insurer | Premium |
|---|---|
| Harbor Mutual | $1,842 |
| Pinecrest | $1,930 |`;

describe("parseOptions", () => {
  it("finds the pick by name, any case", () => {
    expect(parseOptions(TABLE, { pick: "pinecrest" })?.pick).toBe(1);
  });

  it("finds the pick by the one name that holds it", () => {
    expect(
      parseOptions(TABLE.replace("Pinecrest", "[Pinecrest Mutual](x.pdf)"), {
        pick: "Pinecrest",
      })?.pick,
    ).toBe(1);
  });

  it("marks options named by pictures", () => {
    expect(
      parseOptions(
        "| Photo | Light |\n|---|---|\n| ![Window](a.jpg) | Soft |\n| ![Table](b.jpg) | Warm |",
        { pick: "Table" },
      ),
    ).toMatchObject({ isPictures: true, pick: 1 });
  });

  it("reads no options without a table", () => {
    expect(parseOptions("- Harbor\n- Pinecrest", {})).toBeUndefined();
  });
});
