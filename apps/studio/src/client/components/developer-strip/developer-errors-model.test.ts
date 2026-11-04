import { type ExceptionEvent } from "@instrument-org/shared/exceptions";
import { describe, expect, it } from "vitest";

import {
  frameLocation,
  recentBreadcrumbs,
  splitFrames,
  timesLabel,
  whereOf,
} from "./developer-errors-model";

type Frame = ExceptionEvent["exceptions"][number]["frames"][number];

const frame = (name: string, inApp: boolean, lineno?: number): Frame => ({
  absPath: `~/app/src/${name}.tsx`,
  filename: `app:///src/client/${name}.tsx`,
  function: name,
  inApp,
  lineno,
});

function eventWith(overrides: Partial<ExceptionEvent> = {}): ExceptionEvent {
  // Only the fields these readers touch; the rest of an event is not read here.
  return {
    area: "studio",
    breadcrumbs: [],
    context: {},
    count: 1,
    exceptions: [
      {
        frames: [
          frame("react", false),
          frame("list", true, 88),
          frame("row", true, 142),
        ],
        mechanism: { exceptionId: 0, type: "generic" },
        rawStack: "",
        type: "TypeError",
        value: "chat.title is not a function",
      },
    ],
    ...overrides,
  } as ExceptionEvent;
}

describe("splitFrames", () => {
  it("puts the frame that threw first, the app's own apart from the rest", () => {
    const [captured] = eventWith().exceptions;
    if (!captured) {
      throw new Error("no exception");
    }
    const { app, library } = splitFrames(captured);
    expect(app.map(frameLocation)).toEqual(["row.tsx:142", "list.tsx:88"]);
    expect(library.map((each) => each.function)).toEqual(["react"]);
  });
});

describe("whereOf", () => {
  it.each([
    [
      "the call it answered",
      { context: { rpcPath: "chats.list" } },
      "chats.list",
    ],
    ["the app's frame that threw", {}, "row.tsx:142"],
    [
      "the area when no frame is the app's",
      {
        exceptions: [
          {
            frames: [frame("react", false)],
            mechanism: { exceptionId: 0, type: "generic" },
            rawStack: "",
            type: "Error",
            value: "boom",
          },
        ],
      },
      "studio",
    ],
  ])("names %s", (_name, overrides, expected) => {
    expect(whereOf(eventWith(overrides))).toBe(expected);
  });
});

describe("recentBreadcrumbs", () => {
  it("runs newest first and leaves out logged exceptions", () => {
    const crumb = (message: string) => ({
      category: "log",
      level: "info",
      message,
      timestamp: 0,
    });
    const event = eventWith({
      breadcrumbs: [
        crumb("first"),
        crumb("[Exception] [studio] a whole event"),
        crumb("second"),
      ],
    });
    expect(recentBreadcrumbs(event).map((each) => each.message)).toEqual([
      "second",
      "first",
    ]);
  });
});

describe("timesLabel", () => {
  it.each([
    [1, "once"],
    [12, "12 times"],
  ])("says %i as %s", (count, label) => {
    expect(timesLabel(count)).toBe(label);
  });
});
