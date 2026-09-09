import { describe, expect, it } from "vitest";

import { BackgroundOutputBuffer } from "./background-output-buffer";

describe("BackgroundOutputBuffer", () => {
  it("drains what was pushed and then reports empty", () => {
    const buffer = new BackgroundOutputBuffer({ capBytes: 1024 });
    buffer.write("one\n");
    buffer.write("two\n");

    expect(buffer.drain()).toMatchInlineSnapshot(`
      {
        "omittedBytes": 0,
        "text": "one
      two
      ",
      }
    `);
    expect(buffer.hasPending()).toBe(false);
    expect(buffer.drain()).toMatchInlineSnapshot(`
      {
        "omittedBytes": 0,
        "text": "",
      }
    `);
  });

  it("counts every byte pushed, drained or not", () => {
    const buffer = new BackgroundOutputBuffer({ capBytes: 1024 });
    buffer.write("abc");
    buffer.drain();
    buffer.write("de");

    expect(buffer.totalBytes).toBe(5);
  });

  it("drops the oldest chunks past the cap and reports their size", () => {
    const buffer = new BackgroundOutputBuffer({ capBytes: 10 });
    buffer.write("aaaaa");
    buffer.write("bbbbb");
    buffer.write("ccccc");

    expect(buffer.drain()).toMatchInlineSnapshot(`
      {
        "omittedBytes": 5,
        "text": "bbbbbccccc",
      }
    `);
  });

  it("keeps only the newest bytes when one chunk exceeds the cap", () => {
    const buffer = new BackgroundOutputBuffer({ capBytes: 4 });
    buffer.write("aaaa");
    buffer.write("bbbbbbbbbb");

    expect(buffer.drain()).toMatchInlineSnapshot(`
      {
        "omittedBytes": 10,
        "text": "bbbb",
      }
    `);
  });

  it("measures bytes rather than characters", () => {
    const buffer = new BackgroundOutputBuffer({ capBytes: 4 });
    // Three bytes each, so the second push evicts the first.
    buffer.write("€");
    buffer.write("€");

    expect(buffer.drain()).toMatchInlineSnapshot(`
      {
        "omittedBytes": 3,
        "text": "€",
      }
    `);
  });

  it("does not split a multibyte character at the cap", () => {
    const buffer = new BackgroundOutputBuffer({ capBytes: 4 });
    buffer.write("a€b€");

    const drained = buffer.drain();
    expect(Buffer.byteLength(drained.text, "utf8")).toBeLessThanOrEqual(4);
    expect(drained).toMatchInlineSnapshot(`
      {
        "omittedBytes": 4,
        "text": "b€",
      }
    `);
  });

  it("snapshots without draining, for seeding a log file", () => {
    const buffer = new BackgroundOutputBuffer({ capBytes: 1024 });
    buffer.write("kept\n");

    expect(buffer.snapshot()).toMatchInlineSnapshot(`
      "kept
      "
    `);
    expect(buffer.hasPending()).toBe(true);
  });

  it("ignores empty pushes", () => {
    const buffer = new BackgroundOutputBuffer({ capBytes: 1024 });
    buffer.write("");

    expect(buffer.hasPending()).toBe(false);
    expect(buffer.totalBytes).toBe(0);
  });
});
