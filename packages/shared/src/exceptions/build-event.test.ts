import { describe, expect, it } from "vitest";

import { buildExceptionEvent } from "./build-event";
import { formatExceptionEvent } from "./format-event";
import { ForwardedException } from "./forwarded";
import { ExceptionEventSchema } from "./schema";
import { serializeError } from "./serialize-error";

const HOME = "/Users/someone";
const APP = `${HOME}/Applications/Instrument.app/Contents/Resources/app.asar`;

const CONTEXTS = {
  app: { channel: "beta", flavor: "prod", packaged: true, version: "2.0.0" },
  culture: { locale: "en-US", timeZone: "America/New_York" },
  os: { arch: "arm64", platform: "darwin", version: "26.0.0" },
  process: { rssMb: 512, uptimeMs: 60_000 },
  runtime: { chrome: "140.0.0", electron: "39.0.0", node: "24.21.0" },
};

function build(error: unknown, context = {}) {
  return buildExceptionEvent(error, {
    breadcrumbs: [],
    context,
    contexts: CONTEXTS,
    defaultArea: "studio",
    now: Date.UTC(2026, 9, 19, 12),
    paths: { appRoot: APP, home: HOME },
  });
}

function withStack<T extends Error>(error: T, ...frames: string[]): T {
  error.stack = [`${error.name}: ${error.message}`, ...frames].join("\n");
  return error;
}

const appFrame = (fn: string, line: number, file = "out/main/index.js") =>
  `    at ${fn} (${APP}/${file}:${line}:7)`;

