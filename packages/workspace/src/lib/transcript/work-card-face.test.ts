import { describe, expect, it } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { type TurnStep } from "./turns-of";
import { type WorkCard } from "./work-card";
import {
  workCardFace,
  type WorkCardLookups,
  workCardPaths,
  type WorkCardView,
} from "./work-card-face";

function step(
  shows: TurnStep["shows"],
  status: TurnStep["status"] = "done",
): TurnStep {
  return {
    metadata: {
      createdAt: new Date("2026-01-01T00:00:00Z"),
      id: StoreId.newPartId(),
      messageId: StoreId.newMessageId(),
      sessionId: StoreId.newSessionId(),
    },
    shows,
    status,
    tool: "tool-bash",
    type: "step",
  };
}

/** A case: its name, the view it comes to, the card, and what is known outside it. */
type Case = [string, WorkCardView, WorkCard, WorkCardLookups?];

const card = (
  kind: WorkCard["kind"],
  steps: TurnStep[],
  changedFile?: WorkCard["changedFile"],
): WorkCard => ({ changedFile, kind, steps });

/** Every path is where the call said it was, unless the case says otherwise. */
const faceOf = (of: WorkCard, lookups?: WorkCardLookups) =>
  workCardFace(
    of,
    lookups ?? {
      places: Object.fromEntries(workCardPaths(of).map((path) => [path, path])),
    },
  );

const nowhere: WorkCardLookups = { places: {} };

/** Each case's view, then every face at once, so a change to any shows. */
function checkFaces(cases: Case[]) {
  it.each(cases)("%s comes to %s", (_name, view, of, lookups) => {
    expect(faceOf(of, lookups).view).toBe(view);
  });
  return Object.fromEntries(
    cases.map(([name, , of, lookups]) => [name, faceOf(of, lookups)]),
  );
}

const search = (
  results: { title?: string; url: string }[],
  status: TurnStep["status"] = "done",
) =>
  step(
    {
      kind: "search",
      query: "nashville weather",
      results,
      total: results.length,
    },
    status,
  );

const RESULTS = [
  { title: "7-Day Forecast", url: "https://forecast.weather.gov/a" },
  { url: "https://www.wsmv.com/weather/" },
];

