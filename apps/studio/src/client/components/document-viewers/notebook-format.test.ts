// cspell:ignore ename evalue nbformat pyerr pyout vnd
import { describe, expect, it } from "vitest";

import {
  type AnsiLine,
  type NotebookOutput,
  parseAnsi,
  parseNotebook,
} from "./notebook-format";

/** The rendered text of a line, with the styling dropped. */
function lineText(line: AnsiLine | undefined): string {
  return (line ?? []).map((segment) => segment.text).join("");
}

/** A minimal nbformat 4 notebook around the given cells. */
function notebook(cells: unknown[], metadata: unknown = {}): string {
  return JSON.stringify({
    cells,
    metadata,
    nbformat: 4,
    nbformat_minor: 5,
  });
}

/** The outputs of a single code cell, parsed. */
function outputsOf(outputs: unknown[]): NotebookOutput[] {
  const parsed = parseNotebook(
    notebook([
      {
        cell_type: "code",
        execution_count: 1,
        outputs,
        source: "print(1)",
      },
    ]),
  );
  return parsed.cells[0]?.outputs ?? [];
}

describe("parseNotebook", () => {
  it("joins a source given as an array of lines", () => {
    const parsed = parseNotebook(
      notebook([
        { cell_type: "code", source: ["import os\n", "print(os.name)\n"] },
        { cell_type: "markdown", source: "# Title" },
      ]),
    );

    expect(parsed.cells[0]?.source).toBe("import os\nprint(os.name)\n");
    expect(parsed.cells[1]?.source).toBe("# Title");
  });

  it("reads a source given as a single string", () => {
    const parsed = parseNotebook(
      notebook([{ cell_type: "code", source: "x = 1\ny = 2" }]),
    );

    expect(parsed.cells[0]?.source).toBe("x = 1\ny = 2");
  });

  it("keeps the execution count and falls back to null for an unrun cell", () => {
    const parsed = parseNotebook(
      notebook([
        { cell_type: "code", execution_count: 12, source: "" },
        { cell_type: "code", execution_count: null, source: "" },
      ]),
    );

    expect(parsed.cells[0]?.executionCount).toBe(12);
    expect(parsed.cells[1]?.executionCount).toBe(null);
  });

  it("treats an unrecognized cell type as raw and gives it no outputs", () => {
    const parsed = parseNotebook(
      notebook([{ cell_type: "raw", outputs: [{}], source: "plain" }]),
    );

    expect(parsed.cells[0]?.type).toBe("raw");
    expect(parsed.cells[0]?.outputs).toEqual([]);
  });

  it("reads the language from the notebook metadata", () => {
    expect(parseNotebook(notebook([])).language).toBe("python");
    expect(
      parseNotebook(notebook([], { language_info: { name: "julia" } }))
        .language,
    ).toBe("julia");
    expect(
      parseNotebook(notebook([], { kernelspec: { language: "r" } })).language,
    ).toBe("r");
  });

  it("inlines the images a markdown cell carries as attachments", () => {
    const parsed = parseNotebook(
      notebook([
        {
          attachments: { "shot 1.png": { "image/png": "QUJD" } },
          cell_type: "markdown",
          source:
            "![a](attachment:shot%201.png) and ![b](attachment:shot 1.png)",
        },
      ]),
    );

    expect(parsed.cells[0]?.source).toBe(
      "![a](data:image/png;base64,QUJD) and ![b](data:image/png;base64,QUJD)",
    );
  });

  it("lower-cases the mime type it builds the attachment uri from", () => {
    // The key is matched case-insensitively, but the URI it produces is read
    // downstream by an image allow-list that is not.
    const parsed = parseNotebook(
      notebook([
        {
          attachments: { "shot.png": { "Image/PNG": "QUJD" } },
          cell_type: "markdown",
          source: "![a](attachment:shot.png)",
        },
      ]),
    );

    expect(parsed.cells[0]?.source).toBe("![a](data:image/png;base64,QUJD)");
  });

  it("replaces the longest attachment name first", () => {
    // Replacing `a.png` first would eat the head of the longer reference and
    // leave the URI with a stray `.bak.png` after it, so neither resolves.
    const parsed = parseNotebook(
      notebook([
        {
          attachments: {
            "a.png": { "image/png": "QUJD" },
            "a.png.bak.png": { "image/png": "WFla" },
          },
          cell_type: "markdown",
          source:
            "![short](attachment:a.png) ![long](attachment:a.png.bak.png)",
        },
      ]),
    );

    expect(parsed.cells[0]?.source).toBe(
      "![short](data:image/png;base64,QUJD) ![long](data:image/png;base64,WFla)",
    );
  });

  it("ignores an attachment whose mime key is not a plausible mime type", () => {
    // The key is written by the file and gets interpolated into a data URI
    // that is spliced back into markdown, so a key carrying markdown's own
    // punctuation would close the image link and open whatever came after it.
    const parsed = parseNotebook(
      notebook([
        {
          attachments: {
            "shot.png": { "image/x)](y) [click](https://x.test)": "QUJD" },
          },
          cell_type: "markdown",
          source: "![a](attachment:shot.png)",
        },
      ]),
    );

    expect(parsed.cells[0]?.source).toBe("![a](attachment:shot.png)");
  });

  it("keeps cell ids unique even when the file repeats one", () => {
    // nbformat 4.5 requires them to be unique and real files are not always,
    // and these become React keys: a duplicate lets the reconciler carry one
    // cell's state onto another.
    const parsed = parseNotebook(
      notebook([
        { cell_type: "code", id: "same", source: "first" },
        { cell_type: "code", id: "same", source: "second" },
        { cell_type: "markdown", source: "no id" },
      ]),
    );

    const ids = parsed.cells.map((cell) => cell.id);
    expect(new Set(ids).size).toBe(3);
  });

  it.each([
    ["not json at all", "{"],
    ["a json array", "[]"],
    ["a json object that is not a notebook", '{"hello":"world"}'],
  ])("throws on %s so the file reaches the fallback card", (_label, text) => {
    expect(() => parseNotebook(text)).toThrow();
  });
});

