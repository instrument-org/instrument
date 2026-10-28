import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildExceptionEvent,
  type ExceptionEvent,
} from "@instrument-org/shared/exceptions";

import { type EndedSession } from "./problem-reports";

// Loaded fresh for each test, so its store opens in that test's folder.
let reports: typeof import("./problem-reports");

const { electronApp, preferences, publish, signedIn, stored, userData } =
  vi.hoisted(() => ({
    electronApp: { isPackaged: true },
    preferences: { sendErrorReportsAutomatically: false },
    publish: vi.fn(),
    signedIn: {
      later: [] as { email: string; name?: string }[],
      now: [{ email: "sam.rivera@example.com", name: "Sam Rivera" }] as {
        email: string;
        name?: string;
      }[],
      unknownAccount: false,
    },
    stored: { events: [] as ExceptionEvent[] },
    userData: { dir: "" },
  }));

vi.mock("./exception-store", () => ({
  listExceptionEvents: () => stored.events,
}));

vi.mock("@instrument-org/workspace/electron", () => ({
  chatDir: () => {
    throw new Error("No chat in these tests");
  },
  chatIds: () => [],
  chatSessions: () => Promise.resolve([]),
  chatStartedWithApp: () => Promise.resolve(undefined),
  listMemories: () => Promise.resolve([]),
  memoryDir: () => "/no-memory",
}));

// `now` is who is known without asking, `later` who asking adds.
vi.mock("@/electron-main/lib/get-signed-in-user", () => ({
  knownSignedInPeople: () => signedIn.now,
  signedInPeople: () =>
    Promise.resolve({
      people: [...signedIn.now, ...signedIn.later],
      unknownAccount: signedIn.unknownAccount,
    }),
}));

vi.mock("electron", () => ({
  app: {
    getPath: () => userData.dir,
    getVersion: () => "2.0.5",
    get isPackaged() {
      return electronApp.isPackaged;
    },
  },
}));
vi.mock("@/electron-main/rpc/publisher", () => ({ publisher: { publish } }));
vi.mock("@/electron-main/stores/machine/preferences", () => ({
  getMachinePreferences: () => ({
    get: (key: keyof typeof preferences) => preferences[key],
  }),
}));
vi.mock("@/electron-main/platform-api/base-url", () => ({
  platformApiBaseUrl: () => "https://api.example.test",
}));
vi.mock("@/electron-main/platform-api/headers", () => ({
  getPlatformApiHeaders: () => ({}),
}));
vi.mock("./electron-logger", () => ({
  createScopedLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  // No log in tests, as in development.
  getMainLogFilePath: () => path.join(userData.dir, "logs", "main.log"),
}));

// Electron adds this to Node's process, and these tests run in plain Node.
Object.assign(process, { getSystemVersion: () => "26.1" });

const THROW = [
  "2026-10-09T16:12:04.000Z uncaughtException: Error: EPIPE: broken pipe, write",
  "    at afterWriteDispatched (node:internal/stream_base_commons:161:15)",
  "    at send (/Applications/Instrument.app/Contents/Resources/app.asar/out/main/mac-native-Bq3k9xZa.js:1:18234)",
].join("\n");

const APP = "/Applications/Instrument.app/Contents/Resources/app.asar";

/** The event an uncaught throw leaves in the crash record. */
const crashEvent = (stack = THROW, message = "EPIPE: broken pipe, write") =>
  buildExceptionEvent(
    Object.assign(new Error(message), {
      stack: stack.replace(/^\S+ uncaughtException: /, ""),
    }),
    {
      breadcrumbs: [],
      context: { handled: false, mechanism: "uncaughtException" },
      contexts: {
        app: {
          channel: "latest",
          flavor: "release",
          packaged: true,
          version: "2.0.4",
        },
        culture: { locale: "en-US", timeZone: "UTC" },
        os: { arch: "arm64", platform: "darwin", version: "26.1" },
        process: { rssMb: 400, uptimeMs: 1000 },
        runtime: { chrome: "1", electron: "1", node: "1" },
      },
      defaultArea: "studio",
      paths: { appRoot: APP },
    },
  );

