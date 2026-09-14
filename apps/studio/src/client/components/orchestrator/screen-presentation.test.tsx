import { describe, expect, it } from "vitest";

import { screenLocation, screenPresentation } from "./screen-presentation";

const CONTEXT = { appsBySlug: new Map(), childTitles: new Map() };

describe("screenPresentation", () => {
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
});
