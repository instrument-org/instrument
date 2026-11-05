import { expect, it } from "vitest";

import { actionRows } from "./feedback-actions";

const at = "2026-11-05T22:18:00.000Z";
const lines = (...actions: object[]) =>
  actions.map((action) => JSON.stringify({ at, ...action })).join("\n");

it("says what the person did as a sentence each, with where", () => {
  const rows = actionRows(
    lines(
      { kind: "file", path: "~/Downloads/Delgado & Sons quote.pdf" },
      {
        kind: "folder",
        path: "~/Downloads/Sam taxes 2025",
        selected: ["1099-INT Marcus.txt", "Old/"],
      },
      {
        from: "~/Downloads",
        kind: "move",
        names: ["a.pdf", "b.pdf", "c.pdf"],
        to: "~/Documents/Archive",
      },
      { kind: "trash", paths: ["~/Downloads/old.txt"] },
      { kind: "error", message: "Couldn't show “scan.heic”." },
      { id: "[other chat]", kind: "chat", title: "Kitchen remodel quotes" },
      { kind: "page", url: "https://hartwellbuilders.com/remodeling" },
      { kind: "screen", name: "Settings › General" },
      { kind: "setting", name: "Theme", value: "Dark" },
      { app: "Preview", kind: "open-with", path: "~/a.pdf" },
      { did: "sign-in failed", kind: "app", name: "linear" },
      { dropped: 3, kind: "capped", of: "day" },
    ),
    { trash: "Trash" },
  );
  expect(rows.map(({ what, where }) => [what, where])).toMatchInlineSnapshot(`
    [
      [
        "Opened “Delgado & Sons quote.pdf”",
        "~/Downloads",
      ],
      [
        "Opened the folder “Sam taxes 2025” and selected “1099-INT Marcus.txt” and “Old”",
        "~/Downloads/Sam taxes 2025",
      ],
      [
        "Moved “a.pdf”, “b.pdf” and “c.pdf”",
        "From ~/Downloads to ~/Documents/Archive",
      ],
      [
        "Moved “old.txt” to the Trash",
        "~/Downloads",
      ],
      [
        "Saw this error: Couldn't show “scan.heic”.",
        undefined,
      ],
      [
        "Opened the chat “Kitchen remodel quotes”",
        undefined,
      ],
      [
        "Visited hartwellbuilders.com/remodeling",
        undefined,
      ],
      [
        "Opened Settings › General",
        undefined,
      ],
      [
        "Changed “Theme” to Dark",
        undefined,
      ],
      [
        "Opened “a.pdf” in Preview",
        "~",
      ],
      [
        "Couldn't sign in to linear",
        undefined,
      ],
      [
        "Stopped writing down what you did for the rest of the day, because there was too much.",
        undefined,
      ],
    ]
  `);
  expect(rows[0]?.at).toBe(at);
});

it("lists the first few of many names and says how many more", () => {
  const [row] = actionRows(
    lines({
      from: "~/a",
      kind: "copy",
      names: ["1", "2", "3", "4", "5", "6"],
      to: "~/b",
    }),
    { trash: "Trash" },
  );
  expect(row?.what).toBe("Copied “1”, “2”, “3” and 3 more");
});

it("leaves out a line that will not read, and names a kind it does not know", () => {
  const rows = actionRows(
    [
      "not json",
      JSON.stringify({ kind: "file" }),
      lines({ kind: "hum" }),
      "",
    ].join("\n"),
    { trash: "Trash" },
  );
  expect(rows.map((row) => row.what)).toEqual(["hum"]);
});
