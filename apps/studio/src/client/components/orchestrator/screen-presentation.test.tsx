import { instrumentFolderHref } from "@/shared/computer-href";
import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import routeTree from "../../routeTree.gen.ts?raw";
import { screenLocation, screenPresentation } from "./screen-presentation";

const CONTEXT = { appsBySlug: new Map() };

const CHAT_ID = StoreId.SessionSchema.parse("ses_01ARZ3NDEKTSV4RRFFQ69G5FAV");
const CHAT_HREF = `/orchestrator/chats/${CHAT_ID}`;

describe("screenPresentation", () => {
  it("names a chat tab by the chat's title, and by kind until it is known", () => {
    const chatTitles = new Map([[CHAT_ID, "Caffeine mixes, plus Zevia"]]);
    expect(
      screenPresentation(CHAT_HREF, { ...CONTEXT, chatTitles }).title,
    ).toBe("Caffeine mixes, plus Zevia");
    expect(screenPresentation(CHAT_HREF, CONTEXT).title).toBe("Chat");
  });

  it("names a tasks tab, and a task's by its title once known", () => {
    const task = TaskIdSchema.parse("book");
    const taskTitles = new Map([[task, "Book the hotel"]]);
    const href = `/orchestrator/tasks/${task}?chat=${CHAT_ID}`;
    expect(
      screenPresentation(`/orchestrator/tasks?chat=${CHAT_ID}`, CONTEXT).title,
    ).toBe("Tasks");
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
    ["the home folder", "/orchestrator/computer?path=&root=~", "Home"],
    [
      "the Instrument folder a Finder opens at",
      instrumentFolderHref(),
      "Instrument",
    ],
    [
      "a folder walked into under the home folder",
      "/orchestrator/computer?path=Documents%2FInstrument%2F&root=~",
      "Instrument",
    ],
    [
      "a folder the browser is rooted in",
      "/orchestrator/computer?path=&root=%2FUsers%2Fsam%2Fcode%2Finstrument",
      "instrument",
    ],
    [
      "a folder walked into under a root",
      "/orchestrator/computer?path=docs%2F&root=%2FUsers%2Fsam%2Fcode%2Finstrument",
      "docs",
    ],
    ["a Windows volume", "/orchestrator/computer?path=&root=C%3A%5C", "C:"],
    [
      "the top of the disk",
      "/orchestrator/computer?path=&root=%2F",
      "This Mac",
    ],
    ["the recents", "/orchestrator/computer?path=&root=recents%3A", "Recents"],
  ])("names a folder tab at %s", (_, href, title) => {
    expect(screenPresentation(href, CONTEXT).title).toBe(title);
  });

  // The router writes a qualified name's colon as `%3A`; the tab reads the
  // name after the source's prefix.
  it.each([
    ["a plain name", "/orchestrator/skills/create-page", "create-page"],
    ["a qualified name", "/orchestrator/skills/workspace%3Atdd", "tdd"],
  ])("names a skill tab by %s", (_, href, title) => {
    expect(screenPresentation(href, CONTEXT).title).toBe(title);
  });

  it.each([
    ["the debug home", "/debug", "Debug home"],
    ["a debug tool", "/debug/errors", "Errors"],
    ["a component page", "/debug/components/colors", "Colors"],
    ["an onboarding screen", "/debug/components/onboarding/login", "Log in"],
    ["one agent browser", "/debug/browser-view/target-1", "Debug browser view"],
  ])("names %s", (_, href, title) => {
    expect(screenPresentation(href, CONTEXT).title).toBe(title);
  });

  // Every route a window tab can stand on, from the generated tree, so a new
  // screen with no name here fails rather than reading as "Tab". The chat and a
  // site's page are named by the tab strip itself, from the window's tabs.
  const NAMED_BY_THE_STRIP = new Set([
    "/orchestrator",
    "/orchestrator/",
    "/orchestrator/page",
  ]);
  const routes = new Set(
    Array.from(
      routeTree.matchAll(/fullPath: '((?:\/orchestrator|\/debug)[^']*)'/g),
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
    ["the home folder", "/orchestrator/computer?path=&root=~", "~"],
    [
      "the Instrument folder a Finder opens at",
      instrumentFolderHref(),
      "~/Documents/Instrument",
    ],
    [
      "a folder walked into under the home folder",
      "/orchestrator/computer?path=Documents%2FInstrument%2F&root=~",
      "~/Documents/Instrument",
    ],
    [
      "a folder walked into under a root",
      "/orchestrator/computer?path=docs%2F&root=%2FUsers%2Fsam%2Fcode%2Finstrument",
      "/Users/sam/code/instrument/docs",
    ],
    [
      "a Windows folder, in its own separator",
      "/orchestrator/computer?path=Downloads%2F&root=C%3A%5CUsers%5Csam",
      "C:\\Users\\sam\\Downloads",
    ],
    ["the recents", "/orchestrator/computer?path=&root=recents%3A", ""],
  ])("places a folder tab at %s", (_, href, path) => {
    expect(screenLocation(href, CONTEXT)).toEqual({ kind: "folder", path });
  });

  it("places a chat tab on its chat", () => {
    const chatTitles = new Map([[CHAT_ID, "Caffeine mixes"]]);
    expect(screenLocation(CHAT_HREF, { ...CONTEXT, chatTitles })).toEqual({
      kind: "chat",
      title: "Caffeine mixes",
    });
  });
});
