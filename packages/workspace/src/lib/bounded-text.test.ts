import { describe, expect, it } from "vitest";

import { BoundedText } from "./bounded-text";

describe("BoundedText", () => {
  it("returns everything written while it fits", () => {
    const text = new BoundedText({ headBytes: 100, tailBytes: 100 });
    text.write("one\n");
    text.write("two\n");

    expect(text.toString()).toMatchInlineSnapshot(`
      "one
      two
      "
    `);
    expect(text.omittedBytes).toBe(0);
  });

  it("keeps the head, keeps the tail, and marks the gap", () => {
    const text = new BoundedText({ headBytes: 6, tailBytes: 6 });
    text.write("HEAD__");
    for (let i = 0; i < 20; i++) {
      text.write("middle");
    }
    text.write("__TAIL");

    expect(text.toString()).toMatchInlineSnapshot(
      `
      "HEAD__
      [... 120 bytes omitted ...]
      __TAIL"
    `,
    );
  });

  it("stays bounded no matter how much is written", () => {
    const text = new BoundedText({ headBytes: 1024, tailBytes: 1024 });
    for (let i = 0; i < 10_000; i++) {
      text.write("x".repeat(500));
    }

    expect(text.retainedBytes).toBeLessThanOrEqual(1024 + 1024);
    expect(text.omittedBytes).toBeGreaterThan(4_000_000);
  });

  it("never evicts the bounded head, so early output survives a long run", () => {
    const text = new BoundedText({ headBytes: 10, tailBytes: 10 });
    text.write("first line");
    for (let i = 0; i < 100; i++) {
      text.write("later");
    }

    expect(text.toString()).toContain("first line".slice(0, 10));
  });

  it("counts bytes rather than characters", () => {
    const text = new BoundedText({ headBytes: 3, tailBytes: 3 });
    text.write("€");
    text.write("€");
    text.write("€");

    expect(text.omittedBytes).toBe(3);
  });

  it("splits oversized writes without exceeding either byte budget", () => {
    const text = new BoundedText({ headBytes: 4, tailBytes: 4 });
    text.write(`a€${"x".repeat(20)}€b`);

    expect(text.retainedBytes).toBeLessThanOrEqual(8);
    expect(text.toString()).toMatchInlineSnapshot(`
      "a€
      [... 20 bytes omitted ...]
      €b"
    `);
  });

  it("preserves order when a multibyte character cannot fit in the head", () => {
    const text = new BoundedText({ headBytes: 1, tailBytes: 10 });
    text.write("€");
    text.write("a");

    expect(text.toString()).toBe("€a");
    expect(text.retainedBytes).toBe(4);
  });

  it("ignores empty writes", () => {
    const text = new BoundedText({ headBytes: 10, tailBytes: 10 });
    text.write("");

    expect(text.toString()).toBe("");
    expect(text.retainedBytes).toBe(0);
  });
});