describe("a web card's face", () => {
  const faces = checkFaces([
    ["searching", "web/searching", card("web", [search([], "running")])],
    ["nothing found", "web/nothing-found", card("web", [search([])])],
    ["results", "web/results", card("web", [search(RESULTS)])],
    [
      "results, with a fetch whose address has not come",
      "web/results",
      card("web", [search(RESULTS), step({ kind: "fetch" }, "running")]),
    ],
    [
      "a fetch whose address has not come, after nothing found",
      "web/opening",
      card("web", [search([]), step({ kind: "fetch" }, "running")]),
    ],
    [
      "a fetch with no search",
      "web/opening",
      card("web", [step({ kind: "fetch" }, "running")]),
    ],
    [
      "opening a result",
      "web/opening",
      card("web", [
        search(RESULTS),
        step(
          { kind: "fetch", url: "https://www.wsmv.com/weather#top" },
          "running",
        ),
      ]),
    ],
    [
      "opening a page not among them",
      "web/opening",
      card("web", [
        search(RESULTS),
        step({ kind: "fetch", url: "https://example.com/" }, "running"),
      ]),
    ],
    [
      "a page read, with words",
      "web/page",
      card("web", [
        search(RESULTS),
        step({
          kind: "fetch",
          title: "Forecast",
          url: "https://forecast.weather.gov/a",
          words: "Sunny, then cold.",
        }),
      ]),
    ],
    [
      "a page read, with no words or title",
      "web/page",
      card("web", [step({ kind: "fetch", url: "https://www.example.com/" })]),
    ],
    [
      "a search after a fetch",
      "web/results",
      card("web", [
        step({ kind: "fetch", url: "https://example.com/" }),
        search(RESULTS),
      ]),
    ],
  ]);

  it("names what each shows", () => {
    expect(faces).toMatchInlineSnapshot(`
      {
        "a fetch whose address has not come, after nothing found": {
          "heading": "nashville weather",
          "title": "nashville weather",
          "view": "web/opening",
        },
        "a fetch with no search": {
          "heading": "Opening a page",
          "title": "Opening a page",
          "view": "web/opening",
        },
        "a page read, with no words or title": {
          "heading": "example.com",
          "host": "example.com",
          "meta": "example.com",
          "open": {
            "url": "https://www.example.com/",
          },
          "title": "example.com",
          "view": "web/page",
        },
        "a page read, with words": {
          "heading": "Forecast",
          "host": "forecast.weather.gov",
          "meta": "forecast.weather.gov",
          "open": {
            "url": "https://forecast.weather.gov/a",
          },
          "title": "Forecast",
          "view": "web/page",
          "words": "Sunny, then cold.",
        },
        "a search after a fetch": {
          "heading": "nashville weather",
          "meta": "2 results",
          "results": [
            {
              "host": "forecast.weather.gov",
              "isOpening": false,
              "title": "7-Day Forecast",
              "url": "https://forecast.weather.gov/a",
            },
            {
              "host": "wsmv.com",
              "isOpening": false,
              "title": undefined,
              "url": "https://www.wsmv.com/weather/",
            },
          ],
          "title": "nashville weather",
          "view": "web/results",
        },
        "nothing found": {
          "heading": "nashville weather",
          "title": "nashville weather",
          "view": "web/nothing-found",
        },
        "opening a page not among them": {
          "heading": "Opening example.com",
          "meta": "2 results",
          "open": {
            "url": "https://example.com/",
          },
          "title": "Opening example.com",
          "view": "web/opening",
        },
        "opening a result": {
          "heading": "nashville weather",
          "meta": "2 results",
          "open": {
            "url": "https://www.wsmv.com/weather#top",
          },
          "results": [
            {
              "host": "forecast.weather.gov",
              "isOpening": false,
              "title": "7-Day Forecast",
              "url": "https://forecast.weather.gov/a",
            },
            {
              "host": "wsmv.com",
              "isOpening": true,
              "title": undefined,
              "url": "https://www.wsmv.com/weather/",
            },
          ],
          "title": "Opening wsmv.com",
          "view": "web/opening",
        },
        "results": {
          "heading": "nashville weather",
          "meta": "2 results",
          "results": [
            {
              "host": "forecast.weather.gov",
              "isOpening": false,
              "title": "7-Day Forecast",
              "url": "https://forecast.weather.gov/a",
            },
            {
              "host": "wsmv.com",
              "isOpening": false,
              "title": undefined,
              "url": "https://www.wsmv.com/weather/",
            },
          ],
          "title": "nashville weather",
          "view": "web/results",
        },
        "results, with a fetch whose address has not come": {
          "heading": "nashville weather",
          "meta": "2 results",
          "results": [
            {
              "host": "forecast.weather.gov",
              "isOpening": false,
              "title": "7-Day Forecast",
              "url": "https://forecast.weather.gov/a",
            },
            {
              "host": "wsmv.com",
              "isOpening": false,
              "title": undefined,
              "url": "https://www.wsmv.com/weather/",
            },
          ],
          "title": "nashville weather",
          "view": "web/results",
        },
        "searching": {
          "heading": "nashville weather",
          "title": "nashville weather",
          "view": "web/searching",
        },
      }
    `);
  });
});

