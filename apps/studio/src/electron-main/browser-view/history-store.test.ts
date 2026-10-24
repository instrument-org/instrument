import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/electron-main/lib/get-workspace-folder", () => ({
  workspaceBrowserDir: () => "/unused",
}));

import { createHistoryStore, rewriteRecentFiles } from "./history-store";

const HOUR = 60 * 60 * 1000;

function store() {
  return createHistoryStore(":memory:");
}

describe("history store", () => {
  it("counts only the person's visible visits, and unhides a page on a later visible one", () => {
    const history = store();
    const agent = history.addVisit({
      actor: "agent",
      at: 1,
      transition: "link",
      url: "https://a.test/",
    });
    expect(history.recent(10)).toEqual([]);
    const hidden = history.addVisit({
      actor: "user",
      at: 2,
      transition: "link",
      url: "https://a.test/",
    });
    history.hideVisit(hidden, "redirect");
    expect(history.recent(10)).toEqual([]);
    history.addVisit({
      actor: "user",
      at: 3,
      transition: "typed",
      url: "https://a.test/",
    });
    history.setTitle([agent], "A");
    expect(history.recent(10)).toEqual([
      {
        at: 3,
        title: "A",
        typedCount: 1,
        url: "https://a.test/",
        visitCount: 1,
      },
    ]);
  });

  it("knows the title of a page an agent opened, with or without a closing slash", () => {
    const history = store();
    const visit = history.addVisit({
      actor: "agent",
      at: 1,
      transition: "link",
      url: "https://a.test/page",
    });
    history.setTitle([visit], "A page");
    expect(history.titleOf("https://a.test/page")).toBe("A page");
    expect(history.titleOf("https://a.test/page/")).toBe("A page");
    expect(history.titleOf("https://a.test/other")).toBeUndefined();
  });

  it("knows no title for a page that only failed to load", () => {
    const history = store();
    const visit = history.addVisit({
      actor: "user",
      at: 1,
      transition: "link",
      url: "https://a.test/",
    });
    history.setTitle([visit], "Not Found");
    history.hideVisit(visit, "error");
    expect(history.titleOf("https://a.test/")).toBeUndefined();
  });

  it("keeps a page visible elsewhere when one of its visits turns out to be a redirect", () => {
    const history = store();
    history.addVisit({
      actor: "user",
      at: 1,
      transition: "link",
      url: "https://a.test/",
    });
    const later = history.addVisit({
      actor: "user",
      at: 2,
      transition: "link",
      url: "https://a.test/",
    });
    history.hideVisit(later, "redirect");
    expect(history.recent(10).map((page) => [page.url, page.at])).toEqual([
      ["https://a.test/", 1],
    ]);
  });

  it("summarizes and clears from a time, taking agent visits and emptied pages with it", () => {
    const history = store();
    const visit = (url: string, at: number, actor: "agent" | "user" = "user") =>
      history.addVisit({ actor, at, transition: "link", url });
    visit("https://old.test/", 1 * HOUR);
    visit("https://b.test/one", 5 * HOUR);
    visit("https://b.test/two", 6 * HOUR);
    visit("https://c.test/", 7 * HOUR);
    visit("https://agent.test/", 8 * HOUR, "agent");
    expect(history.summary(4 * HOUR)).toEqual({
      count: 3,
      hosts: ["b.test", "c.test"],
    });
    expect(history.summary()).toEqual({
      count: 4,
      hosts: ["b.test", "c.test", "old.test"],
    });
    expect(history.clear(4 * HOUR)).toEqual({ removed: 4 });
    expect(history.recent(10).map((page) => page.url)).toEqual([
      "https://old.test/",
    ]);
    expect(history.clear()).toEqual({ removed: 1 });
    expect(history.summary()).toEqual({ count: 0, hosts: [] });
  });

  // A tab that was open through a clear still holds its visit's id and later
  // hides or retitles it; a page visited since must not have taken that id.
  it("never gives a cleared visit's id to a later visit", () => {
    const history = store();
    const cleared = history.addVisit({
      actor: "user",
      at: 2 * HOUR,
      transition: "link",
      url: "https://a.test/",
    });
    history.clear(HOUR);
    history.addVisit({
      actor: "user",
      at: 3 * HOUR,
      transition: "link",
      url: "https://b.test/",
    });
    history.hideVisit(cleared, "redirect");
    history.setTitle([cleared], "A");
    expect(history.recent(10)).toMatchObject([
      { title: "", url: "https://b.test/" },
    ]);
  });

  it("removes a page from the person's history", () => {
    const history = store();
    history.addVisit({
      actor: "user",
      at: 1,
      transition: "link",
      url: "https://a.test/",
    });
    history.remove("https://a.test/");
    expect(history.recent(10)).toEqual([]);
    expect(history.summary()).toEqual({ count: 0, hosts: [] });
  });

  it("completes only to significant pages: typed, visited often, or lately", () => {
    const history = store();
    const now = 30 * 24 * HOUR;
    const visit = (url: string, at: number, typed = false) =>
      history.addVisit({
        actor: "user",
        at,
        transition: typed ? "typed" : "link",
        url,
      });
    visit("https://typed.test/", 1, true);
    for (const at of [1, 2, 3, 4]) {
      visit("https://often.test/", at);
    }
    visit("https://once-long-ago.test/", 5);
    visit("https://lately.test/", now - HOUR);
    expect(history.significant(10, now).map((page) => page.url)).toEqual([
      "https://lately.test/",
      "https://often.test/",
      "https://typed.test/",
    ]);
  });
});

