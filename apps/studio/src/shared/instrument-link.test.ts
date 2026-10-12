import { describe, expect, it } from "vitest";

import {
  filePathOfInstrumentLink,
  instrumentLinkOf,
  instrumentUrlOf,
} from "./instrument-link";

describe("instrumentLinkOf", () => {
  it.each([
    [
      "instrument://task/ses_01J9TASK",
      {
        href: "/tasks/ses_01J9TASK",
        kind: "task",
        name: "ses_01J9TASK",
      },
    ],
    [
      "instrument://chat/ses_01J9",
      {
        href: "/chats/ses_01J9",
        kind: "chat",
        name: "ses_01J9",
      },
    ],
    [
      "instrument://thread/ses_01J9",
      {
        href: "/chats/ses_01J9",
        kind: "chat",
        name: "ses_01J9",
      },
    ],
    [
      "instrument://memory/no-stevia",
      {
        href: "/memory/no-stevia",
        kind: "memory",
        name: "no-stevia",
      },
    ],
    [
      "instrument://app/linear",
      { href: "/apps/linear", kind: "app", name: "linear" },
    ],
    [
      "instrument://skill/create-page",
      {
        href: "/skills/create-page",
        kind: "skill",
        name: "create-page",
      },
    ],
    [
      "instrument://skill/instrument:create-page",
      {
        href: "/skills/instrument:create-page",
        kind: "skill",
        name: "instrument:create-page",
      },
    ],
    [
      "instrument://settings/zoom",
      { href: "/settings/zoom", kind: "settings", name: "zoom" },
    ],
    [
      "instrument://settings/provider:openai-1",
      {
        href: "/settings/provider:openai-1",
        kind: "settings",
        name: "provider:openai-1",
      },
    ],
    [
      "instrument://screen/shortcuts",
      { href: "/screen/shortcuts", kind: "screen", name: "shortcuts" },
    ],
    [
      "INSTRUMENT://Task/ses_01J9TASK",
      {
        href: "/tasks/ses_01J9TASK",
        kind: "task",
        name: "ses_01J9TASK",
      },
    ],
  ])("reads %s", (url, expected) => {
    expect(instrumentLinkOf(url)).toEqual(expected);
  });

  it.each([
    ["a task with no id", "instrument://task"],
    ["a name with a path under it", "instrument://task/ses_01J9TASK/files"],
    ["a name with characters no name has", "instrument://memory/no%20stevia"],
    ["a noun the app has no screen for", "instrument://topic/general"],
    ["the file channel", "instrument://computer-abc123/Users/me/notes.md"],
    ["a web address", "https://instrument.page/task/ses_01J9TASK"],
    ["a path", "work/report.md"],
    ["nothing", ""],
  ])("names nothing for %s", (_case, url) => {
    expect(instrumentLinkOf(url)).toBeUndefined();
  });
});

describe("instrumentUrlOf", () => {
  it.each([
    ["/tasks/ses_01J9TASK", "instrument://task/ses_01J9TASK"],
    ["/chats/ses_01J9", "instrument://chat/ses_01J9"],
    ["/memory/no-stevia", "instrument://memory/no-stevia"],
    ["/apps/linear", "instrument://app/linear"],
    ["/skills/create-page", "instrument://skill/create-page"],
    [
      "/skills/instrument%3Acreate-page",
      "instrument://skill/instrument:create-page",
    ],
    ["/chats/ses_01J9?tab=1", "instrument://chat/ses_01J9"],
  ])("writes %s as %s", (href, url) => {
    expect(instrumentUrlOf(href)).toBe(url);
  });

  it.each([
    ["the tasks as a whole", "/tasks"],
    ["the apps as a whole", "/apps"],
    ["a screen with no noun", "/activity"],
    ["the new tab", "/new-tab"],
    ["a thing under a thing", "/tasks/ses_01J9TASK/files"],
  ])("writes nothing for %s", (_case, href) => {
    expect(instrumentUrlOf(href)).toBeUndefined();
  });

  it("reads back what it wrote", () => {
    const href = "/skills/create-page";
    expect(instrumentLinkOf(instrumentUrlOf(href) ?? "")?.href).toBe(href);
  });
});

describe("filePathOfInstrumentLink", () => {
  it.each([
    [
      "instrument://file//mnt/Journal/2026-09-23.md",
      "/mnt/Journal/2026-09-23.md",
    ],
    [
      "instrument://file/mnt/Journal/2026-09-23.md",
      "/mnt/Journal/2026-09-23.md",
    ],
    ["instrument://File/mnt/My%20Notes/a.md", "/mnt/My Notes/a.md"],
    ["instrument://file/", undefined],
    ["instrument://chat/ses_01", undefined],
    ["https://file/mnt/a.md", undefined],
  ])("%s", (url, path) => {
    expect(filePathOfInstrumentLink(url)).toBe(path);
  });
});
