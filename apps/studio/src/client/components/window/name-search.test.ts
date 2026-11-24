import { foldWords, MATCH_STEPS } from "@/shared/name-match";
import { describe, expect, it } from "vitest";

import {
  findNamed,
  type Named,
  orderSearch,
  rangesOf,
  usageOf,
} from "./name-search";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1000 * DAY_MS;

const named = (
  id: string,
  name: string,
  rest: Partial<Named<null>> = {},
): Named<null> => ({ id, name, value: null, ...rest });

const FOLDERS = [
  named("folder:wireframes", "wireframes", { pinned: true }),
  named("folder:downloads", "Downloads", { pinned: true }),
];
const CHATS = [
  named("chat:review", "Review the wireframes", {
    use: usageOf({ at: NOW }, NOW),
  }),
  named("chat:kit", "Wireframe kit ideas", {
    use: usageOf({ at: NOW - DAY_MS }, NOW),
  }),
  named("chat:new", "New wireframes for the phone", {
    use: usageOf({ at: NOW - 2 * DAY_MS }, NOW),
  }),
];

/** The menu's results for words, as the ids of the promoted row and of each section's rows. */
function ordered(
  typed: string,
  kinds: { entries: Named<null>[]; label: string }[],
  remembered?: string,
) {
  const words = foldWords(typed);
  const { promoted, sections } = orderSearch({
    kinds: kinds.map((kind) => ({
      found: findNamed(kind.entries, words),
      label: kind.label,
    })),
    perKind: 3,
    remembered,
  });
  return {
    promoted: promoted?.entry.id,
    sections: sections.map(
      (section) =>
        `${section.label}: ${section.rows.map((row) => row.entry.id).join(", ")}`,
    ),
  };
}

const KINDS = [
  { entries: FOLDERS, label: "Files" },
  { entries: CHATS, label: "Chats" },
];

describe("how much something is used", () => {
  it("halves for every week since it was last opened", () => {
    expect(usageOf({ at: NOW }, NOW)).toBe(1);
    expect(usageOf({ at: NOW - 7 * DAY_MS }, NOW)).toBe(0.5);
    expect(usageOf({ at: NOW - 14 * DAY_MS, count: 8 }, NOW)).toBe(2);
  });

  it("is nothing for what was never opened", () => {
    expect(usageOf({ at: 0, count: 3 }, NOW)).toBe(0);
  });
});

describe("the command menu's results", () => {
  it("promotes a pinned folder the words start over chats that contain them", () => {
    expect(ordered("wireframes", KINDS)).toMatchInlineSnapshot(`
      {
        "promoted": "folder:wireframes",
        "sections": [
          "Chats: chat:review, chat:new",
        ],
      }
    `);
    expect(ordered("wire", KINDS)).toMatchInlineSnapshot(`
      {
        "promoted": "folder:wireframes",
        "sections": [
          "Chats: chat:kit, chat:review, chat:new",
        ],
      }
    `);
  });

  it("promotes a pinned name the words start over an unpinned one they are", () => {
    expect(
      ordered("wire", [
        { entries: FOLDERS, label: "Files" },
        { entries: [named("chat:wire", "Wire")], label: "Chats" },
      ]).promoted,
    ).toBe("folder:wireframes");
  });

  it("orders the sections by their best match, and ties as the kinds were given", () => {
    const kinds = [
      {
        entries: [named("file:notes", "meeting-notes.md")],
        label: "Files",
      },
      {
        entries: [named("chat:notes", "Notes for the board")],
        label: "Chats",
      },
      {
        entries: [named("page:keynotes", "Keynotes of the year")],
        label: "Pages",
      },
      {
        entries: [named("command:notes", "Notes")],
        label: "Commands",
      },
    ];
    // The command is the words exactly and is promoted out of its section,
    // which still goes by it; then the chat the words start, then the file
    // with a word they start, then the page that only contains them.
    expect(ordered("notes", kinds)).toMatchInlineSnapshot(`
      {
        "promoted": "command:notes",
        "sections": [
          "Chats: chat:notes",
          "Files: file:notes",
          "Pages: page:keynotes",
        ],
      }
    `);
    expect(ordered("not", [...kinds].slice(0, 2).reverse()).sections).toEqual([
      "Files: file:notes",
    ]);
  });

  it("promotes nothing when the best match only starts a later word", () => {
    expect(
      ordered("frames", [
        { entries: [named("file:a", "wire-frames.html")], label: "Files" },
        { entries: [named("chat:b", "Picture frames")], label: "Chats" },
      ]),
    ).toMatchInlineSnapshot(`
      {
        "promoted": undefined,
        "sections": [
          "Files: file:a",
          "Chats: chat:b",
        ],
      }
    `);
  });

  it("puts the remembered pick first while the words still find it", () => {
    expect(ordered("wire", KINDS, "chat:new")).toMatchInlineSnapshot(`
      {
        "promoted": "chat:new",
        "sections": [
          "Files: folder:wireframes",
          "Chats: chat:kit, chat:review",
        ],
      }
    `);
    expect(ordered("down", KINDS, "chat:new").promoted).toBe(
      "folder:downloads",
    );
  });

  it("lists three of a kind at most", () => {
    const chats = ["a", "b", "c", "d", "e"].map((letter) =>
      named(`chat:${letter}`, `Plan ${letter} notes`),
    );
    expect(
      ordered("notes", [{ entries: chats, label: "Chats" }]).sections,
    ).toEqual(["Chats: chat:a, chat:b, chat:c"]);
  });
});

describe("a thing with a second name", () => {
  const page = named("page:pulls", "Pull requests", {
    also: { name: "github.com/acme/app/pulls" },
  });
  const tab = named("settings-apps", "Apps", {
    also: { atBest: MATCH_STEPS.inside, name: "Settings" },
  });

  it("is found by the better of the two, and draws only what its shown name matched", () => {
    const words = foldWords("git");
    const [found] = findNamed([page], words);
    expect(found?.step).toBe(MATCH_STEPS.startsName);
    expect(found && rangesOf(found, words)).toBeNull();

    const title = foldWords("pull");
    const [byTitle] = findNamed([page], title);
    expect(byTitle && rangesOf(byTitle, title)).toEqual([0, 4]);
  });

  it("counts for no more than its second name is worth", () => {
    const words = foldWords("settings");
    expect(
      findNamed([tab, named("settings", "Settings")], words).map(
        (found) => `${found.entry.id} ${found.step}`,
      ),
    ).toEqual(["settings 0", "settings-apps 4"]);
  });
});

describe("one wrong letter", () => {
  it("finds a name only when asked to", () => {
    const words = foldWords("wirefarmes");
    expect(findNamed(FOLDERS, words)).toEqual([]);
    expect(
      findNamed(FOLDERS, words, true).map(
        (found) => `${found.entry.id} ${found.step}`,
      ),
    ).toEqual([`folder:wireframes ${MATCH_STEPS.wrongLetter}`]);
  });
});
