import { describe, expect, it } from "vitest";

import { parseFilesBlock } from "./parse-files-block";

describe("parseFilesBlock", () => {
  it("reads one path per line", () => {
    expect(parseFilesBlock("output/report.pdf\n/mnt/Photos/cat.png\n"))
      .toMatchInlineSnapshot(`
      [
        "output/report.pdf",
        "/mnt/Photos/cat.png",
      ]
    `);
  });

  it("keeps spaces in a name and preserves the order given", () => {
    expect(parseFilesBlock("output/Q3 summary.pdf\noutput/a.png"))
      .toMatchInlineSnapshot(`
        [
          "output/Q3 summary.pdf",
          "output/a.png",
        ]
      `);
  });

  it.each([
    ["blank lines", "\n\noutput/a.png\n\n"],
    ["a bullet", "- output/a.png"],
    ["a numbered marker", "1. output/a.png"],
    ["backticks", "`output/a.png`"],
    ["angle brackets", "<output/a.png>"],
    ["quotes", '"output/a.png"'],
    ["a Markdown link", "[the chart](output/a.png)"],
    ["a bulleted Markdown link", "- [the chart](`output/a.png`)"],
    ["the agent-facing ./ prefix", "./output/a.png"],
  ])("tolerates %s", (_label, content) => {
    expect(parseFilesBlock(content)).toEqual(["output/a.png"]);
  });

  it("drops a repeated path", () => {
    expect(parseFilesBlock("output/a.png\noutput/a.png"))
      .toMatchInlineSnapshot(`
      [
        "output/a.png",
      ]
    `);
  });

  it("keeps prose lines, which fail to resolve rather than parse", () => {
    expect(parseFilesBlock("Here are your files:\noutput/a.png"))
      .toMatchInlineSnapshot(`
        [
          "Here are your files:",
          "output/a.png",
        ]
      `);
  });
});
