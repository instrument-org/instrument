import { describe, expect, it } from "vitest";

import {
  filePathOfInstrumentLink,
  instrumentLinkOf,
  instrumentUrlOf,
} from "./instrument-link";

describe("instrumentLinkOf", () => {
  it.each([
    [
      "instrument://task/lisbon-hotel",
      {
        href: "/orchestrator/tasks/lisbon-hotel",
        kind: "task",
        name: "lisbon-hotel",
      },
    ],
    [
      "instrument://thread/ses_01J9",
      {
        href: "/orchestrator/threads/ses_01J9",
        kind: "thread",
        name: "ses_01J9",
      },
    ],
    [
      "instrument://memory/no-stevia",
      {
        href: "/orchestrator/memory/no-stevia",
        kind: "memory",
        name: "no-stevia",
      },
    ],
    [
      "instrument://app/linear",
      { href: "/orchestrator/apps/linear", kind: "app", name: "linear" },
    ],
    [
      "instrument://skill/create-page",
      {
        href: "/orchestrator/skills/create-page",
        kind: "skill",
        name: "create-page",
      },
    ],
    [
      "instrument://skill/instrument:create-page",
      {
        href: "/orchestrator/skills/instrument:create-page",
        kind: "skill",
        name: "instrument:create-page",
      },
    ],
    [
      "instrument://discover/timeline",
      { href: "/orchestrator/ideas/timeline", kind: "idea", name: "timeline" },
    ],
    [
      "instrument://discover",
      { href: "/orchestrator/ideas", kind: "ideas", name: "" },
    ],
    [
      "instrument://discover/",
      { href: "/orchestrator/ideas", kind: "ideas", name: "" },
    ],
    [
      "INSTRUMENT://Task/lisbon-hotel",
      {
        href: "/orchestrator/tasks/lisbon-hotel",
        kind: "task",
        name: "lisbon-hotel",
      },
    ],
  ])("reads %s", (url, expected) => {
    expect(instrumentLinkOf(url)).toEqual(expected);
  });

  it.each([
    ["a task with no id", "instrument://task"],
    ["a name with a path under it", "instrument://task/lisbon-hotel/files"],
    ["a name with characters no name has", "instrument://memory/no%20stevia"],
    ["a noun the app has no screen for", "instrument://settings/general"],
    ["the file channel", "instrument://computer-abc123/Users/me/notes.md"],
    ["a web address", "https://instrument.page/task/lisbon-hotel"],
    ["a path", "work/report.md"],
    ["nothing", ""],
  ])("names nothing for %s", (_case, url) => {
    expect(instrumentLinkOf(url)).toBeUndefined();
  });
});

describe("instrumentUrlOf", () => {
  it.each([
    ["/orchestrator/tasks/lisbon-hotel", "instrument://task/lisbon-hotel"],
    ["/orchestrator/threads/ses_01J9", "instrument://thread/ses_01J9"],
    ["/orchestrator/memory/no-stevia", "instrument://memory/no-stevia"],
    ["/orchestrator/apps/linear", "instrument://app/linear"],
    ["/orchestrator/skills/create-page", "instrument://skill/create-page"],
    [
      "/orchestrator/skills/instrument%3Acreate-page",
      "instrument://skill/instrument:create-page",
    ],
    ["/orchestrator/ideas/timeline", "instrument://discover/timeline"],
    ["/orchestrator/ideas", "instrument://discover"],
    ["/orchestrator/threads/ses_01J9?tab=1", "instrument://thread/ses_01J9"],
  ])("writes %s as %s", (href, url) => {
    expect(instrumentUrlOf(href)).toBe(url);
  });

  it.each([
    ["the tasks as a whole", "/orchestrator/tasks"],
    ["the apps as a whole", "/orchestrator/apps"],
    ["a screen with no noun", "/orchestrator/activity"],
    ["the new tab", "/orchestrator/home"],
    ["a thing under a thing", "/orchestrator/tasks/lisbon-hotel/files"],
  ])("writes nothing for %s", (_case, href) => {
    expect(instrumentUrlOf(href)).toBeUndefined();
  });

  it("reads back what it wrote", () => {
    const href = "/orchestrator/skills/create-page";
    expect(instrumentLinkOf(instrumentUrlOf(href) ?? "")?.href).toBe(href);
  });
});

describe("filePathOfInstrumentLink", () => {
  it.each([
    ["instrument://file//mnt/Journal/2026-09-23.md", "/mnt/Journal/2026-09-23.md"],
    ["instrument://file/mnt/Journal/2026-09-23.md", "/mnt/Journal/2026-09-23.md"],
    ["instrument://File/mnt/My%20Notes/a.md", "/mnt/My Notes/a.md"],
    ["instrument://file/", undefined],
    ["instrument://thread/ses_01", undefined],
    ["https://file/mnt/a.md", undefined],
  ])("%s", (url, path) => {
    expect(filePathOfInstrumentLink(url)).toBe(path);
  });
});
