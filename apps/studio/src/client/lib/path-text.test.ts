import { describe, expect, it } from "vitest";

import {
  findPaths,
  pathToQuote,
  shortPathLabel,
  splitPaths,
} from "./path-text";

describe("pathToQuote", () => {
  it.each([
    ["win32", "D:\\Games\\World of Warcraft", "D:\\Games\\World of Warcraft"],
    ["win32", "\\\\nas\\Media\\TV Shows", "\\\\nas\\Media\\TV Shows"],
    ["darwin", "/Users/me/My Docs", "/Users/me/My Docs"],
    ["darwin", "~/My Docs", "~/My Docs"],
    ["darwin", "file:///Users/me/My Docs", "/Users/me/My Docs"],
    // Read whole only as a question for the disk, which finds nothing.
    [
      "win32",
      "D:\\Games\\World of Warcraft dude",
      "D:\\Games\\World of Warcraft dude",
    ],
  ])("asks about a path with spaces: %s %s", (platform, line, shown) => {
    expect(pathToQuote(line, platform)?.shown).toBe(shown);
  });

  it.each([
    ["win32", "look in D:\\Games\\World of Warcraft please"],
    ["win32", "D:\\Games\\World"],
    ["win32", 'D:\\Games\\"World of Warcraft"'],
    ["win32", '"D:\\Games\\World of Warcraft"'],
    ["win32", "D:\\Games\\World of Warcraft\nand more"],
    ["win32", "D:\\Games\\World of Warcraft\r\nand more"],
    ["win32", " D:\\Games\\World of Warcraft "],
    ["darwin", "/Users/me/My Docs/report.pdf"],
    ["darwin", "/Users/me/My\\ Docs"],
    ["darwin", "D:\\Games\\World of Warcraft"],
    ["darwin", "two plain words"],
  ])("leaves anything else alone: %s %s", (platform, line) => {
    expect(pathToQuote(line, platform)).toBeUndefined();
  });
});

describe("splitPaths", () => {
  it.each(['"', "'", "`"])("leaves the %s around a path out", (quote) => {
    expect(
      splitPaths(`see ${quote}D:\\My Games${quote} dude`, "win32").map(
        ({ text }) => text,
      ),
    ).toEqual(["see ", "D:\\My Games", " dude"]);
  });

  it("keeps a quote around words that are no path", () => {
    expect(splitPaths('say "hello there" /etc/hosts', "darwin")).toMatchObject([
      { text: 'say "hello there" ', type: "text" },
      { text: "/etc/hosts", type: "path" },
    ]);
  });
});

/** Each line with the paths found in it as the text they span. */
const pathsIn = (lines: string[], platform: string) =>
  Object.fromEntries(
    lines.map((line) => [
      line,
      findPaths(line, platform).map(({ from, to }) => line.slice(from, to)),
    ]),
  );