describe("opened files", () => {
  it("lists each file once, most recently opened first, counting its opens", () => {
    const history = store();
    history.addFileOpen({ at: 1, path: "/a/one.txt", via: "tab" });
    history.addFileOpen({ at: 2, path: "/a/two.txt", via: "external" });
    history.addFileOpen({ at: 3, path: "/a/one.txt", via: "tab" });
    expect(history.openedFiles(10)).toEqual([
      { at: 3, openCount: 2, path: "/a/one.txt" },
      { at: 2, openCount: 1, path: "/a/two.txt" },
    ]);
    expect(history.openedFiles(1)).toHaveLength(1);
  });

  it("follows a renamed file and every file under a moved folder, and leaves a sibling with the same prefix", () => {
    const history = store();
    history.addFileOpen({ at: 1, path: "/a/doc.txt", via: "tab" });
    history.addFileOpen({ at: 2, path: "/a/sub/deep.txt", via: "tab" });
    history.addFileOpen({ at: 3, path: "/ab/other.txt", via: "tab" });
    history.moveFiles("/a/doc.txt", "/a/renamed.txt");
    history.moveFiles("/a", "/b");
    expect(history.openedFiles(10).map((file) => file.path)).toEqual([
      "/ab/other.txt",
      "/b/sub/deep.txt",
      "/b/renamed.txt",
    ]);
  });

  it("keeps the moved file's history where a file was already recorded at the new path", () => {
    const history = store();
    history.addFileOpen({ at: 1, path: "/a/old.txt", via: "tab" });
    history.addFileOpen({ at: 2, path: "/a/new.txt", via: "tab" });
    history.moveFiles("/a/old.txt", "/a/new.txt");
    expect(history.openedFiles(10)).toEqual([
      { at: 1, openCount: 1, path: "/a/new.txt" },
    ]);
  });

  it("is left alone by clearing browsing history", () => {
    const history = store();
    history.addFileOpen({ at: 1, path: "/a/one.txt", via: "tab" });
    history.clear();
    expect(history.openedFiles(10)).toHaveLength(1);
  });
});

describe("the recent files after a move the app made", () => {
  let browserDir: string;

  beforeEach(() => {
    browserDir = fs.mkdtempSync(path.join(os.tmpdir(), "history-moves-"));
  });

  afterEach(() => {
    fs.rmSync(browserDir, { force: true, recursive: true });
  });

  function openFiles(...paths: string[]) {
    const history = createHistoryStore(path.join(browserDir, "history.db"));
    for (const [index, filePath] of paths.entries()) {
      history.addFileOpen({ at: index + 1, path: filePath, via: "tab" });
    }
    history.close();
  }

  function recents(): string[] {
    const history = createHistoryStore(path.join(browserDir, "history.db"));
    const paths = history.openedFiles(10).map((file) => file.path);
    history.close();
    return paths;
  }

  it("keeps a row's history under where the folder went, and leaves one outside it", () => {
    openFiles(
      "/data/workspace/Chats/Dishwashers/notes.md",
      "/Users/sam/tax.pdf",
    );

    const done = rewriteRecentFiles(browserDir, [
      { from: "/data/workspace", to: "/Users/sam/Documents/Instrument" },
    ]);

    expect(recents()).toEqual([
      "/Users/sam/tax.pdf",
      "/Users/sam/Documents/Instrument/Chats/Dishwashers/notes.md",
    ]);
    expect(done).toEqual([
      `wrote 1 recent file(s) where they went in ${path.join(browserDir, "history.db")}`,
    ]);
  });

  it("says nothing on the run after, and makes no history where there is none", () => {
    expect(
      rewriteRecentFiles(browserDir, [{ from: "/data/workspace", to: "/now" }]),
    ).toEqual([]);
    expect(fs.existsSync(path.join(browserDir, "history.db"))).toBe(false);

    openFiles("/data/workspace/report.pdf");
    rewriteRecentFiles(browserDir, [{ from: "/data/workspace", to: "/now" }]);

    expect(
      rewriteRecentFiles(browserDir, [{ from: "/data/workspace", to: "/now" }]),
    ).toEqual([]);
    expect(recents()).toEqual(["/now/report.pdf"]);
  });
});