describe("buildExceptionEvent", () => {
  it("builds a valid event with frames rewritten to app paths", () => {
    const error = withStack(
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      appFrame("readChat", 120),
      `    at Object.parse (${APP}/node_modules/zod/index.js:4:1)`,
      "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
      `    at ${HOME}/code/scratch.js:1:1`,
    );
    const event = build(error);
    expect(ExceptionEventSchema.parse(event)).toEqual(event);
    expect(event.exceptions[0]?.frames).toMatchInlineSnapshot(`
      [
        {
          "absPath": "~/code/scratch.js",
          "colno": 1,
          "filename": "~/code/scratch.js",
          "function": "?",
          "inApp": true,
          "lineno": 1,
        },
        {
          "absPath": "node:internal/process/task_queues",
          "colno": 5,
          "filename": "node:internal/process/task_queues",
          "function": "process.processTicksAndRejections",
          "inApp": false,
          "lineno": 105,
        },
        {
          "absPath": "~/Applications/Instrument.app/Contents/Resources/app.asar/node_modules/zod/index.js",
          "colno": 1,
          "filename": "app:///node_modules/zod/index.js",
          "function": "Object.parse",
          "inApp": false,
          "lineno": 4,
          "module": "zod",
        },
        {
          "absPath": "~/Applications/Instrument.app/Contents/Resources/app.asar/out/main/index.js",
          "colno": 7,
          "filename": "app:///out/main/index.js",
          "function": "readChat",
          "inApp": true,
          "lineno": 120,
          "module": "out/main/index",
        },
      ]
    `);
    expect(event.exceptions[0]?.rawStack).not.toContain(HOME);
  });

  it("follows a cause chain, deepest first, numbered as Sentry numbers it", () => {
    const root = withStack(
      new Error("ENOENT: no such file"),
      appFrame("read", 3),
    );
    const middle = withStack(
      new Error("Could not load the chat", { cause: root }),
      appFrame("load", 2),
    );
    const top = withStack(
      new Error("Boot failed", { cause: middle }),
      appFrame("boot", 1),
    );
    const event = build(top, { mechanism: "boot" });
    expect(
      event.exceptions.map(({ mechanism, value }) => ({ mechanism, value })),
    ).toMatchInlineSnapshot(`
      [
        {
          "mechanism": {
            "exceptionId": 2,
            "parentId": 1,
            "source": "cause",
            "type": "chained",
          },
          "value": "ENOENT: no such file",
        },
        {
          "mechanism": {
            "exceptionId": 1,
            "parentId": 0,
            "source": "cause",
            "type": "chained",
          },
          "value": "Could not load the chat",
        },
        {
          "mechanism": {
            "exceptionId": 0,
            "type": "boot",
          },
          "value": "Boot failed",
        },
      ]
    `);
  });

  it("takes an AggregateError's errors and a SuppressedError's pair", () => {
    const aggregate = new AggregateError(
      [new RangeError("first"), new SyntaxError("second")],
      "Both failed",
    );
    const suppressed = Object.assign(new Error("Disposal failed"), {
      error: new Error("dispose threw"),
      suppressed: new Error("body threw"),
    });
    expect(
      build(aggregate).exceptions.map(
        ({ mechanism, type }) =>
          `${type} ${mechanism.source ?? "-"} ${String(mechanism.isGroup ?? false)}`,
      ),
    ).toEqual([
      "SyntaxError errors[1] false",
      "RangeError errors[0] false",
      "AggregateError - true",
    ]);
    expect(
      build(suppressed).exceptions.map(({ mechanism }) => mechanism.source),
    ).toEqual(["suppressed", "error", undefined]);
  });

  it("stops following links at ten errors", () => {
    let error = new Error("level 0");
    for (let level = 1; level < 30; level++) {
      error = new Error(`level ${level}`, { cause: error });
    }
    expect(build(error).exceptions).toHaveLength(10);
  });

  it("copies an error's own properties into its data, three levels deep", () => {
    const error = Object.assign(new Error("Request failed"), {
      code: "ECONNRESET",
      response: { body: { error: { detail: { deeper: true } } }, status: 502 },
      retry: () => undefined,
    });
    expect(build(error).exceptions[0]?.data).toMatchInlineSnapshot(`
      {
        "code": "ECONNRESET",
        "response": {
          "body": {
            "error": "[Object]",
          },
          "status": 502,
        },
        "retry": "[Function: retry]",
      }
    `);
  });

  it("makes a synthetic exception from a value that is not an Error", () => {
    const event = build({ reason: "quota", status: 429 });
    const [exception] = event.exceptions;
    expect({
      data: exception?.data,
      mechanism: exception?.mechanism,
      value: exception?.value,
    }).toMatchInlineSnapshot(`
      {
        "data": {
          "__serialized__": {
            "reason": "quota",
            "status": 429,
          },
        },
        "mechanism": {
          "exceptionId": 0,
          "synthetic": true,
          "type": "generic",
        },
        "value": "Object captured as exception with keys: reason, status",
      }
    `);
    // The stack starts where it was captured, not inside the capture.
    expect(exception?.frames.at(-1)?.function).not.toMatch(/serializeError/);
    expect(build("plain words").exceptions[0]?.value).toBe("plain words");
    expect(build(42).exceptions[0]?.value).toBe(
      "Non-Error exception captured with value: 42",
    );
  });

  it("puts the caller's context and data on the event", () => {
    const event = build(new Error("x"), {
      area: "llm-request",
      chatId: "chat_1",
      data: { attempt: 2, path: `${HOME}/notes.md` },
      handled: false,
      mechanism: "unhandledRejection",
      toolName: "bash",
    });
    expect({
      area: event.area,
      context: event.context,
      data: event.data,
      handled: event.handled,
      mechanism: event.mechanism,
    }).toMatchInlineSnapshot(`
      {
        "area": "llm-request",
        "context": {
          "chatId": "chat_1",
          "toolName": "bash",
        },
        "data": {
          "attempt": 2,
          "path": "~/notes.md",
        },
        "handled": false,
        "mechanism": "unhandledRejection",
      }
    `);
  });

  it("reads a forwarded exception as the process that threw it", () => {
    const serialized = serializeError(
      withStack(new Error("worker threw"), appFrame("exec", 9)),
    );
    const event = build(new ForwardedException(serialized, "bash-worker"));
    expect(event.process).toBe("bash-worker");
    expect(event.exceptions[0]?.value).toBe("worker threw");
  });

  describe("fingerprint", () => {
    const throwAt = (line: number, message = "boom") =>
      withStack(
        new TypeError(message),
        appFrame("readChat", line),
        appFrame("loadChats", line + 40),
      );

    it("stays the same when line numbers move", () => {
      expect(build(throwAt(10)).fingerprint).toBe(
        build(throwAt(99)).fingerprint,
      );
    });

    it("stays the same when the message changes", () => {
      expect(build(throwAt(10, "id 1")).fingerprint).toBe(
        build(throwAt(10, "id 2")).fingerprint,
      );
    });

    it("stays the same when a bundle's chunk hash changes", () => {
      const inChunk = (hash: string) =>
        withStack(
          new TypeError("boom"),
          appFrame("render", 1, `out/renderer/assets/index-${hash}.js`),
        );
      expect(build(inChunk("Bx1_c9Qz")).fingerprint).toBe(
        build(inChunk("Ka8-2mPw")).fingerprint,
      );
    });

    it("differs by the function that threw", () => {
      const other = withStack(new TypeError("boom"), appFrame("writeChat", 10));
      expect(build(throwAt(10)).fingerprint).not.toBe(build(other).fingerprint);
    });

    it("reads the deepest cause, so one root under two wrappers groups", () => {
      const root = () =>
        withStack(new Error("ENOENT"), appFrame("readFile", 5));
      const a = new Error("Loading failed", { cause: root() });
      const b = new Error("Saving failed", { cause: root() });
      expect(build(a).fingerprint).toBe(build(b).fingerprint);
    });

    it("falls back to the message, numbers left out, with no in-app frame", () => {
      const noFrames = (message: string) => {
        const error = new Error(message);
        error.stack = `Error: ${message}`;
        return error;
      };
      expect(build(noFrames("ENOENT: open 12")).fingerprint).toBe(
        build(noFrames("ENOENT: open 13")).fingerprint,
      );
      expect(build(noFrames("ENOENT")).fingerprint).not.toBe(
        build(noFrames("EACCES")).fingerprint,
      );
    });
  });
});

