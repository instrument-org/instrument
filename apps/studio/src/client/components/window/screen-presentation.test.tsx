import { outputFolderHref } from "@/client/lib/output-folder";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import routeTreeSource from "../../routeTree.gen.ts?raw";
import { screenLocation, screenPresentation } from "./screen-presentation";
import { newChatHref } from "./window-href";

const CONTEXT = { appsBySlug: new Map() };

const CHAT_ID = ChatIdSchema.parse("2026-10-01-caffeine-mixes");
const INBOX_HREF = `/chats/${CHAT_ID}`;

describe("screenPresentation", () => {
  it("names a chat tab by the chat's title, and by kind until it is known", () => {
    const chatTitles = new Map([[CHAT_ID, "Caffeine mixes, plus Zevia"]]);
    expect(
      screenPresentation(INBOX_HREF, { ...CONTEXT, chatTitles }).title,
    ).toBe("Caffeine mixes, plus Zevia");
    expect(screenPresentation(INBOX_HREF, CONTEXT).title).toBe("Chat");
  });

  it.each([
    ["with no draft yet", newChatHref()],
    ["on its draft", newChatHref("01M7BVSPAMVP4SR3P07E7PFGCQ")],
  ])("names a new chat's tab New Tab, %s", (_case, href) => {
    expect(screenPresentation(href, CONTEXT).title).toBe("New Tab");
  });

  it("names a task's tab by its title once known", () => {
    const task = StoreId.newSessionId();
    const taskTitles = new Map([[task, "Book the hotel"]]);
    const href = `/tasks/${task}?chat=${CHAT_ID}`;
    expect(screenPresentation(href, { ...CONTEXT, taskTitles }).title).toBe(
      "Book the hotel",
    );
    expect(screenPresentation(href, CONTEXT).title).toBe("Task");
    expect(screenLocation(href, { ...CONTEXT, taskTitles })).toEqual({
      chat: { id: CHAT_ID, title: "Chat" },
      kind: "task",
      title: "Book the hotel",
    });
  });

  it.each([
    ["the home folder", "/files?path=&root=~", "sam"],
    [
      "the Instrument folder a Finder opens at",
      outputFolderHref("~/Documents/Instrument"),
      "Instrument",
    ],
    [
      "a folder walked into under the home folder",
      "/files?path=Documents%2FInstrument%2F&root=~",
      "Instrument",
    ],
    [
      "a folder the browser is rooted in",
      "/files?path=&root=%2FUsers%2Fsam%2Fcode%2Finstrument",
      "instrument",
    ],
    [
      "a folder walked into under a root",
      "/files?path=docs%2F&root=%2FUsers%2Fsam%2Fcode%2Finstrument",
      "docs",
    ],
    ["a Windows volume", "/files?path=&root=C%3A%5C", "C:"],
    ["the top of the disk", "/files?path=&root=%2F", "This Mac"],
    ["the recents", "/files?path=&root=recents%3A", "Recents"],
  ])("names a folder tab at %s", (_, href, title) => {
    expect(screenPresentation(href, CONTEXT).title).toBe(title);
  });

  it("names the top of a disk the way the location bar does once the disks are known", () => {
    const volumes = [
      { name: "Macintosh HD", path: "/" },
      { name: "Backup", path: "/Volumes/Backup" },
    ];
    expect(
      screenPresentation("/files?path=&root=%2F", { ...CONTEXT, volumes })
        .title,
    ).toBe("Macintosh HD");
  });

  it.each([
    ["a debug tool", "/debug/components", "Components"],
    ["a component page", "/debug/components/colors", "Colors"],
  ])("names %s", (_, href, title) => {
    expect(screenPresentation(href, CONTEXT).title).toBe(title);
  });

  // Every route a window tab can stand on, from the generated tree, so a new
  // screen with no name here fails rather than reading as "Tab". The chat and a
  // site's page are named by the tab strip itself, from the window's tabs.
  const NAMED_BY_THE_STRIP = new Set(["/sites/$id"]);
  // Every full path but the root, which no tab stands on.
  const routes = new Set(
    Array.from(
      routeTreeSource.matchAll(/fullPath: '(\/[^']+)'/g),
      ([, path = ""]) => path,
    ),
  );
  it.each([...routes].filter((path) => !NAMED_BY_THE_STRIP.has(path)))(
    "names every tab on %s",
    (path) => {
      // A task's address names it by its session, and Settings' by one of
      // its parts.
      const href = path.replaceAll(
        /\$\w+/g,
        path.startsWith("/tasks/")
          ? StoreId.newSessionId()
          : path.startsWith("/settings/")
            ? "general"
            : "x",
      );
      expect(screenPresentation(href, CONTEXT).title).not.toBe("Tab");
    },
  );
});

describe("screenLocation", () => {
  it.each([
    ["the home folder", "/files?path=&root=~", "~"],
    [
      "the Instrument folder a Finder opens at",
      outputFolderHref("~/Documents/Instrument"),
      "~/Documents/Instrument",
    ],
    [
      "a folder walked into under the home folder",
      "/files?path=Documents%2FInstrument%2F&root=~",
      "~/Documents/Instrument",
    ],
    [
      "a folder walked into under a root",
      "/files?path=docs%2F&root=%2FUsers%2Fsam%2Fcode%2Finstrument",
      "/Users/sam/code/instrument/docs",
    ],
    [
      "a Windows folder, in its own separator",
      "/files?path=Downloads%2F&root=C%3A%5CUsers%5Csam",
      "C:\\Users\\sam\\Downloads",
    ],
    ["the recents", "/files?path=&root=recents%3A", ""],
  ])("places a folder tab at %s", (_, href, path) => {
    expect(screenLocation(href, CONTEXT)).toEqual({ kind: "folder", path });
  });

  it.each([
    ["every chat", "/chat-list?q=trip", { kind: "chats" }],
    ["Activity", "/activity", { kind: "builtin", screen: "activity" }],
    [
      "what Activity shows",
      "/activity?show=files",
      {
        kind: "builtin",
        part: "Files",
        partHref: "/activity?show=files",
        screen: "activity",
      },
    ],
    [
      "a debug page",
      "/debug/components/transcript?scenario=long-reply",
      {
        address: "instrument://debug/components/transcript?scenario=long-reply",
        kind: "debug",
      },
    ],
  ])("places a tab at %s", (_, href, location) => {
    expect(screenLocation(href, CONTEXT)).toEqual(location);
  });

  it("names the chats' index Chats", () => {
    expect(screenPresentation("/chat-list", CONTEXT).title).toBe("Chats");
  });

  it("places a chat tab on its chat", () => {
    const chatTitles = new Map([[CHAT_ID, "Caffeine mixes"]]);
    expect(screenLocation(INBOX_HREF, { ...CONTEXT, chatTitles })).toEqual({
      kind: "chat",
      title: "Caffeine mixes",
    });
  });
});