const ended = (overrides: Partial<EndedSession>) =>
  reports.recordEndedSession({
    crashRecord: undefined,
    dumps: 0,
    endedAt: 1_000,
    previousVersion: "2.0.4",
    unclean: true,
    ...overrides,
  });

describe("problem reports", () => {
  beforeEach(async () => {
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "problem-reports-"));
    vi.resetModules();
    reports = await import("./problem-reports");
    electronApp.isPackaged = true;
    return () => {
      signedIn.later = [];
      signedIn.unknownAccount = false;
      preferences.sendErrorReportsAutomatically = false;
      vi.unstubAllGlobals();
      fs.rmSync(userData.dir, { force: true, recursive: true });
    };
  });

  it("leaves a session that exited normally out of the bell, whatever it survived", () => {
    ended({ crashRecord: crashEvent(), dumps: 2, unclean: false });

    expect(reports.listPendingProblems()).toEqual([]);
  });

  it("calls a session that never exited with a throw on record a crash, titled by the throw", () => {
    ended({ crashRecord: crashEvent() });

    const [problem] = reports.listPendingProblems();
    expect(problem).toMatchObject({
      count: 1,
      kind: "crash",
      title: "Error: EPIPE: broken pipe, write",
    });
    expect(problem?.details).toContain("appVersion: 2.0.4");
    expect(problem?.details).toContain(
      "ended: crashed after an uncaught error",
    );
  });

  it("calls a session that never exited with only a crash dump a crash", () => {
    ended({ dumps: 1 });

    expect(reports.listPendingProblems()[0]).toMatchObject({
      kind: "crash",
      title: "Instrument quit unexpectedly",
    });
  });

  it("calls a session that never exited with nothing on record a hang", () => {
    ended({});

    expect(reports.listPendingProblems()[0]).toMatchObject({
      kind: "hang",
      title: "Instrument didn't close properly",
    });
  });

  it("leaves a hang out of the bell in development, where stopping the dev server ends every session", () => {
    electronApp.isPackaged = false;
    ended({});
    ended({ dumps: 1 });

    expect(reports.listPendingProblems()).toMatchObject([{ kind: "crash" }]);
  });

  it("counts the same crash again instead of listing it twice", () => {
    ended({ crashRecord: crashEvent(), endedAt: 1_000 });
    ended({
      crashRecord: crashEvent(
        THROW.replace("1:18234", "1:18990").replace("Bq3k9xZa", "Lm22pQrT"),
      ),
      endedAt: 2_000,
    });

    expect(reports.listPendingProblems()).toMatchObject([
      { count: 2, firstAt: 1_000, lastAt: 2_000 },
    ]);
  });

  it("takes a problem off the list once it's sent or dismissed", () => {
    ended({});
    const [problem] = reports.listPendingProblems();

    reports.clearPendingProblem(problem?.fingerprint ?? "");

    expect(reports.listPendingProblems()).toEqual([]);
    expect(publish).toHaveBeenCalledWith("problems.updated", null);
  });

  it("carries the crash's event first, then the other recent problems", () => {
    const other = crashEvent(
      "x: y\n    at render (/Applications/Instrument.app/Contents/Resources/app.asar/out/main/index.js:1:1)",
      "Cannot render",
    );
    stored.events = [other];
    const crash = crashEvent();

    ended({ crashRecord: crash });

    const [problem] = reports.listPendingProblems();
    expect(problem?.fingerprint).toBe(`crash:${crash.fingerprint}`);
    expect(problem?.events?.map((event) => event.id)).toEqual([
      crash.id,
      other.id,
    ]);
    expect(problem?.details).toContain(
      "The error:\n[studio, uncaughtException, unhandled",
    );
    expect(problem?.details).toContain("Another recent error:");
    expect(problem?.details).toContain("Error: Cannot render");
    stored.events = [];
  });

  it("leaves out the oldest events until the report fits", () => {
    const huge = (index: number) => ({
      ...crashEvent(THROW, `big ${index}`),
      data: { blob: "x".repeat(400_000) },
      fingerprint: `fp${index}`,
      lastAt: index,
    });
    stored.events = [1, 2, 3, 4, 5, 6].map(huge);

    const { details, events } = reports.describeProblem({
      surface: "help-menu",
    });

    // Each is in the details and in the events, so two of the six fit.
    expect(events.map((event) => event.lastAt)).toEqual([6, 5]);
    expect(Buffer.byteLength(JSON.stringify({ details, events }))).toBeLessThan(
      2_000_000,
    );
    stored.events = [];
  });

  it("writes the home folder as ~ in what it sends", () => {
    const event = crashEvent(
      THROW,
      `ENOENT: open '${os.homedir()}/Documents/notes.md'`,
    );
    const { details } = reports.describeProblem({
      lead: event,
      surface: "route-error",
    });

    expect(details).toContain("ENOENT: open '~/Documents/notes.md'");
    expect(details).not.toContain(os.homedir());
  });

  it("takes the person and any secret out of the details and the events", () => {
    const token = `ghp_${"aB3dE5gH7j".repeat(3)}aB3dE5`;
    const event = crashEvent(
      THROW,
      `Sync for Sam Rivera <sam.rivera@example.com> failed with ${token}`,
    );
    const { details, events } = reports.describeProblem({
      lead: event,
      surface: "route-error",
    });

    const expected =
      "Sync for [name] <[email]> failed with [secret: GitHub token]";
    expect(details).toContain(expected);
    expect(events[0]?.exceptions.at(-1)?.value).toBe(expected);
  });

  it("takes an account learned after launch out of a waiting problem, in what the bell shows", async () => {
    const message = "Sync for Robin Okafor <robin@example.org> failed";
    ended({ crashRecord: crashEvent(THROW, message) });
    // Recorded before the account was known, so it is still there on disk.
    expect(reports.listPendingProblems()[0]?.details).toContain(
      "robin@example.org",
    );

    signedIn.later = [{ email: "robin@example.org", name: "Robin Okafor" }];
    const [shown] = await reports.pendingProblemsAsShown();

    const expected = "Sync for [name] <[email]> failed";
    expect(shown?.details).toContain(expected);
    expect(shown?.details).not.toContain("robin");
    expect(shown?.title).toBe(`Error: ${expected}`);
    expect(shown?.events?.[0]?.exceptions.at(-1)?.value).toBe(expected);
  });

  it("sends a waiting problem automatically as the bell would show it", async () => {
    const send = vi.fn((_url: URL, _init: RequestInit) =>
      Promise.resolve(Response.json({ id: "r1" })),
    );
    vi.stubGlobal("fetch", send);
    preferences.sendErrorReportsAutomatically = true;
    ended({
      crashRecord: crashEvent(THROW, "Sync for robin@example.org failed"),
    });
    signedIn.later = [{ email: "robin@example.org" }];

    await reports.sendPendingAutomatically();

    const body = send.mock.calls[0]?.[1].body;
    expect(typeof body).toBe("string");
    expect(body).toContain("Sync for [email] failed");
    expect(body).not.toContain("robin@example.org");
    expect(reports.listPendingProblems()).toEqual([]);
  });

  it("holds a problem back from sending automatically while the account is unknown", async () => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    preferences.sendErrorReportsAutomatically = true;
    signedIn.unknownAccount = true;
    ended({ crashRecord: crashEvent() });

    await reports.sendPendingAutomatically();

    expect(send).not.toHaveBeenCalled();
    expect(reports.listPendingProblems()).toHaveLength(1);
  });
});

