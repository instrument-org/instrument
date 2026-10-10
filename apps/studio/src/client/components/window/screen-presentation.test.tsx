import { outputFolderHref } from "@/shared/computer-href";
import { ChatIdSchema, TaskIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import routeTreeSource from "../../routeTree.gen.ts?raw";
import { screenLocation, screenPresentation } from "./screen-presentation";

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

  it("names a tasks tab, and a task's by its title once known", () => {
    const task = TaskIdSchema.parse("book");
    const taskTitles = new Map([[task, "Book the hotel"]]);
    const href = `/tasks/${task}?chat=${CHAT_ID}`;
    expect(screenPresentation(`/tasks?chat=${CHAT_ID}`, CONTEXT).title).toBe(
      "Tasks",
    );
    expect(screenPresentation(href, { ...CONTEXT, taskTitles }).title).toBe(
      "Book the hotel",
    );
    expect(screenPresentation(href, CONTEXT).title).toBe("Task");
    expect(screenLocation(href, { ...CONTEXT, taskTitles })).toEqual({
      chat: CHAT_ID,
      kind: "task",
      title: "Book the hotel",
    });
  });

  it.each([
    ["the home folder", "/files?path=&root=~", "sam"],
    [
      "the Instrument folder a Finder opens at",
      outputFolderHref(),
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

  it("tells the model the home folder as Home, never by the account name", () => {
    const forModel = { ...CONTEXT, homeLabel: "Home" };
    expect(screenPresentation("/files?path=&root=~", forModel).title).toBe(
      "Home",
    );
    expect(
      screenPresentation("/files?path=&root=%2FUsers%2Fsam", forModel).title,
    ).toBe("Home");
    expect(
      screenPresentation("/files?path=Documents%2F&root=~", forModel).title,
    ).toBe("Documents");
  });

  it.each([
    ["a debug tool", "/debug/components", "Components"],
    ["a component page", "/debug/components/colors", "Colors"],
    ["an onboarding screen", "/debug/components/onboarding/login", "Log in"],
  ])("names %s", (_, href, title) => {
    expect(screenPresentation(href, CONTEXT).title).toBe(title);
  });

  // Every route a window tab can stand on, from the generated tree, so a new
  // screen with no name here fails rather than reading as "Tab". The chat and a
  // site's page are named by the tab strip itself, from the window's tabs.
  const NAMED_BY_THE_STRIP = new Set(["/sites/$id"]);
  // Every full path but the root and the onboarding window's, which no tab
  // stands on.
  const routes = new Set(
    Array.from(
      routeTreeSource.matchAll(/fullPath: '(\/(?!onboarding)[^']+)'/g),
      ([, path = ""]) => path,
    ),
  );
  it.each([...routes].filter((path) => !NAMED_BY_THE_STRIP.has(path)))(
    "names every tab on %s",
    (path) => {
      const href = path.replaceAll(/\$\w+/g, "x");
      expect(screenPresentation(href, CONTEXT).title).not.toBe("Tab");
    },
  );
});

describe("screenLocation", () => {
  it.each([
    ["the home folder", "/files?path=&root=~", "~"],
    [
      "the Instrument folder a Finder opens at",
      outputFolderHref(),
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

  it("places a chat tab on its chat", () => {
    const chatTitles = new Map([[CHAT_ID, "Caffeine mixes"]]);
    expect(screenLocation(INBOX_HREF, { ...CONTEXT, chatTitles })).toEqual({
      kind: "chat",
      title: "Caffeine mixes",
    });
  });
});
