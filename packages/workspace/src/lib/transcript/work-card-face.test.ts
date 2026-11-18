import { describe, expect, it } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { type TurnStep } from "./turns-of";
import { cardsOf, type WorkCard } from "./work-card";
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
        "a page once written": {
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
          "title": "example.com",
          "url": "https://www.example.com/a",
          "view": "page/picture",
        },
        "nothing known": {
          "title": "Browser",
          "url": undefined,
          "view": "page/picture",
        },
        "nothing known yet": {
          "title": "Opening a page",
          "url": undefined,
          "view": "page/picture",
        },
        "the tab driven": {
          "title": "Example",
          "url": "https://other.com/",
          "view": "page/picture",
        },
      }
    `);
  });
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
});
