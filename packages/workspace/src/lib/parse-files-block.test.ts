import { describe, expect, it } from "vitest";

import { filesNamedIn, parseFilesBlock } from "./parse-files-block";

describe("parseFilesBlock", () => {
  it("reads one path per line", () => {
    expect(parseFilesBlock("output/report.pdf\n/Users/sam/Photos/cat.png\n"))
      .toMatchInlineSnapshot(`
      [
        "output/report.pdf",
        "/Users/sam/Photos/cat.png",
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

  // The slash is the whole of what says folder, so it survives the wrappers
  // and markers a path picks up on its way through Markdown.
  it("keeps the trailing slash that names a folder", () => {
    expect(parseFilesBlock("- `/Users/sam/Photos/holiday/`\noutput/a.png"))
      .toMatchInlineSnapshot(`
        [
          "/Users/sam/Photos/holiday/",
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

describe("filesNamedIn", () => {
  it("reads every fence in a text, each path once", () => {
    const text = [
      "Done.",
      "```files",
      "/Users/sam/Instrument/report.md",
      "work/build.mjs",
      "```",
      "And the chart:",
      "```files",
      "/Users/sam/Instrument/report.md",
      "/Users/sam/Instrument/chart.png",
      "```",
    ].join("\n");
    expect(filesNamedIn(text)).toEqual([
      "/Users/sam/Instrument/report.md",
      "work/build.mjs",
      "/Users/sam/Instrument/chart.png",
    ]);
  });

  it("finds nothing in a text with no fence", () => {
    expect(filesNamedIn("Done, see work/report.md.")).toEqual([]);
  });
});