describe("a files card's face", () => {
  const faces = checkFaces([
    [
      "words arriving",
      "files/writing",
      card("files", [
        step({ kind: "file", path: "/w/notes.md", words: "# Hi" }, "writing"),
      ]),
    ],
    [
      "words of a call still running",
      "files/words",
      card("files", [
        step({ kind: "file", path: "/w/notes.md", words: "# Hi" }, "running"),
      ]),
    ],
    [
      "words written",
      "files/words",
      card("files", [
        step({ isNew: true, kind: "file", path: "/w/a.ts", words: "let a" }),
      ]),
    ],
    [
      "a page once written",
      "files/picture",
      card("files", [
        step({
          kind: "file",
          modifiedAt: 7,
          path: "/w/page.html",
          words: "<p>",
        }),
      ]),
    ],
    [
      "a page written, not yet found",
      "files/words",
      card("files", [
        step({ kind: "file", path: "/w/page.html", words: "<p>" }),
      ]),
      nowhere,
    ],
    [
      "an edit",
      "files/diff",
      card("files", [
        step({
          after: "b",
          before: "a",
          isNew: true,
          kind: "file",
          path: "/w/a.ts",
        }),
      ]),
    ],
    [
      "an edit adding only",
      "files/diff",
      card("files", [
        step({ after: "b", before: "", kind: "file", path: "/w/a.ts" }),
      ]),
    ],
    [
      "a file with no words",
      "files/picture",
      card("files", [step({ isNew: false, kind: "file", path: "/w/a.pdf" })]),
    ],
    [
      "what a shell call changed",
      "files/picture",
      card("files", [step(undefined)], { isNew: true, path: "/w/x.png" }),
    ],
    [
      "a file with no words, not yet found",
      "files/none",
      card("files", [step({ kind: "file", path: "/w/a.pdf" }, "running")]),
      nowhere,
    ],
  ]);

  it("names what each shows", () => {
    expect(faces).toMatchInlineSnapshot(`
      {
        "a file with no words": {
          "meta": "Updated",
          "open": {
            "file": "/w/a.pdf",
          },
          "picture": {
            "place": "/w/a.pdf",
          },
          "title": "a.pdf",
          "view": "files/picture",
        },
        "a file with no words, not yet found": {
          "meta": "Writing",
          "title": "a.pdf",
          "view": "files/none",
        },
        "a page once written": {
          "open": {
            "file": "/w/page.html",
          },
          "picture": {
            "place": "/w/page.html",
            "version": 7,
          },
          "title": "page.html",
          "view": "files/picture",
        },
        "a page written, not yet found": {
          "path": "/w/page.html",
          "title": "page.html",
          "view": "files/words",
          "words": "<p>",
        },
        "an edit": {
          "after": "b",
          "before": "a",
          "meta": "Updated",
          "open": {
            "file": "/w/a.ts",
          },
          "path": "/w/a.ts",
          "title": "a.ts",
          "view": "files/diff",
        },
        "an edit adding only": {
          "after": "b",
          "meta": "Updated",
          "open": {
            "file": "/w/a.ts",
          },
          "path": "/w/a.ts",
          "title": "a.ts",
          "view": "files/diff",
        },
        "what a shell call changed": {
          "meta": "New file",
          "open": {
            "file": "/w/x.png",
          },
          "picture": {
            "place": "/w/x.png",
          },
          "title": "x.png",
          "view": "files/picture",
        },
        "words arriving": {
          "meta": "Writing",
          "open": {
            "file": "/w/notes.md",
          },
          "path": "/w/notes.md",
          "title": "notes.md",
          "view": "files/writing",
          "words": "# Hi",
        },
        "words of a call still running": {
          "meta": "Writing",
          "open": {
            "file": "/w/notes.md",
          },
          "path": "/w/notes.md",
          "title": "notes.md",
          "view": "files/words",
          "words": "# Hi",
        },
        "words written": {
          "meta": "New file",
          "open": {
            "file": "/w/a.ts",
          },
          "path": "/w/a.ts",
          "title": "a.ts",
          "view": "files/words",
          "words": "let a",
        },
      }
    `);
  });
});

