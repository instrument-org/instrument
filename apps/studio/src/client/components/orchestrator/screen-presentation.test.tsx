import { StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { screenLocation, screenPresentation } from "./screen-presentation";

const CONTEXT = { appsBySlug: new Map() };

const THREAD_ID = StoreId.SessionSchema.parse("ses_01ARZ3NDEKTSV4RRFFQ69G5FAV");
const THREAD_HREF = `/orchestrator/threads/${THREAD_ID}`;

describe("screenPresentation", () => {
  it("names a thread tab by the thread's title, and by kind until it is known", () => {
    const threadTitles = new Map([[THREAD_ID, "Caffeine mixes, plus Zevia"]]);
    expect(
      screenPresentation(THREAD_HREF, { ...CONTEXT, threadTitles }).title,
    ).toBe("Caffeine mixes, plus Zevia");
    expect(screenPresentation(THREAD_HREF, CONTEXT).title).toBe("Chat");
  });

  it.each([
    ["the home folder", "/orchestrator/computer?path=&root=~", "Home"],
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
});

describe("screenLocation", () => {
  it.each([
    ["the home folder", "/orchestrator/computer?path=&root=~", "~"],
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

  it("places a thread tab on its thread", () => {
    const threadTitles = new Map([[THREAD_ID, "Caffeine mixes"]]);
    expect(screenLocation(THREAD_HREF, { ...CONTEXT, threadTitles })).toEqual({
      kind: "thread",
      title: "Caffeine mixes",
    });
  });
});
