import { NEW_TAB_HREF, type WindowTab } from "@/client/atoms/orchestrator";
import { fileUrlOf } from "@/client/lib/file-url";
import { describe, expect, it } from "vitest";

import { fileHref } from "./file-tabs";
import { stepTabVisit, visitInTab } from "./tab-history";

const task: WindowTab = {
  at: 1,
  href: "/orchestrator/tasks/example",
  id: "task-screen",
  kind: "screen",
  trail: ["/orchestrator/tasks", "/orchestrator/tasks/example"],
};
const page: WindowTab = {
  id: "browser-session",
  kind: "page",
  openedAt: 1,
  url: "https://example.com",
};
const folder: WindowTab = {
  href: "/orchestrator/computer",
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
  it("returns from a linked website to the task's existing trail and forward to the same guest", () => {
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
      at: 0,
      trail: [task.href, "/orchestrator/computer?file=report.pdf"],
    };
    const website = visitInTab(transcript, page);
    expect(stepTabVisit(website, -1)).toMatchObject({
      at: 0,
      trail: [task.href],
    });
  });

  it("retains native back steps while crossing a screen boundary", () => {
    const website: WindowTab = {
      ...visitInTab(task, page),
      ...page,
      future: [folder],
      pageBackSteps: 2,
    };
    const back = stepped(website, -1);
    expect(stepTabVisit(back, 1)).toMatchObject({
      future: [folder],
      id: page.id,
      pageBackSteps: 2,
    });
    expect(visitInTab(website, folder).past?.at(-1)).toMatchObject({
      pageBackSteps: 0,
    });
  });

  it("steps a page with nothing behind it back to a new tab", () => {
    const back = stepped(page, -1);
    expect(back).toMatchObject({
      future: [page],
      href: NEW_TAB_HREF,
      kind: "screen",
      past: [],
      stripKey: page.id,
    });
    expect(stepTabVisit(back, 1)).toMatchObject({
      ...page,
      past: [{ href: NEW_TAB_HREF, id: back.id, kind: "screen" }],
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
      at: 1,
      href: fileHref(hostPath),
      trail: [folder.href, fileHref(hostPath)],
    };
    const shown = visitInTab(fileScreen, filePage);
    const back = stepped(shown, -1);
    // The screen shown again would hand the file to a new page at once, a
    // loop back could not leave.
    expect(back).toMatchObject({
      at: 0,
      href: folder.href,
      id: folder.id,
      trail: [folder.href],
    });
    // Forward restores the page the file was shown in, guest and all.
    expect(stepTabVisit(back, 1)).toEqual(shown);
  });

  it("is skipped when it began the tab, so back lands on the visit before it", () => {
    const fileScreen: WindowTab = {
      at: 0,
      href: fileHref(hostPath),
      id: "file-screen",
      kind: "screen",
      past: [page],
      trail: [fileHref(hostPath)],
    };
    const shown = visitInTab(fileScreen, filePage);
    expect(shown.past).toEqual([page]);
    expect(stepped(shown, -1)).toMatchObject({ ...page, future: [filePage] });
  });

  it("leaves a page opened as its own tab with a new tab behind it", () => {
    const fileScreen: WindowTab = {
      at: 0,
      href: fileHref(hostPath),
      id: "file-screen",
      kind: "screen",
      trail: [fileHref(hostPath)],
    };
    const shown = visitInTab(fileScreen, filePage);
    expect(shown.past).toEqual([]);
    const back = stepped(shown, -1);
    expect(back).toMatchObject({
      future: [filePage],
      href: NEW_TAB_HREF,
      kind: "screen",
      stripKey: "file-screen",
    });
    expect(stepTabVisit(back, 1)).toMatchObject(filePage);
  });

  it("stays a stop when it shows the file's source", () => {
    const sourceHref = fileHref(hostPath, { source: true });
    const sourceScreen: WindowTab = {
      ...folder,
      at: 1,
      href: sourceHref,
      trail: [folder.href, sourceHref],
    };
    expect(visitInTab(sourceScreen, filePage).past).toEqual([sourceScreen]);
  });
});
