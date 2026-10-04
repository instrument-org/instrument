import {
  BROWSER_HREF,
  draftGroupOf,
  NEW_TAB_HREF,
  type WindowTab,
} from "@/client/atoms/window";
import { fileUrlOf } from "@/client/lib/file-url";
import { fileHref } from "@/shared/computer-href";
import { describe, expect, it } from "vitest";

import { stepTabVisit, visitInTab } from "./tab-history";

const task: WindowTab = {
  href: "/tasks/example",
  id: "task-screen",
  kind: "screen",
  history: { entries: ["/tasks", "/tasks/example"], index: 1 },
};
const page: WindowTab = {
  id: "browser-session",
  kind: "page",
  openedAt: 1,
  url: "https://example.com",
};
const folder: WindowTab = {
  href: "/files",
  id: "folder-screen",
  kind: "screen",
};

/** A step the case says has somewhere to go, so the lines below read as one. */
function stepped(tab: WindowTab, direction: -1 | 1): WindowTab {
  const next = stepTabVisit(tab, direction);
  if (!next) {
    throw new Error(
      `No visit ${direction === -1 ? "behind" : "ahead of"} ${tab.id}`,
    );
  }
  return next;
}

describe("tab visits", () => {
  it("returns from a linked website to the task's existing history and forward to the same guest", () => {
    const website = visitInTab(task, page);
    const back = stepped(website, -1);
    expect(back).toMatchObject({ ...task, stripKey: task.id });
    expect(stepTabVisit(back, 1)).toEqual(website);
  });

  it("walks screen, website, and folder visits in both directions", () => {
    const computer = visitInTab(visitInTab(task, page), folder);
    const website = stepped(computer, -1);
    const transcript = stepped(website, -1);
    expect(transcript.id).toBe(task.id);
    expect(stepTabVisit(stepped(transcript, 1), 1)).toEqual(computer);
    expect(computer.stripKey).toBe(task.id);
  });

  it("drops the forward branch on a new navigation", () => {
    const back = stepped(visitInTab(task, page), -1);
    const next = visitInTab(back, folder);
    expect(stepTabVisit(next, 1)).toBeUndefined();
    expect(next.past?.map((visit) => visit.id)).toEqual([task.id]);
  });

  it("discards a forward file visit when opening a website from the task", () => {
    const transcript: WindowTab = {
      ...task,
      history: { entries: [task.href, "/files?file=report.pdf"], index: 0 },
    };
    const website = visitInTab(transcript, page);
    expect(stepTabVisit(website, -1)).toMatchObject({
      history: { entries: [task.href], index: 0 },
    });
  });

  it("keeps a page's own session while crossing a screen boundary", () => {
    const website: WindowTab = {
      ...visitInTab(task, page),
      ...page,
      future: [folder],
    };
    const back = stepped(website, -1);
    expect(stepTabVisit(back, 1)).toMatchObject({
      future: [folder],
      id: page.id,
    });
    expect(visitInTab(website, folder).past?.at(-1)).toMatchObject({
      id: page.id,
      kind: "page",
    });
  });

  it("steps a draft's page with nothing behind it back to the draft's new tab", () => {
    const back = stepped({ ...page, group: draftGroupOf("draft") }, -1);
    expect(back).toMatchObject({ href: NEW_TAB_HREF, kind: "screen" });
  });

  it("steps a chat's page with nothing behind it back to the web's starting view", () => {
    const back = stepped(page, -1);
    expect(back).toMatchObject({
      future: [page],
      href: BROWSER_HREF,
      kind: "screen",
      past: [],
      stripKey: page.id,
    });
    expect(stepTabVisit(back, 1)).toMatchObject({
      ...page,
      past: [{ href: BROWSER_HREF, id: back.id, kind: "screen" }],
    });
  });
});

describe("a file screen handing its page to the browser", () => {
  const hostPath = "/Users/person/report.html";
  const filePage: WindowTab = {
    id: "file-session",
    kind: "page",
    openedAt: 1,
    url: fileUrlOf(hostPath),
  };

  it("is skipped by back, which lands where the file was opened from", () => {
    const fileScreen: WindowTab = {
      ...folder,
      href: fileHref(hostPath),
      history: { entries: [folder.href, fileHref(hostPath)], index: 1 },
    };
    const shown = visitInTab(fileScreen, filePage);
    const back = stepped(shown, -1);
    // The screen shown again would hand the file to a new page at once, a
    // loop back could not leave.
    expect(back).toMatchObject({
      href: folder.href,
      id: folder.id,
      history: { entries: [folder.href], index: 0 },
    });
    // Forward restores the page the file was shown in, guest and all.
    expect(stepTabVisit(back, 1)).toEqual(shown);
  });

  it("is skipped when it began the tab, so back lands on the visit before it", () => {
    const fileScreen: WindowTab = {
      href: fileHref(hostPath),
      id: "file-screen",
      kind: "screen",
      past: [page],
      history: { entries: [fileHref(hostPath)], index: 0 },
    };
    const shown = visitInTab(fileScreen, filePage);
    expect(shown.past).toEqual([page]);
    expect(stepped(shown, -1)).toMatchObject({ ...page, future: [filePage] });
  });

  it("leaves a page opened as its own tab with the web's starting view behind it", () => {
    const fileScreen: WindowTab = {
      href: fileHref(hostPath),
      id: "file-screen",
      kind: "screen",
      history: { entries: [fileHref(hostPath)], index: 0 },
    };
    const shown = visitInTab(fileScreen, filePage);
    expect(shown.past).toEqual([]);
    const back = stepped(shown, -1);
    expect(back).toMatchObject({
      future: [filePage],
      href: BROWSER_HREF,
      kind: "screen",
      stripKey: "file-screen",
    });
    expect(stepTabVisit(back, 1)).toMatchObject(filePage);
  });

  it("stays a stop when it shows the file's source", () => {
    const sourceHref = fileHref(hostPath, { source: true });
    const sourceScreen: WindowTab = {
      ...folder,
      href: sourceHref,
      history: { entries: [folder.href, sourceHref], index: 1 },
    };
    expect(visitInTab(sourceScreen, filePage).past).toEqual([sourceScreen]);
  });
});
