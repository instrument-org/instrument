import { describe, expect, it } from "vitest";

import { describeError } from "./describe-error";

const circular: Record<string, unknown> = { message: "a value that cycles" };
circular.self = circular;

const cases: { error: unknown; name: string }[] = [
  {
    // Recorded from a task that hit this: OpenRouter reports upstream
    // throttling as one chunk in an otherwise successful stream, and the chunk
    // is thrown verbatim.
    error: {
      code: 429,
      message: "openai/gpt-5.6-luna is temporarily rate-limited upstream.",
      metadata: { error_type: "rate_limit_exceeded" },
    },
    name: "a provider rejection thrown as a bare object",
  },
  {
    error: { error: "Something went wrong" },
    name: "a body whose sentence is under `error`",
  },
  {
    error: { code: "BAD_REQUEST", issues: [{ path: ["model"] }] },
    name: "an object carrying no sentence at all",
  },
  { error: { message: "" }, name: "an empty sentence" },
  { error: "boom", name: "a thrown string" },
  { error: circular, name: "an object that cycles" },
  { error: [{ status: 500 }], name: "a thrown array" },
  { error: null, name: "null" },
  { error: undefined, name: "undefined" },
  { error: 42, name: "a number" },
];

describe("describeError", () => {
  it("names a thrown value that is not an Error", () => {
    expect(
      Object.fromEntries(
        cases.map(({ error, name }) => [name, describeError(error)]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "a body whose sentence is under \`error\`": {
          "details": "{ error: 'Something went wrong' }",
          "message": "Something went wrong",
        },
        "a number": {
          "message": "42",
        },
        "a provider rejection thrown as a bare object": {
          "details": "{
        code: 429,
        message: 'openai/gpt-5.6-luna is temporarily rate-limited upstream.',
        metadata: { error_type: 'rate_limit_exceeded' }
      }",
          "message": "openai/gpt-5.6-luna is temporarily rate-limited upstream.",
        },
        "a thrown array": {
          "message": "[ { status: 500 } ]",
        },
        "a thrown string": {
          "message": "boom",
        },
        "an empty sentence": {
          "message": "{ message: '' }",
        },
        "an object carrying no sentence at all": {
          "message": "{
        code: 'BAD_REQUEST',
        issues: [ { path: [ 'model' ] } ]
      }",
        },
        "an object that cycles": {
          "details": "<ref *1> { message: 'a value that cycles', self: [Circular *1] }",
          "message": "a value that cycles",
        },
        "null": {
          "message": "null",
        },
        "undefined": {
          "message": "undefined",
        },
      }
    `);
  });

  it("leads with an Error's message and keeps its stack", () => {
    const described = describeError(new Error("plain failure"));

    expect(described.message).toBe("plain failure");
    expect(described.details).toContain("Error: plain failure");
    expect(described.details).toContain("describe-error.test.ts");
  });

  it("falls back to the class name when an Error has no message", () => {
    class EmptyError extends Error {
      override name = "EmptyError";
    }

    expect(describeError(new EmptyError()).message).toBe("EmptyError");
  });
});
