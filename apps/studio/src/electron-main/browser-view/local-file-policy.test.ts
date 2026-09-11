import {
  type OnBeforeRequestListenerDetails,
  type WebFrameMain,
} from "electron";
import { describe, expect, it } from "vitest";

import { isAllowedLocalRequest } from "./local-file-policy";

const PAGE = "file:///Users/casey/Documents/Instrument/report/index.html";

// Only the frame's address is read; the rest of a WebFrameMain is not.
const frameAt = (url: string) => ({ url }) as WebFrameMain;

const request = (
  url: string,
  resourceType: OnBeforeRequestListenerDetails["resourceType"],
  { frame = frameAt(PAGE) }: { frame?: null | WebFrameMain } = {},
) => isAllowedLocalRequest({ frame: frame ?? undefined, resourceType, url });

describe("isAllowedLocalRequest", () => {
  it.each([
    [
      "a picture beside the page",
      "file:///Users/casey/Documents/Instrument/report/chart.png",
      "image",
    ],
    [
      "a stylesheet in a subfolder",
      "file:///Users/casey/Documents/Instrument/report/css/site.css",
      "stylesheet",
    ],
    [
      "data fetched from beside the page",
      "file:///Users/casey/Documents/Instrument/report/data.json",
      "xhr",
    ],
    [
      "a frame from beside the page",
      "file:///Users/casey/Documents/Instrument/report/embed.html",
      "subFrame",
    ],
  ] as const)("lets a page read %s", (_case, url, resourceType) => {
    expect(request(url, resourceType)).toBe(true);
  });

  it.each([
    [
      "a file above the page",
      "file:///Users/casey/Documents/Instrument/notes.md",
      "xhr",
    ],
    [
      "a file beside the page's folder",
      "file:///Users/casey/Documents/Instrument/other/x.json",
      "xhr",
    ],
    ["a file anywhere else", "file:///Users/casey/.ssh/id_rsa", "xhr"],
    [
      "a folder named like the page's folder",
      "file:///Users/casey/Documents/Instrument/report-archive/x.json",
      "xhr",
    ],
    [
      "an encoded climb out of the folder",
      "file:///Users/casey/Documents/Instrument/report/%2E%2E/notes.md",
      "xhr",
    ],
    [
      "the task's private directory beside the page",
      "file:///Users/casey/Documents/Instrument/report/.instrument/task.db",
      "xhr",
    ],
    [
      "a picture drawn from outside the folder",
      "file:///Users/casey/Pictures/private.jpg",
      "image",
    ],
  ] as const)("refuses a page %s", (_case, url, resourceType) => {
    expect(request(url, resourceType)).toBe(false);
  });

  it("refuses a read from a frame with no address of its own", () => {
    expect(
      request(
        "file:///Users/casey/Documents/Instrument/report/data.json",
        "xhr",
        { frame: null },
      ),
    ).toBe(false);
  });

  it("refuses a read from a page that is not a file", () => {
    expect(
      request(
        "file:///Users/casey/Documents/Instrument/report/data.json",
        "xhr",
        { frame: frameAt("https://example.test/") },
      ),
    ).toBe(false);
  });

  // Where the person goes is theirs: a link they follow, a file they open.
  it("lets the frame itself move to another file", () => {
    expect(request("file:///Users/casey/Desktop/other.html", "mainFrame")).toBe(
      true,
    );
  });

  it("never lets the frame move into a private directory", () => {
    expect(
      request("file:///Users/casey/tasks/a/.instrument/task.db", "mainFrame"),
    ).toBe(false);
  });
});
