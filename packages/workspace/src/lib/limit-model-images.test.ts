import type { ModelMessage } from "ai";

import { describe, expect, it } from "vitest";

import { firstKept, limitModelImages } from "./limit-model-images";

const SMALL = 100_000;

/** A tool result carrying one image, as a screenshot or a read_file comes back. */
function imageResult(index: number, bytes = 3): ModelMessage {
  return {
    content: [
      {
        output: {
          type: "content",
          value: [
            { text: `shot ${index}`, type: "text" },
            {
              data: {
                data: Buffer.alloc(bytes, index).toString("base64"),
                type: "data",
              },
              mediaType: "image/png",
              type: "file",
            },
          ],
        },
        toolCallId: `call-${index}`,
        toolName: "bash",
        type: "tool-result",
      },
    ],
    role: "tool",
  };
}

describe("firstKept", () => {
  it.each([
    [0, 0],
    [90, 0],
    [91, 41],
    [131, 41],
    [132, 82],
  ])("with %i small images keeps from %i", (count, expected) => {
    expect(firstKept(Array.from({ length: count }, () => SMALL))).toBe(
      expected,
    );
  });

  it("cuts to the byte target once the byte trigger passes, then holds", () => {
    const megabyte = 1024 * 1024;
    // 26 one-megabyte images pass 25 MB: the oldest leave until 15 remain.
    expect(firstKept(Array.from({ length: 25 }, () => megabyte))).toBe(0);
    expect(firstKept(Array.from({ length: 26 }, () => megabyte))).toBe(11);
    // Ten more stay under the trigger, so the cut does not move.
    expect(firstKept(Array.from({ length: 36 }, () => megabyte))).toBe(11);
  });
});

describe("limitModelImages", () => {
  it("leaves a request within the limits untouched", async () => {
    const messages = [imageResult(1), imageResult(2)];
    expect(await limitModelImages(messages)).toBe(messages);
  });

  it("puts a note where each of the oldest images was and keeps the newest", async () => {
    const messages = Array.from({ length: 91 }, (_, index) =>
      imageResult(index),
    );
    const limited = await limitModelImages(messages);
    const kinds = limited.map((message) =>
      JSON.stringify(message).includes("image/png") ? "image" : "note",
    );
    expect(kinds.filter((kind) => kind === "note")).toHaveLength(41);
    expect(kinds.slice(41).every((kind) => kind === "image")).toBe(true);
    expect(JSON.stringify(limited[0])).toContain(
      "This image was left out",
    );
  });
});