const OWN = "ses_01JB2W0000000000000000000A";
const TASK = "ses_01JB2W0000000000000000000B";

describe("feedback", () => {
  beforeEach(async () => {
    vi.resetModules();
    reports = await import("./problem-reports");
  });

  const file = (name: string, content = `${name}\n`) => ({ content, name });

  // The trail before an error is every log line and call, which read as a
  // log of everything the person did under "Recent errors".
  it("keeps only the warnings and failures in a recent error's trail", () => {
    const crumb = (level: string, message: string) => ({
      category: "rpc",
      level,
      message,
      timestamp: 1,
    });
    const event = {
      ...crashEvent(),
      breadcrumbs: [
        crumb("info", "chats.list ok"),
        crumb("warn", "slow read"),
        crumb("error", "chats.get failed: gone"),
      ],
    };
    expect(
      reports
        .withProblemBreadcrumbs(event)
        .breadcrumbs.map((each) => each.message),
    ).toEqual(["slow read", "chats.get failed: gone"]);
  });

  it("lays a chat's records out as its folder, a session per item and its settings last", () => {
    const items = reports.chatFeedbackItems({
      files: [
        file("state.mac1.json"),
        file(`${TASK}.mac1.jsonl`),
        file(`${OWN}.mac1.jsonl`),
        file(`${OWN}.win1.jsonl`),
        file("settings.mac1.jsonl"),
        file("handoff-notes.md"),
        // A sync engine's copy, and what is not a record, stay home.
        file(`${OWN}.mac1 2.jsonl`),
        file("CHAT.md"),
        file("chat.db"),
      ],
      sessions: [
        { id: OWN, title: "Help desk pricing" },
        { id: TASK, parentId: OWN, title: "Competitor pricing pages" },
      ],
    });

    expect(
      items.map(({ files, id, kind, label }) => ({
        files: files.map((each) => each.path),
        id,
        kind,
        label,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "files": [
            "chat/ses_01JB2W0000000000000000000A.mac1.jsonl",
            "chat/ses_01JB2W0000000000000000000A.win1.jsonl",
          ],
          "id": "session:ses_01JB2W0000000000000000000A",
          "kind": "chat",
          "label": "Help desk pricing",
        },
        {
          "files": [
            "chat/ses_01JB2W0000000000000000000B.mac1.jsonl",
          ],
          "id": "session:ses_01JB2W0000000000000000000B",
          "kind": "task",
          "label": "Task: Competitor pricing pages",
        },
        {
          "files": [
            "chat/state.mac1.json",
            "chat/settings.mac1.jsonl",
            "chat/handoff-notes.md",
          ],
          "id": "chat-settings",
          "kind": "settings",
          "label": "Chat settings",
        },
      ]
    `);
    expect(items[0]?.bytes).toBe(
      Buffer.byteLength(JSON.stringify(items[0]?.files[0])) +
        Buffer.byteLength(JSON.stringify(items[0]?.files[1])) +
        2,
    );
  });

  const item = (
    id: string,
    files: { content: string; path: string }[],
    events?: ExceptionEvent[],
  ) => ({
    bytes: 0,
    events,
    files,
    id,
    kind: "chat" as const,
    label: id,
  });

  const input = (items: ReturnType<typeof item>[]) =>
    reports.feedbackReportInput({
      items,
      note: "It never checked the per-resolution price.",
      surface: "chat-menu",
      title: "It never checked the per-resolution price.",
    });

  it("sends the items' files and events, with no details", () => {
    const sent = input([
      item("chat", [{ content: "{}\n", path: `chat/${OWN}.mac1.jsonl` }]),
      item("errors", [], [crashEvent()]),
    ]);

    expect(sent).toMatchObject({
      automatic: false,
      files: [{ path: `chat/${OWN}.mac1.jsonl` }],
      kind: "feedback",
    });
    expect(sent.events).toHaveLength(1);
    expect(sent).not.toHaveProperty("details");
  });

  it("trims the log from its top, in whole lines, before anything else", () => {
    const line = (index: number) =>
      `${String(index).padStart(6, "0")} ${"x".repeat(1000)}\n`;
    const log = Array.from({ length: 1500 }, (_, index) => line(index)).join(
      "",
    );
    const chat = "y".repeat(800_000);
    const sent = input([
      item("chat", [{ content: chat, path: `chat/${OWN}.mac1.jsonl` }]),
      item("errors", [], [crashEvent()]),
      item("log", [{ content: log, path: reports.FEEDBACK_LOG_PATH }]),
    ]);

    const trimmed = sent.files?.find(
      (each) => each.path === reports.FEEDBACK_LOG_PATH,
    )?.content;
    expect(Buffer.byteLength(JSON.stringify(sent))).toBeLessThanOrEqual(
      2_000_000,
    );
    expect(trimmed).toMatch(/^\d{6} x+\n/);
    expect(trimmed?.endsWith(line(1499))).toBe(true);
    expect(log.endsWith(trimmed ?? "-")).toBe(true);
    expect(trimmed?.length).toBeLessThan(log.length);
    expect(sent.events).toHaveLength(1);
    expect(
      sent.files?.find((each) => each.path.startsWith("chat/"))?.content,
    ).toBe(chat);
  });

  it("drops the oldest errors once the log is gone", () => {
    const huge = (index: number) => ({
      ...crashEvent(THROW, `big ${index}`),
      data: { blob: "x".repeat(400_000) },
      fingerprint: `fp${index}`,
      lastAt: index,
    });
    const sent = input([
      item("chat", [{ content: "y".repeat(500_000), path: "chat/a.jsonl" }]),
      item("errors", [], [1, 2, 3, 4, 5].map(huge)),
      item("log", [
        { content: "z\n".repeat(1000), path: reports.FEEDBACK_LOG_PATH },
      ]),
    ]);

    expect(sent.files?.map((each) => each.path)).toEqual(["chat/a.jsonl"]);
    expect(sent.events?.map((event) => event.lastAt)).toEqual([5, 4, 3]);
  });

  it("refuses a chat too big to send rather than cutting it short", () => {
    expect(() =>
      input([
        item("chat", [
          { content: "y".repeat(2_100_000), path: "chat/a.jsonl" },
        ]),
      ]),
    ).toThrow(reports.FeedbackTooLargeError);
  });
});

describe("feedback images", () => {
  beforeEach(async () => {
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "problem-reports-"));
    vi.resetModules();
    reports = await import("./problem-reports");
    return () => {
      fs.rmSync(userData.dir, { force: true, recursive: true });
    };
  });

  const PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2,
  ]);

  it("sends JSON alone when there are no images", () => {
    const { body, headers } = reports.reportRequestBody('{"a":1}', []);
    expect(body).toBe('{"a":1}');
    expect(headers["content-type"]).toBe("application/json");
  });

  it("sends the report part and each image part as multipart", async () => {
    const { body, headers } = reports.reportRequestBody('{"kind":"feedback"}', [
      { bytes: PNG, name: "limit note.png", type: "image/png" },
      { bytes: PNG, name: "second.png", type: "image/png" },
    ]);
    // `fetch` sets the multipart type with its boundary.
    expect(headers).not.toHaveProperty("content-type");
    const request = new Request("http://reports.test/reports", {
      body,
      method: "POST",
    });
    expect(request.headers.get("content-type")).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    const form = await request.formData();
    expect(form.get("report")).toBe('{"kind":"feedback"}');
    const parts = form.getAll("image").filter((part) => part instanceof File);
    expect(parts.map((part) => [part.name, part.type, part.size])).toEqual([
      ["limit note.png", "image/png", PNG.length],
      ["second.png", "image/png", PNG.length],
    ]);
    const first = parts[0];
    expect(first && new Uint8Array(await first.arrayBuffer())).toEqual(PNG);
  });

  it("reads the images' types from their bytes", async () => {
    const images = await reports.readFeedbackImages([
      { data: new Blob([PNG], { type: "application/pdf" }), name: "a.png" },
    ]);
    expect(images.map(({ name, type }) => [name, type])).toEqual([
      ["a.png", "image/png"],
    ]);
  });

  it("refuses what the dialog would have left out", async () => {
    await expect(
      reports.readFeedbackImages([
        {
          data: new Blob(["%PDF-1.7"], { type: "image/png" }),
          name: "notes.pdf",
        },
      ]),
    ).rejects.toThrow(
      "“notes.pdf” isn't an image, so we left it out. You can attach PNG, JPEG, WebP or GIF.",
    );
    await expect(
      reports.readFeedbackImages(
        Array.from({ length: 5 }, (_, index) => ({
          data: new Blob([PNG]),
          name: `${index}.png`,
        })),
      ),
    ).rejects.toThrow(reports.FeedbackImageRefusedError);
  });
});
