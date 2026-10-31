import { describe, expect, it } from "vitest";

import { compressedRatio, StreamDegeneration } from "./stream-degeneration";

const repeat = (count: number, line: (i: number) => string) =>
  Array.from({ length: count }, (_, i) => line(i)).join("");

/** Fed the way a provider streams: a few characters at a time. */
function tripsOn(text: string, deltaChars = 7) {
  const detector = new StreamDegeneration();
  let tripped = false;
  for (let i = 0; i < text.length; i += deltaChars) {
    tripped = detector.push(text.slice(i, i + deltaChars));
  }
  return tripped;
}

// A small deterministic generator, so the prose varies like prose does.
function prose(words: number) {
  const vocabulary =
    "the river runs north past mills and farms where water once turned wheels that ground grain for towns along both banks until railways came and freight moved inland leaving docks empty while new bridges carried roads across floods each spring changed channels moved sand built islands drowned fields and farmers learned which acres stayed dry which flooded and how to plant late".split(
      " ",
    );
  let seed = 7;
  const out: string[] = [];
  for (let i = 0; i < words; i++) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    out.push(vocabulary[seed % vocabulary.length] ?? "");
    if (i % 17 === 16) {
      out.push(".\n");
    }
  }
  return out.join(" ");
}

// The captured GLM 5.3 Flash loop: one unit every ~110 characters, drifting
// between two spellings of the same call, then collapsing to one phrase.
const glmLoop =
  repeat(150, (i) =>
    i % 3 === 2
      ? "— `load_skill` — spreadsheet skill — "
      : "— **Loading the spreadsheet skill** — I need to load the spreadsheet skill first. — `load_skill` spreadsheet — `start_activity` ",
  ) + repeat(800, () => "tool placeholder — ");

const pythonPptx = repeat(
  60,
  (i) => `
slide = prs.slides.add_slide(prs.slide_layouts[1])
title = slide.shapes.title
title.text = "Quarter ${(i % 4) + 1} results for region ${i}"
body = slide.placeholders[1].text_frame
body.text = "Revenue grew ${(i * 13) % 40}% year over year"
p = body.add_paragraph()
p.text = "Margin held at ${(i * 7) % 30}%"
p.level = 1
`,
);

const markdownTable =
  "| Slide | Title | Status | Owner |\n|---|---|---|---|\n" +
  repeat(
    400,
    (i) => `| ${i + 1} | Section ${i + 1} overview | Draft | Team ${i % 5} |\n`,
  );

const csv = "id,a,b,c,d\n" + repeat(1200, (i) => `${i},0,0,${i % 3},0\n`);

const jsonRecords = JSON.stringify(
  Array.from({ length: 300 }, (_, i) => ({
    done: i % 2 === 0,
    id: i,
    name: `Item ${i}`,
    tags: ["a", "b"],
  })),
  undefined,
  2,
);

describe("StreamDegeneration", () => {
  it.each([
    ["the captured GLM loop", glmLoop],
    ["a word repeated", repeat(4000, () => "the ")],
    [
      "a loop after an honest opening",
      prose(600) + repeat(600, () => "I will now write the file. "),
    ],
    [
      "a loop after a fenced block",
      `Here is the script:\n\n\`\`\`python\n${pythonPptx}\`\`\`\n\n` +
        repeat(600, () => "Now I run it. Now I run it again. "),
    ],
  ])("trips on %s", (_name, text) => {
    expect(tripsOn(text)).toBe(true);
  });

  it.each([
    ["prose", prose(4000)],
    ["unfenced python-pptx code", pythonPptx.repeat(2)],
    ["an unfenced markdown table", markdownTable],
    ["unfenced CSV of mostly zeros", csv],
    ["unfenced JSON records", jsonRecords],
    ["fenced JSON records", `\`\`\`json\n${jsonRecords}\n\`\`\`\n`],
    [
      "a long fenced block of repeated lines",
      `~~~\n${repeat(2000, () => "0,0,0,0\n")}~~~\nDone.`,
    ],
  ])("leaves %s alone", (_name, text) => {
    expect(tripsOn(text)).toBe(false);
  });

  it("needs two dense checks in a row", () => {
    // One window's worth of repetition, then honest text again.
    expect(tripsOn(prose(1500) + "=".repeat(9000) + prose(3000))).toBe(false);
  });

  it("answers the same however the stream is cut", () => {
    expect(
      [1, 7, 113, 4096, glmLoop.length].map((size) => tripsOn(glmLoop, size)),
    ).toMatchInlineSnapshot(`
      [
        true,
        true,
        true,
        true,
        true,
      ]
    `);
  });

  it("keeps the gap between loops and honest text the threshold sits in", () => {
    const worstWindow = (text: string) => {
      let worst = 1;
      for (let end = 8192; end <= text.length; end += 4096) {
        worst = Math.min(worst, compressedRatio(text.slice(end - 8192, end)));
      }
      return Math.round(worst * 1000) / 10;
    };
    expect({
      csv: worstWindow(csv),
      glmLoop: worstWindow(glmLoop),
      jsonRecords: worstWindow(jsonRecords),
      markdownTable: worstWindow(markdownTable),
      prose: worstWindow(prose(4000)),
      pythonPptx: worstWindow(pythonPptx.repeat(2)),
    }).toMatchInlineSnapshot(`
      {
        "csv": 17.8,
        "glmLoop": 0.7,
        "jsonRecords": 6.1,
        "markdownTable": 10.5,
        "prose": 23.4,
        "pythonPptx": 5.9,
      }
    `);
  });
});
