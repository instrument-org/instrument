import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { collectAndForward, decodeForDisplay } from "./output-sink";

describe("collectAndForward", () => {
  it("awaits each sink write before consuming more output", async () => {
    const writes: string[] = [];
    let activeWrites = 0;
    let maxActiveWrites = 0;

    const output = await collectAndForward(
      Readable.from(["one\n", "two\n", "three\n"]),
      async (text) => {
        activeWrites++;
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
        await Promise.resolve();
        writes.push(text);
        activeWrites--;
      },
    );

    expect(writes).toEqual(["one\n", "two\n", "three\n"]);
    expect(maxActiveWrites).toBe(1);
    expect(output).toBe("one\ntwo\nthree\n");
  });

  it("splits an oversized line and bounds the returned text", async () => {
    const fiveMegabytes = "x".repeat(5 * 1024 * 1024);
    const forwardedBytes: number[] = [];

    const output = await collectAndForward(
      Readable.from([fiveMegabytes]),
      (text) => {
        forwardedBytes.push(Buffer.byteLength(text, "utf8"));
      },
    );

    expect(Math.max(...forwardedBytes)).toBeLessThanOrEqual(1024 * 1024);
    expect(Buffer.byteLength(output, "utf8")).toBeLessThan(
      4 * 1024 * 1024 + 100,
    );
    expect(output).toContain("bytes omitted");
  });

  it("preserves a UTF-8 character split across stream chunks", async () => {
    const encoded = Buffer.from("€\n", "utf8");
    const writes: string[] = [];

    const output = await collectAndForward(
      Readable.from([encoded.subarray(0, 2), encoded.subarray(2)]),
      (text) => {
        writes.push(text);
      },
    );

    expect(output).toBe("€\n");
    expect(writes).toEqual(["€\n"]);
  });

  // However the chunks fall, the text is what decoding the whole stream at
  // once gives: UTF-8 as text, a stray byte as its Latin-1 char.
  it.each([1, 2, 3, 4, 5])(
    "decodes stray bytes as one decode would, in chunks of %i",
    async (size) => {
      const bytes = Buffer.from([
        ...Buffer.from("é€"),
        0x89,
        0xe2,
        0x82,
        ...Buffer.from("😀\n"),
      ]);
      const chunks = Array.from(
        { length: Math.ceil(bytes.length / size) },
        (_, i) => bytes.subarray(i * size, (i + 1) * size),
      );
      const output = await collectAndForward(Readable.from(chunks), () => {});
      expect(output).toBe(decodeForDisplay(bytes));
      expect(output).toBe(`é€${String.fromCharCode(0x89, 0xe2, 0x82)}😀\n`);
    },
  );
});
