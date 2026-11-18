import { describe, expect, it } from "vitest";

import { IDLE_LOAD, type LoadEvent, nextLoad } from "./load-stage";

const start = { type: "did-start-loading" } as const;
const stop = { type: "did-stop-loading" } as const;
const navigate = { type: "did-navigate" } as const;
const domReady = { type: "dom-ready" } as const;
const toNewDocument = {
  isInPlace: false,
  isMainFrame: true,
  type: "did-start-navigation",
} as const;
const inPlace = {
  isInPlace: true,
  isMainFrame: true,
  type: "did-start-navigation",
} as const;
const inFrame = {
  isInPlace: false,
  isMainFrame: false,
  type: "did-start-navigation",
} as const;

/** The stage after each event, from an idle page. */
function stagesOf(events: LoadEvent[]) {
  let load = IDLE_LOAD;
  return events.map((event) => {
    load = nextLoad(load, event);
    return load.stage;
  });
}

// Each sequence is the order Electron's <webview> fired the events in, as
// logged in Studio.
describe("nextLoad", () => {
  it.each([
    {
      events: [start, toNewDocument, navigate, domReady, stop],
      name: "a link to another page",
      stages: ["idle", "waiting", "committed", "ready", "idle"],
    },
    {
      events: [start, inPlace, stop],
      name: "history.replaceState, pushState or a fragment",
      stages: ["idle", "idle", "idle"],
    },
    {
      events: [start, inFrame, stop],
      name: "a frame loading in a page staying put",
      stages: ["idle", "idle", "idle"],
    },
    {
      events: [toNewDocument],
      name: "a navigation outside any load",
      stages: ["idle"],
    },
    {
      events: [start, toNewDocument, navigate, toNewDocument, navigate, stop],
      name: "a second link followed while the first page loads",
      stages: ["idle", "waiting", "committed", "waiting", "committed", "idle"],
    },
  ])("follows $name", ({ events, stages }) => {
    expect(stagesOf(events)).toEqual(stages);
  });
});
