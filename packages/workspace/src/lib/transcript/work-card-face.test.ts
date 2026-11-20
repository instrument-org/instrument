import { describe, expect, it } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { type TurnStep } from "./turns-of";
import { cardsOf, pageDrawsEnough, type WorkCard } from "./work-card";
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
      "a page arriving",
      "files/page",
      card("files", [
        step(
          {
            kind: "file",
            path: "/w/page.html",
            source: "<!doctype html><h1>Hi",
            words: "<h1>Hi",
          },
          "writing",
        ),
      ]),
      nowhere,
    ],
    [
      "a page once written",
      "files/page",
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
      "a page a shell call changed",
      "files/page",
      card("files", [step(undefined)], { isNew: false, path: "/w/page.html" }),
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
    [
      "a drawing written",
      "files/picture",
      card("files", [
        step({ isNew: true, kind: "file", path: "/w/a.svg", words: "<svg>" }),
      ]),
    ],
    [
      "a drawing written, not yet found",
      "files/none",
      card("files", [
        step({ isNew: true, kind: "file", path: "/w/a.svg", words: "<svg>" }),
      ]),
      nowhere,
    ],
  ]);

  it("names what each shows", () => {
    expect(faces).toMatchInlineSnapshot(`
      {
        "a drawing written": {
          "meta": "New file",
          "picture": {
            "place": "/w/a.svg",
          },
          "title": "a.svg",
          "view": "files/picture",
        },
        "a drawing written, not yet found": {
          "meta": "New file",
          "path": "/w/a.svg",
          "title": "a.svg",
          "view": "files/none",
        },
        "a file with no words": {
          "meta": "Updated",
          "picture": {
            "place": "/w/a.pdf",
          },
          "title": "a.pdf",
          "view": "files/picture",
        },
        "a file with no words, not yet found": {
          "meta": "Writing",
          "path": "/w/a.pdf",
          "title": "a.pdf",
          "view": "files/none",
        },
        "a page a shell call changed": {
          "isWriting": false,
          "meta": "Updated",
          "path": "/w/page.html",
          "place": "/w/page.html",
          "title": "page.html",
          "view": "files/page",
        },
        "a page arriving": {
          "isWriting": true,
          "meta": "Writing",
          "path": "/w/page.html",
          "source": "<!doctype html><h1>Hi",
          "title": "page.html",
          "view": "files/page",
        },
        "a page once written": {
          "isWriting": false,
          "path": "/w/page.html",
          "place": "/w/page.html",
          "title": "page.html",
          "version": 7,
          "view": "files/page",
        },
        "what a shell call changed": {
          "meta": "New file",
          "picture": {
            "place": "/w/x.png",
          },
          "title": "x.png",
          "view": "files/picture",
        },
        "words arriving": {
          "meta": "Writing",
          "path": "/w/notes.md",
          "title": "notes.md",
          "view": "files/writing",
          "words": "# Hi",
        },
        "words of a call still running": {
          "meta": "Writing",
          "path": "/w/notes.md",
          "title": "notes.md",
          "view": "files/words",
          "words": "# Hi",
        },
        "words written": {
          "meta": "New file",
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
          "strip": [],
          "title": "b.png",
          "view": "images/pictures",
        },
        "one picture": {
          "meta": "Opened",
          "newest": {
            "place": "/w/a.png",
            "version": 3,
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
          "picture": {
            "place": "/host/cat.png",
            "version": 4,
          },
          "title": "cat.png",
          "view": "generated/picture",
        },
        "generating": {
          "title": "Generating the image",
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
      "nothing known yet",
      "page/picture",
      card("page", [step({ changesPage: true, kind: "page" }, "running")]),
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
  ]);

  it("names what each shows", () => {
    expect(faces).toMatchInlineSnapshot(`
      {
        "an address": {
          "isGoing": false,
          "title": "example.com",
          "url": "https://www.example.com/a",
          "view": "page/picture",
        },
        "nothing known": {
          "isGoing": false,
          "title": "Browser",
          "url": undefined,
          "view": "page/picture",
        },
        "nothing known yet": {
          "isGoing": true,
          "title": "Opening a page",
          "url": undefined,
          "view": "page/picture",
        },
        "the tab driven": {
          "isGoing": false,
          "title": "Example",
          "url": "https://other.com/",
          "view": "page/picture",
        },
      }
    `);
  });
});

describe("the file a shell call changed", () => {
  const changed = (...files: [string, "created" | "changed"][]): TurnStep => ({
    ...step(undefined),
    facts: {
      apps: [],
      counts: [],
      files: files.map(([path, change]) => ({ change, path, via: "disk" })),
      hosts: [],
      settled: true,
      step: StoreId.newPartId(),
    },
  });
  const cardFile = (of: TurnStep) =>
    cardsOf({ steps: [of] }).map((made) => made.changedFile?.path);

  it.each([
    ["data it saves", [["/w/sources.json", "created"]], []],
    ["code it saves", [["/w/build.py", "changed"]], []],
    ["a note it writes", [["/w/notes.md", "created"]], ["/w/notes.md"]],
    ["a table it saves", [["/w/rows.csv", "created"]], ["/w/rows.csv"]],
    [
      "a page beside its notes",
      [
        ["/w/index.html", "created"],
        ["/w/request.md", "created"],
      ],
      ["/w/index.html"],
    ],
    [
      "two notes",
      [
        ["/w/a.md", "created"],
        ["/w/b.md", "created"],
      ],
      [],
    ],
    [
      "two pages",
      [
        ["/w/a.html", "created"],
        ["/w/b.html", "created"],
      ],
      [],
    ],
  ] satisfies [string, [string, "created" | "changed"][], string[]][])(
    "%s",
    (_name, files, shown) => {
      expect(cardFile(changed(...files))).toEqual(shown);
    },
  );
});

describe("the calls a card shows", () => {
  it("leaves out a call waiting its turn behind the one running", () => {
    const running = step(
      { changesPage: true, kind: "page", url: "https://a.example/" },
      "running",
    );
    const queued = step(
      { changesPage: true, kind: "page", url: "https://b.example/" },
      "queued",
    );
    expect(cardsOf({ steps: [running, queued] })).toEqual([
      { changedFile: undefined, kind: "page", steps: [running] },
    ]);
  });

  it("leaves out a call still being written while one before it in its message runs", () => {
    const running = step(undefined, "running");
    const writing = {
      ...step({ kind: "file", path: "/w/a.md", words: "#" }, "writing"),
      metadata: running.metadata,
    };
    writing.metadata = { ...running.metadata, id: StoreId.newPartId() };
    expect(cardsOf({ steps: [running, writing] })).toEqual([]);
    expect(cardsOf({ steps: [writing] })).toHaveLength(1);
  });

  it("shows a page as it is written, and while it waits its turn, whatever is ahead of it", () => {
    const running = step(
      { kind: "file", path: "/w/request.md", words: "#" },
      "running",
    );
    const page = (status: TurnStep["status"]) => ({
      ...write(
        { kind: "file", path: "/w/page.html", source: "<h1>Hi" },
        status,
      ),
      metadata: { ...running.metadata, id: StoreId.newPartId() },
    });
    for (const status of ["writing", "queued"] as const) {
      const shown = page(status);
      expect(cardsOf({ steps: [running, shown] }).at(-1)?.steps).toEqual([
        shown,
      ]);
    }
  });

  it.each([
    ["prose", "/w/notes.md", true, true],
    ["plain text", "/w/notes.txt", true, true],
    ["code", "/w/scrape.py", false, false],
    ["styles", "/w/site.css", false, false],
    ["data", "/w/rows.json", false, false],
    ["a file with no extension", "/w/Makefile", false, false],
    ["a drawing", "/w/chart.svg", false, true],
    ["a table", "/w/rows.csv", false, true],
    ["a page", "/w/page.html", false, true],
  ])(
    "shows %s written whole as it is written (%s: %s) and once written (%s)",
    (_kind, path, asWritten, once) => {
      const shows = { kind: "file", path, words: "a" } as const;
      expect(cardsOf({ steps: [write(shows, "writing")] })).toHaveLength(
        asWritten ? 1 : 0,
      );
      expect(cardsOf({ steps: [write(shows)] })).toHaveLength(once ? 1 : 0);
    },
  );

  it("opens a page's card once its source draws enough, and keeps it as more comes", () => {
    const opensAt = PAGE.indexOf("<h1>Plan") + "<h1>P".length;
    const shown = Array.from(
      { length: PAGE.length + 1 },
      (_, end) =>
        cardsOf({
          steps: [
            write(
              {
                kind: "file",
                path: "/w/page.html",
                source: PAGE.slice(0, end),
              },
              "writing",
            ),
          ],
        }).length > 0,
    );
    expect(shown.indexOf(true)).toBe(opensAt);
    expect(shown.slice(opensAt).every(Boolean)).toBe(true);
  });

  it("keeps the card before a write with nothing to show up", () => {
    const notes = write({ kind: "file", path: "/w/notes.md", words: "#" });
    const later = (shows: TurnStep["shows"]) =>
      cardsOf({ steps: [notes, write(shows, "writing")] }).at(-1)?.steps;
    expect(later({ kind: "file", path: "/w/scrape.py", words: "x" })).toEqual([
      notes,
    ]);
    expect(
      later({ kind: "file", path: "/w/page.html", source: PAGE.slice(0, 80) }),
    ).toEqual([notes]);
  });
});

/** A call writing a file whole. */
const write = (shows: TurnStep["shows"], status?: TurnStep["status"]) => ({
  ...step(shows, status),
  tool: "tool-write_file" as const,
});

/** A page as the page skill's pages open: a head of styles and a script, then the body. */
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>A plan for the spring launch, with every date and owner</title>
<style>
  body { font: 16px/1.5 Inter, sans-serif; } h1 { font-size: 2rem; }
  .lede { color: #555; } /* <h1>not this</h1> */
</style>
<script>document.documentElement.dataset.ready = "<h1>nor this</h1>";</script>
</head>
<body>
<!-- <h1>a heading left out</h1> -->
<header><nav><a href="#dates">Dates</a></nav></header>
<main>
<h1>Plan for the spring launch</h1>
<p class="lede">Three dates, two owners, and one open question.</p>
</main>
</body>
</html>`;

describe("whether a page arriving draws enough", () => {
  it.each([
    ["its head alone", false, PAGE.slice(0, PAGE.indexOf("<body>"))],
    ["a heading with no words yet", false, "<body><h1><span class="],
    ["a heading with words", true, "<body><h1>Plan"],
    ["a picture still being written", false, '<body><img src="chart.p'],
    ["a picture", true, '<body><img src="chart.png">'],
    ["a drawing", true, "<body><svg viewBox='0 0 10 10'>"],
    ["a few lines of text", true, `<body><p>${"word ".repeat(42)}`],
    ["a line of text", false, `<body><p>${"word ".repeat(30)}`],
    ["text in a script", false, `<body><script>${"word ".repeat(80)}`],
    ["text in a comment", false, `<body><!-- ${"word ".repeat(80)}`],
  ])("from %s: %s", (_name, enough, source) => {
    expect(pageDrawsEnough(source)).toBe(enough);
  });
});