describe("an images card's face", () => {
  const image = (path: string, modifiedAt?: number) =>
    step({
      kind: "image",
      path,
      ...(modifiedAt !== undefined && { modifiedAt }),
    });

  const faces = checkFaces([
    [
      "the newest not yet found",
      "images/opening",
      card("images", [image("/w/a.png")]),
      nowhere,
    ],
    ["one picture", "images/pictures", card("images", [image("/w/a.png", 3)])],
    [
      "the latest six along a strip",
      "images/pictures",
      card(
        "images",
        Array.from({ length: 8 }, (_, at) => image(`/w/${at.toString()}.png`)),
      ),
    ],
    [
      "a picture not yet found, left out of the strip",
      "images/pictures",
      card("images", [image("/w/a.png"), image("/w/b.png")]),
      { places: { "/w/b.png": "/w/b.png" } },
    ],
  ]);

  it("names what each shows", () => {
    expect(faces).toMatchInlineSnapshot(`
      {
        "a picture not yet found, left out of the strip": {
          "meta": "2 images",
          "newest": {
            "place": "/w/b.png",
          },
          "open": {
            "file": "/w/b.png",
          },
          "strip": [
            {
              "place": "/w/b.png",
            },
          ],
          "title": "b.png",
          "view": "images/pictures",
        },
        "one picture": {
          "meta": "Opened",
          "newest": {
            "place": "/w/a.png",
            "version": 3,
          },
          "open": {
            "file": "/w/a.png",
          },
          "strip": [],
          "title": "a.png",
          "view": "images/pictures",
        },
        "the latest six along a strip": {
          "meta": "8 images",
          "newest": {
            "place": "/w/7.png",
          },
          "open": {
            "file": "/w/7.png",
          },
          "strip": [
            {
              "place": "/w/2.png",
            },
            {
              "place": "/w/3.png",
            },
            {
              "place": "/w/4.png",
            },
            {
              "place": "/w/5.png",
            },
            {
              "place": "/w/6.png",
            },
            {
              "place": "/w/7.png",
            },
          ],
          "title": "7.png",
          "view": "images/pictures",
        },
        "the newest not yet found": {
          "meta": "Opened",
          "title": "a.png",
          "view": "images/opening",
        },
      }
    `);
  });
});

describe("a generated card's face", () => {
  const faces = checkFaces([
    [
      "generating",
      "generated/generating",
      card("generated", [step({ kind: "generated" }, "running")]),
      nowhere,
    ],
    [
      "a picture",
      "generated/picture",
      card("generated", [
        step({ kind: "generated", modifiedAt: 4, path: "/w/cat.png" }),
      ]),
      { places: { "/w/cat.png": "/host/cat.png" } },
    ],
  ]);

  it("names what each shows", () => {
    expect(faces).toMatchInlineSnapshot(`
      {
        "a picture": {
          "open": {
            "file": "/host/cat.png",
          },
          "picture": {
            "place": "/host/cat.png",
            "version": 4,
          },
          "title": "cat.png",
          "view": "generated/picture",
        },
        "generating": {
          "title": "An image",
          "view": "generated/generating",
        },
      }
    `);
  });
});

describe("a page card's face", () => {
  const faces = checkFaces([
    [
      "nothing known",
      "page/picture",
      card("page", [step({ changesPage: true, kind: "page" })]),
      nowhere,
    ],
    [
      "an address",
      "page/picture",
      card("page", [
        step({
          changesPage: true,
          kind: "page",
          url: "https://www.example.com/a",
        }),
      ]),
      nowhere,
    ],
    [
      "the tab driven",
      "page/picture",
      card("page", [
        step({ changesPage: true, kind: "page", url: "https://example.com/a" }),
      ]),
      {
        drivenPage: { title: "Example", url: "https://other.com/" },
        places: {},
      },
    ],
    [
      "a file opened",
      "page/picture",
      card("page", [step({ kind: "opened", target: "/w/report.pdf" })]),
      nowhere,
    ],
    [
      "a file opened, found",
      "page/picture",
      card("page", [step({ kind: "opened", target: "/w/report.pdf" })]),
      { places: { "/w/report.pdf": "/host/report.pdf" } },
    ],
  ]);

  it("names what each shows", () => {
    expect(faces).toMatchInlineSnapshot(`
      {
        "a file opened": {
          "open": {
            "file": "/w/report.pdf",
          },
          "title": "report.pdf",
          "view": "page/picture",
        },
        "a file opened, found": {
          "open": {
            "file": "/host/report.pdf",
          },
          "title": "report.pdf",
          "view": "page/picture",
        },
        "an address": {
          "open": {
            "url": "https://www.example.com/a",
          },
          "title": "example.com",
          "view": "page/picture",
        },
        "nothing known": {
          "title": "A page",
          "view": "page/picture",
        },
        "the tab driven": {
          "open": {
            "url": "https://other.com/",
          },
          "title": "Example",
          "view": "page/picture",
        },
      }
    `);
  });
});
