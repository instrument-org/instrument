// The line fixtures are Sentry's own (packages/core/test/lib/utils/
// stacktrace.test.ts, MIT), with `in_app` read as `inApp` and no module
// lookup.
import { describe, expect, it } from "vitest";

import { parseStack, parseStackLine, STACK_FRAME_LIMIT } from "./stack-parser";

describe("parseStackLine", () => {
  it("returns undefined for a line that is no frame", () => {
    expect(parseStackLine("invalid input")).toBeUndefined();
  });

  it.each([
    [
      "at myFunction (/path/to/file.js:10:5)",
      {
        colno: 5,
        filename: "/path/to/file.js",
        function: "myFunction",
        inApp: true,
        lineno: 10,
      },
    ],
    [
      "at /path/to/file.js:10:5",
      {
        colno: 5,
        filename: "/path/to/file.js",
        function: "?",
        inApp: true,
        lineno: 10,
      },
    ],
    [
      "at myObject.myMethod (/path/to/file.js:10:5)",
      {
        colno: 5,
        filename: "/path/to/file.js",
        function: "myObject.myMethod",
        inApp: true,
        lineno: 10,
      },
    ],
    [
      "at myFunction (file:///path/to/file.js:10:5)",
      {
        colno: 5,
        filename: "/path/to/file.js",
        function: "myFunction",
        inApp: true,
        lineno: 10,
      },
    ],
    [
      "at myFunction (/path/to/file.js)",
      {
        colno: undefined,
        filename: "/path/to/file.js",
        function: "myFunction",
        inApp: true,
        lineno: undefined,
      },
    ],
    [
      "at myFunction (native)",
      {
        colno: undefined,
        filename: undefined,
        function: "myFunction",
        inApp: false,
        lineno: undefined,
      },
    ],
    [
      "at Object.<anonymous> (/path/to/myFile.js:10:20)",
      {
        colno: 20,
        filename: "/path/to/myFile.js",
        function: "Object.?",
        inApp: true,
        lineno: 10,
      },
    ],
    [
      "at Object.<anonymous> (native)",
      {
        colno: undefined,
        filename: undefined,
        function: "Object.?",
        inApp: false,
        lineno: undefined,
      },
    ],
    [
      "at Object.<anonymous> (/path/to/node_modules/myModule/index.js:10:20)",
      {
        colno: 20,
        filename: "/path/to/node_modules/myModule/index.js",
        function: "Object.?",
        inApp: false,
        lineno: 10,
      },
    ],
    [
      "at Object.<anonymous> (C:\\path\\to\\myFile.js:10:20)",
      {
        colno: 20,
        filename: "C:\\path\\to\\myFile.js",
        function: "Object.?",
        inApp: true,
        lineno: 10,
      },
    ],
    [
      "at myObject.myMethod (/path/to/file with space(1).js:10:5)",
      {
        colno: 5,
        filename: "/path/to/file with space(1).js",
        function: "myObject.myMethod",
        inApp: true,
        lineno: 10,
      },
    ],
    [
      "at myObject.myMethod (/path with space(1)/to/file.js:10:5)",
      {
        colno: 5,
        filename: "/path with space(1)/to/file.js",
        function: "myObject.myMethod",
        inApp: true,
        lineno: 10,
      },
    ],
    [
      "at myObject.myMethod (/path/to/file%20with%20space(1).js:10:5)",
      {
        colno: 5,
        filename: "/path/to/file with space(1).js",
        function: "myObject.myMethod",
        inApp: true,
        lineno: 10,
      },
    ],
    [
      "at myObject.myMethod (/path%20with%20space(1)/to/file.js:10:5)",
      {
        colno: 5,
        filename: "/path with space(1)/to/file.js",
        function: "myObject.myMethod",
        inApp: true,
        lineno: 10,
      },
    ],
    [
      "at dynamicFn (data:application/javascript,export function dynamicFn() {  throw new Error('Error from data-uri module');};:1:38)",
      { filename: "<data:application/javascript>", function: "dynamicFn" },
    ],
  ])("parses %s", (line, frame) => {
    expect(parseStackLine(line)).toEqual(frame);
  });

  it("marks a URL with a protocol in-app", () => {
    expect(
      parseStackLine(
        "at Object.<anonymous> (app:///_next/server/pages/[error].js:10:20)",
      )?.inApp,
    ).toBe(true);
  });

  it("marks Node's and Electron's own modules as not in-app", () => {
    expect(
      parseStackLine(
        "at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
      )?.inApp,
    ).toBe(false);
    expect(
      parseStackLine("at EventEmitter.emit (electron/js2c/browser_init:2:73)")
        ?.inApp,
    ).toBe(false);
  });

  it("keeps the raw filename when decodeURI throws", () => {
    expect(
      parseStackLine("at myFunction (/path/to/%file%.js:10:5)")?.filename,
    ).toBe("/path/to/%file%.js");
  });

  it("decodes a valid percent-encoded filename", () => {
    expect(
      parseStackLine("at myFunction (/path/to/my%20file.js:10:5)")?.filename,
    ).toBe("/path/to/my file.js");
  });
});

describe("parseStack", () => {
  it("returns the frames oldest first and skips the message", () => {
    const stack = [
      "TypeError: Cannot read properties of undefined (reading 'id')",
      "    at readChat (/app/out/main/index.js:120:14)",
      "    at async Promise.all (index 0)",
      "    at async loadChats (/app/out/main/index.js:88:3)",
    ].join("\n");
    expect(parseStack(stack)).toMatchInlineSnapshot(`
      [
        {
          "colno": 3,
          "filename": "/app/out/main/index.js",
          "function": "loadChats",
          "inApp": true,
          "lineno": 88,
        },
        {
          "colno": undefined,
          "filename": "index 0",
          "function": "Promise.all",
          "inApp": false,
          "lineno": undefined,
        },
        {
          "colno": 14,
          "filename": "/app/out/main/index.js",
          "function": "readChat",
          "inApp": true,
          "lineno": 120,
        },
      ]
    `);
  });

  it("reads no frame from a message line that says at", () => {
    const stack = [
      "Error: the request failed at step two",
      "with more detail at the end",
      "    at run (/app/out/main/index.js:1:1)",
    ].join("\n");
    expect(parseStack(stack).map((frame) => frame.function)).toEqual(["run"]);
  });

  it(`keeps the ${STACK_FRAME_LIMIT} frames nearest the throw`, () => {
    const lines = Array.from(
      { length: STACK_FRAME_LIMIT + 10 },
      (_, index) => `    at f${index} (/app/out/main/index.js:${index + 1}:1)`,
    );
    const frames = parseStack(["Error: deep", ...lines].join("\n"));
    expect(frames).toHaveLength(STACK_FRAME_LIMIT);
    expect(frames.at(-1)?.function).toBe("f0");
    expect(frames[0]?.function).toBe(`f${STACK_FRAME_LIMIT - 1}`);
  });

  it("cuts a very long line rather than matching all of it", () => {
    const long = `    at ${"a".repeat(5000)} (/app/x.js:1:1)`;
    expect(() => parseStack(long)).not.toThrow();
  });
});