describe("notebook outputs", () => {
  it("reads a stream output and marks the channel", () => {
    expect(
      outputsOf([
        { name: "stdout", output_type: "stream", text: ["one\n", "two\n"] },
        { name: "stderr", output_type: "stream", text: "warned\n" },
      ]),
    ).toEqual([
      {
        lines: [
          [{ style: { bold: false, color: null }, text: "one" }],
          [{ style: { bold: false, color: null }, text: "two" }],
        ],
        prompt: null,
        stream: "stdout",
        type: "text",
      },
      {
        lines: [[{ style: { bold: false, color: null }, text: "warned" }]],
        prompt: null,
        stream: "stderr",
        type: "text",
      },
    ]);
  });

  it("merges the consecutive stream chunks a loop of prints produces", () => {
    const outputs = outputsOf([
      { name: "stdout", output_type: "stream", text: "a\n" },
      { name: "stdout", output_type: "stream", text: "b\n" },
      { name: "stderr", output_type: "stream", text: "c\n" },
      { name: "stdout", output_type: "stream", text: "d\n" },
    ]);

    expect(outputs).toHaveLength(3);
    expect(outputs[0]).toMatchObject({ stream: "stdout" });
    expect(outputs[0]?.type === "text" && outputs[0].lines).toHaveLength(2);
    expect(outputs[1]).toMatchObject({ stream: "stderr" });
    expect(outputs[2]).toMatchObject({ stream: "stdout" });
  });

  it("keeps only the last state of a carriage-returned progress bar", () => {
    const outputs = outputsOf([
      {
        name: "stderr",
        output_type: "stream",
        text: " 10%|# |\r 50%|##### |\r100%|##########|\n",
      },
    ]);

    expect(outputs[0]?.type === "text" && outputs[0].lines).toHaveLength(1);
    expect(
      outputs[0]?.type === "text" ? lineText(outputs[0].lines[0]) : undefined,
    ).toBe("100%|##########|");
  });

  it("carries the execution count of an execute result as its prompt", () => {
    expect(
      outputsOf([
        {
          data: { "text/plain": "42" },
          execution_count: 7,
          output_type: "execute_result",
        },
      ]),
    ).toEqual([
      {
        lines: [[{ style: { bold: false, color: null }, text: "42" }]],
        prompt: 7,
        stream: null,
        type: "text",
      },
    ]);
  });

  it("turns a png bundle into a data URI and takes its alt from text/plain", () => {
    expect(
      outputsOf([
        {
          data: {
            "image/png": "iVBORw0KGgo=\n",
            "text/plain": "<Figure size 640x480>",
          },
          output_type: "display_data",
        },
      ]),
    ).toEqual([
      {
        alt: "<Figure size 640x480>",
        prompt: null,
        src: "data:image/png;base64,iVBORw0KGgo=",
        type: "image",
      },
    ]);
  });

  it("serves svg output through a data URI rather than inlining the markup", () => {
    const outputs = outputsOf([
      {
        data: { "image/svg+xml": "<svg><circle r='1'/></svg>" },
        output_type: "display_data",
      },
    ]);

    expect(outputs[0]).toEqual({
      alt: "Notebook output image",
      prompt: null,
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        "<svg><circle r='1'/></svg>",
      )}`,
      type: "image",
    });
  });

  it("keeps html output for the sanitizer", () => {
    expect(
      outputsOf([
        {
          data: {
            "text/html": ["<table>\n", "<tr><td>1</td></tr>\n", "</table>"],
            "text/plain": "   x\n0  1",
          },
          output_type: "execute_result",
        },
      ]),
    ).toEqual([
      {
        html: "<table>\n<tr><td>1</td></tr>\n</table>",
        prompt: null,
        type: "html",
      },
    ]);
  });

  it("pretty-prints a json bundle", () => {
    expect(
      outputsOf([
        {
          data: { "application/json": { a: [1, 2] } },
          output_type: "display_data",
        },
      ]),
    ).toEqual([
      {
        json: '{\n  "a": [\n    1,\n    2\n  ]\n}',
        prompt: null,
        type: "json",
      },
    ]);
  });

  describe("mime precedence", () => {
    it("prefers a picture to the markup that would arrive inert", () => {
      const outputs = outputsOf([
        {
          data: {
            "image/png": "AAAA",
            "text/html": "<div>plot</div>",
            "text/plain": "Figure",
          },
          output_type: "display_data",
        },
      ]);

      expect(outputs[0]?.type).toBe("image");
    });

    it("prefers html to plain text", () => {
      const outputs = outputsOf([
        {
          data: { "text/html": "<b>hi</b>", "text/plain": "hi" },
          output_type: "execute_result",
        },
      ]);

      expect(outputs[0]?.type).toBe("html");
    });

    it("degrades a widget to the plain-text fallback it ships with", () => {
      const outputs = outputsOf([
        {
          data: {
            "application/vnd.jupyter.widget-view+json": { model_id: "abc" },
            "text/plain": "IntSlider(value=0)",
          },
          output_type: "display_data",
        },
      ]);

      expect(outputs[0]).toMatchObject({ type: "text" });
      expect(
        outputs[0]?.type === "text" ? lineText(outputs[0].lines[0]) : undefined,
      ).toBe("IntSlider(value=0)");
    });

    it("falls through to the next representation when the richest is empty", () => {
      // Picking by which key exists rather than which key has content would
      // throw the whole output away here, plain text and all.
      const outputs = outputsOf([
        {
          data: {
            "image/png": "",
            "text/html": "   ",
            "text/plain": "still here",
          },
          output_type: "display_data",
        },
      ]);

      expect(outputs[0]).toMatchObject({ type: "text" });
      expect(
        outputs[0]?.type === "text" ? lineText(outputs[0].lines[0]) : undefined,
      ).toBe("still here");
    });

    it("falls through when the json representation carries nothing", () => {
      // Every other branch reports an empty representation as empty. This one
      // outranks `text/plain`, so if it did not, a bare `null` would be shown
      // in place of the description beside it.
      const outputs = outputsOf([
        {
          data: { "application/json": null, "text/plain": "still here" },
          output_type: "display_data",
        },
      ]);

      expect(outputs[0]).toMatchObject({ type: "text" });
      expect(
        outputs[0]?.type === "text" ? lineText(outputs[0].lines[0]) : undefined,
      ).toBe("still here");
    });

    it("drops an output whose bundle holds nothing it can render", () => {
      expect(
        outputsOf([
          {
            data: { "application/vnd.plotly.v1+json": { data: [] } },
            output_type: "display_data",
          },
        ]),
      ).toEqual([]);
    });
  });

  describe("errors", () => {
    it("strips the ansi escapes out of a traceback and keeps the color", () => {
      const outputs = outputsOf([
        {
          ename: "ValueError",
          evalue: "bad",
          output_type: "error",
          traceback: [
            "\u001B[0;31m---------\u001B[0m",
            "\u001B[0;32m      1 x = 1\u001B[0m\n\u001B[0;31mValueError\u001B[0m: bad",
          ],
        },
      ]);

      const error = outputs[0];
      expect(error?.type).toBe("error");
      if (error?.type !== "error") {
        return;
      }

      expect(error.traceback.map((line) => lineText(line))).toEqual([
        "---------",
        "      1 x = 1",
        "ValueError: bad",
      ]);
      expect(error.traceback[0]?.[0]?.style).toEqual({
        bold: false,
        color: "red",
      });
      expect(error.traceback[1]?.[0]?.style).toEqual({
        bold: false,
        color: "green",
      });
    });

    it("falls back to the exception name and value with no traceback", () => {
      const outputs = outputsOf([
        { ename: "KeyError", evalue: "'a'", output_type: "error" },
      ]);

      const error = outputs[0];
      expect(error?.type === "error" && lineText(error.traceback[0])).toBe(
        "KeyError: 'a'",
      );
    });
  });
});

describe("nbformat 3", () => {
  const legacy = JSON.stringify({
    metadata: { language_info: { name: "python" } },
    nbformat: 3,
    nbformat_minor: 0,
    worksheets: [
      {
        cells: [
          { cell_type: "heading", level: 2, source: "Setup" },
          {
            cell_type: "code",
            input: ["a = 1\n", "a\n"],
            outputs: [
              { output_type: "stream", stream: "stdout", text: ["hello\n"] },
              { output_type: "pyout", prompt_number: 3, text: ["1"] },
              { output_type: "display_data", png: "QUJD" },
              {
                ename: "ZeroDivisionError",
                evalue: "division by zero",
                output_type: "pyerr",
                traceback: ["\u001B[1;31mZeroDivisionError\u001B[0m"],
              },
            ],
            prompt_number: 3,
          },
        ],
      },
    ],
  });

  it("flattens the worksheets into one cell list", () => {
    expect(parseNotebook(legacy).cells).toHaveLength(2);
  });

  it("turns a heading cell back into markdown", () => {
    expect(parseNotebook(legacy).cells[0]).toMatchObject({
      source: "## Setup",
      type: "markdown",
    });
  });

  it("reads `input` and `prompt_number` as source and execution count", () => {
    expect(parseNotebook(legacy).cells[1]).toMatchObject({
      executionCount: 3,
      source: "a = 1\na\n",
      type: "code",
    });
  });

  it("parses the json its flat key stores as text rather than parsed", () => {
    // Every nbformat 3 flat key holds text -- including this one, which
    // nbformat 4 holds parsed. Stringifying text that is already JSON gives
    // one quoted, backslashed line where the data should be.
    const parsed = parseNotebook(
      JSON.stringify({
        nbformat: 3,
        nbformat_minor: 0,
        worksheets: [
          {
            cells: [
              {
                cell_type: "code",
                input: "data",
                outputs: [
                  {
                    json: ['{"a":', " [1, 2]}"],
                    output_type: "pyout",
                    prompt_number: 1,
                  },
                ],
                prompt_number: 1,
              },
            ],
          },
        ],
      }),
    );

    expect(parsed.cells[0]?.outputs[0]).toEqual({
      json: '{\n  "a": [\n    1,\n    2\n  ]\n}',
      prompt: 1,
      type: "json",
    });
  });

  it("falls back to the text beside json its flat key stored unparseably", () => {
    // Text that will not parse is not JSON output, so the representation that
    // came with it is the one to show -- re-encoding the text would put back
    // the quoted, backslashed line this path exists to avoid.
    const parsed = parseNotebook(
      JSON.stringify({
        nbformat: 3,
        nbformat_minor: 0,
        worksheets: [
          {
            cells: [
              {
                cell_type: "code",
                input: "data",
                outputs: [
                  {
                    json: "{not json",
                    output_type: "pyout",
                    prompt_number: 1,
                    text: "readable",
                  },
                ],
                prompt_number: 1,
              },
            ],
          },
        ],
      }),
    );

    const output = parsed.cells[0]?.outputs[0];
    expect(output).toMatchObject({ type: "text" });
    expect(
      output?.type === "text" ? lineText(output.lines[0]) : undefined,
    ).toBe("readable");
  });

  it("maps the legacy output types and flat mime keys", () => {
    const outputs = parseNotebook(legacy).cells[1]?.outputs ?? [];

    expect(outputs[0]).toMatchObject({ stream: "stdout", type: "text" });
    expect(outputs[1]).toMatchObject({ prompt: 3, type: "text" });
    expect(outputs[2]).toMatchObject({
      src: "data:image/png;base64,QUJD",
      type: "image",
    });
    expect(outputs[3]).toMatchObject({
      ename: "ZeroDivisionError",
      type: "error",
    });
  });
});

describe("parseAnsi", () => {
  it("returns one plain segment for text with no escapes", () => {
    expect(parseAnsi("plain")).toEqual([
      [{ style: { bold: false, color: null }, text: "plain" }],
    ]);
  });

  it("splits at each style change and resets on 0", () => {
    expect(parseAnsi("a\u001B[1;31mb\u001B[0mc")).toEqual([
      [
        { style: { bold: false, color: null }, text: "a" },
        { style: { bold: true, color: "red" }, text: "b" },
        { style: { bold: false, color: null }, text: "c" },
      ],
    ]);
  });

  it("consumes the sequences it does not render", () => {
    // Cursor moves and erase-line are what a progress bar leaves behind; a
    // 256-color code is a style we do not carry.
    expect(lineText(parseAnsi("\u001B[2K\u001B[38;5;208mx\u001B[A")[0])).toBe(
      "x",
    );
  });

  // An extended color carries its own arguments, and those numbers collide
  // with the palette keys: the two 30s ending `38;2;255;30;30` read as black
  // if they are looked up one at a time, and the 31 in `38;5;31` reads as red.
  // The whole instruction has to be consumed, not just its introducer.
  it.each([
    ["24-bit foreground", "\u001B[38;2;255;30;30mtext"],
    ["256-color foreground", "\u001B[38;5;31mtext"],
    ["256-color background", "\u001B[48;5;34mtext"],
    ["24-bit background", "\u001B[48;2;30;30;30mtext"],
  ])("leaves text plain after a %s", (_label, input) => {
    expect(parseAnsi(input)).toEqual([
      [{ style: { bold: false, color: null }, text: "text" }],
    ]);
  });

  it("still reads a palette color following an extended one", () => {
    expect(parseAnsi("\u001B[38;5;208m\u001B[31mred")).toEqual([
      [{ style: { bold: false, color: "red" }, text: "red" }],
    ]);
  });

  it("drops the trailing blank line a final newline would add", () => {
    expect(parseAnsi("one\n")).toHaveLength(1);
    expect(parseAnsi("one\n\n")).toHaveLength(2);
  });

  it("stops at an escape that never terminates", () => {
    expect(lineText(parseAnsi("keep\u001B[0")[0])).toBe("keep");
  });
});