describe("formatExceptionEvent", () => {
  it("reads like a V8 stack, the captured error first", () => {
    const root = withStack(
      new Error("ENOENT: no such file"),
      appFrame("read", 3),
    );
    const top = withStack(
      Object.assign(new Error("Could not load the chat", { cause: root }), {
        code: "LOAD_FAILED",
      }),
      appFrame("load", 2),
      appFrame("boot", 1),
    );
    const event = buildExceptionEvent(top, {
      breadcrumbs: [
        {
          category: "rpc",
          level: "info",
          message: "chats.list ok 12ms",
          timestamp: Date.UTC(2026, 9, 19, 11, 59),
        },
      ],
      context: { chatId: "chat_1", rpcPath: "chats.open" },
      contexts: CONTEXTS,
      defaultArea: "studio",
      now: Date.UTC(2026, 9, 19, 12),
      paths: { appRoot: APP, home: HOME },
    });
    expect(formatExceptionEvent(event).replace(event.fingerprint, "<fp>"))
      .toMatchInlineSnapshot(`
        "[studio, generic, handled, error, main] 2026-10-19T12:00:00.000Z, fingerprint <fp>
        Error: Could not load the chat
          at load (app:///out/main/index.js:2:7)
          at boot (app:///out/main/index.js:1:7)
          data: {"code":"LOAD_FAILED"}
        Caused by: Error: ENOENT: no such file
          at read (app:///out/main/index.js:3:7)
        Context: chatId=chat_1, rpcPath=chats.open
        Breadcrumbs:
          2026-10-19T11:59:00.000Z [rpc] info: chats.list ok 12ms"
      `);
  });
});

describe("what an event leaves out", () => {
  it("takes secrets and web addresses' queries out of messages and data", () => {
    const token = `lin_api_${"aB3dE5gH7j".repeat(4)}`;
    const event = buildExceptionEvent(
      new Error(`401 from api.linear.app, token ${token} was rejected`),
      {
        breadcrumbs: [
          {
            category: "log",
            data: {
              url: "https://accounts.example.com/callback?code=4/0AVG7&state=x9",
            },
            level: "error",
            message: `electron: Failed to load URL: https://sync.example.com/start?uid=0f93d1df in ${HOME}/Library`,
            timestamp: 0,
          },
        ],
        contexts: CONTEXTS,
        defaultArea: "studio",
        now: Date.UTC(2026, 9, 19, 12),
        paths: { appRoot: APP, home: HOME },
      },
    );
    expect({
      breadcrumb: event.breadcrumbs[0],
      value: event.exceptions.at(-1)?.value,
    }).toMatchInlineSnapshot(`
      {
        "breadcrumb": {
          "category": "log",
          "data": {
            "url": "https://accounts.example.com/callback?[query]",
          },
          "level": "error",
          "message": "electron: Failed to load URL: https://sync.example.com/start?[query] in ~/Library",
          "timestamp": 0,
        },
        "value": "401 from api.linear.app, token [secret: Linear key] was rejected",
      }
    `);
  });
});

describe("a Windows home folder", () => {
  it("reads as ~ however a message spells it", () => {
    const event = buildExceptionEvent(
      new Error(
        "Failed at file:///C:/Users/sam/AppData/Local/x.js, opening C:\\Users\\sam\\notes.md from /c/Users/sam/chat",
      ),
      {
        breadcrumbs: [],
        contexts: CONTEXTS,
        defaultArea: "studio",
        now: Date.UTC(2026, 9, 19, 12),
        paths: { home: "C:\\Users\\sam" },
      },
    );
    expect(event.exceptions.at(-1)?.value).toMatchInlineSnapshot(
      `"Failed at file:///~/AppData/Local/x.js, opening ~\\notes.md from ~/chat"`,
    );
  });

  it("leaves no part of a home with a space or accent in the raw stack", () => {
    const error = new Error("boom");
    error.stack = [
      "Error: boom",
      "    at render (file:///C:/Users/Jos%C3%A9%20Garc%C3%ADa/AppData/Local/x.js:1:2)",
    ].join("\n");
    const event = buildExceptionEvent(error, {
      breadcrumbs: [],
      contexts: CONTEXTS,
      defaultArea: "studio",
      now: Date.UTC(2026, 9, 19, 12),
      paths: { home: "C:\\Users\\José García" },
    });
    expect(event.exceptions.at(-1)?.rawStack).toMatchInlineSnapshot(`
      "Error: boom
          at render (file:///~/AppData/Local/x.js:1:2)"
    `);
  });
});
