import { type WindowTab } from "@/client/atoms/orchestrator";
import { describe, expect, it } from "vitest";

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
});