describe("findPaths", () => {
  it("finds the paths a person plainly wrote on a Mac", () => {
    expect(
      pathsIn(
        [
          "/Users/casey/Documents/report.pdf",
          "Look at /Users/casey/Documents/report.pdf, please.",
          "Compare ~/notes/a.md and ~/notes/b.md",
          "The folder (/Users/casey/Projects) is empty",
          "file:///Users/casey/a%20b.html",
          "/Users/casey/My Docs/Annual Report.pdf",
          "/Users/casey/Acme Corp/",
          "Open /Users/casey/My Docs/report.pdf now",
          "Open /Users/casey/My\\ Docs/report.pdf now",
          'Open "/Users/casey/My Docs/Q3 numbers" now',
          "Open `/tmp/out.log` now",
          "/src/lib/utils.ts is broken",
          "/Users/casey/foo is broken",
        ],
        "darwin",
      ),
    ).toMatchInlineSnapshot(`
      {
        "/Users/casey/Acme Corp/": [
          "/Users/casey/Acme Corp/",
        ],
        "/Users/casey/Documents/report.pdf": [
          "/Users/casey/Documents/report.pdf",
        ],
        "/Users/casey/My Docs/Annual Report.pdf": [
          "/Users/casey/My Docs/Annual Report.pdf",
        ],
        "/Users/casey/foo is broken": [
          "/Users/casey/foo",
        ],
        "/src/lib/utils.ts is broken": [
          "/src/lib/utils.ts",
        ],
        "Compare ~/notes/a.md and ~/notes/b.md": [
          "~/notes/a.md",
          "~/notes/b.md",
        ],
        "Look at /Users/casey/Documents/report.pdf, please.": [
          "/Users/casey/Documents/report.pdf",
        ],
        "Open "/Users/casey/My Docs/Q3 numbers" now": [
          "/Users/casey/My Docs/Q3 numbers",
        ],
        "Open /Users/casey/My Docs/report.pdf now": [
          "/Users/casey/My Docs/report.pdf",
        ],
        "Open /Users/casey/My\\ Docs/report.pdf now": [
          "/Users/casey/My\\ Docs/report.pdf",
        ],
        "Open \`/tmp/out.log\` now": [
          "/tmp/out.log",
        ],
        "The folder (/Users/casey/Projects) is empty": [
          "/Users/casey/Projects",
        ],
        "file:///Users/casey/a%20b.html": [
          "file:///Users/casey/a%20b.html",
        ],
      }
    `);
  });

  it("leaves what is not plainly a path as text on a Mac", () => {
    expect(
      pathsIn(
        [
          "Use /release to ship",
          "/r/rust is a subreddit",
          "and/or src/lib/utils.ts",
          "https://example.com/Users/casey",
          "about ~ 5 minutes",
          "Divide by /",
          "C:\\Users\\casey\\a.txt",
          'An unclosed "/Users/casey',
        ],
        "darwin",
      ),
    ).toMatchInlineSnapshot(`
      {
        "/r/rust is a subreddit": [],
        "An unclosed "/Users/casey": [],
        "C:\\Users\\casey\\a.txt": [],
        "Divide by /": [],
        "Use /release to ship": [],
        "about ~ 5 minutes": [],
        "and/or src/lib/utils.ts": [],
        "https://example.com/Users/casey": [],
      }
    `);
  });

  it("finds Windows paths on Windows", () => {
    expect(
      pathsIn(
        [
          "C:\\Users\\casey\\Documents\\report.docx",
          "Open C:\\Users\\casey\\a.txt and \\\\server\\share\\b.txt",
          "Try ~\\Downloads\\setup.exe",
          "/c/Users/casey/x.txt",
          "/r/rust",
        ],
        "win32",
      ),
    ).toMatchInlineSnapshot(`
      {
        "/c/Users/casey/x.txt": [
          "/c/Users/casey/x.txt",
        ],
        "/r/rust": [],
        "C:\\Users\\casey\\Documents\\report.docx": [
          "C:\\Users\\casey\\Documents\\report.docx",
        ],
        "Open C:\\Users\\casey\\a.txt and \\\\server\\share\\b.txt": [
          "C:\\Users\\casey\\a.txt",
          "\\\\server\\share\\b.txt",
        ],
        "Try ~\\Downloads\\setup.exe": [
          "~\\Downloads\\setup.exe",
        ],
      }
    `);
  });
});

describe("shortPathLabel", () => {
  it("keeps where a long path starts and the names at its end", () => {
    expect(
      [
        "~/Documents/old-report.pdf",
        "/Users/casey/code/instrument/apps/studio/src/client/components/path-chip.tsx",
        "/Users/casey/Documents/Q3 numbers/summary.xlsx",
        "~/Library/Mobile Documents/com~apple~CloudDocs/Taxes/2026/receipts-for-the-accountant.pdf",
        "C:\\Users\\casey\\AppData\\Local\\Programs\\Instrument\\resources\\app.asar",
        "/private/tmp/a-very-long-folder-name-that-runs-on/x.txt",
      ].map(shortPathLabel),
    ).toMatchInlineSnapshot(`
      [
        "~/Documents/old-report.pdf",
        "/Users/…/components/path-chip.tsx",
        "/Users/…/Q3 numbers/summary.xlsx",
        "~/…/2026/receipts-for-the-accountant.pdf",
        "C:\\…\\resources\\app.asar",
        "/private/…/x.txt",
      ]
    `);
  });
});
