import { describe, expect, it } from "vitest";

import {
  buildPost,
  mrkdwn,
  summarizeCommits,
  summarizeNotes,
} from "./release-summary";

const NOTES = `A release focused on a cleaner, more private built-in browser, more ways to connect AI providers, and app icons.

## Browser

- Ads and trackers are blocked by default. The filter lists are the ones popular ad blockers use; turn it off from "Block ads" in a page's menu.
- Searches go to DuckDuckGo. Address bar suggestions come from DuckDuckGo too.
- Agents can lift blocking for their own tabs. Your setting stays as you left it.

## Providers

- Sign in to several ChatGPT accounts. Each is listed as its own provider.

## Fixes and polish

- Tasks refuse instructions that point at places they cannot reach.
`;

describe("summarizeNotes", () => {
  it("keeps the summary line and the first bullets of each section", () => {
    expect(summarizeNotes(NOTES)).toMatchInlineSnapshot(`
      "A release focused on a cleaner, more private built-in browser, more ways to connect AI providers, and app icons.
      *Browser*: Ads and trackers are blocked by default; Searches go to DuckDuckGo _(+1 more)_
      *Providers*: Sign in to several ChatGPT accounts
      *Fixes and polish*: Tasks refuse instructions that point at places they cannot reach"
    `);
  });

  it("cuts a long lead at a word boundary", () => {
    const summary = summarizeNotes(
      `## Browser\n\n- ${"word ".repeat(40)}ends here. Detail.`,
    );
    expect(summary).toMatch(/^\*Browser\*: (word ){10,}word…$/);
  });

  it("is undefined for a tag cut without notes", () => {
    expect(summarizeNotes("")).toBeUndefined();
    expect(summarizeNotes("\n\n")).toBeUndefined();
  });

  it("skips a section with no bullets", () => {
    expect(summarizeNotes("Just a summary.\n\n## Empty\n")).toBe(
      "Just a summary.",
    );
  });
});

describe("summarizeCommits", () => {
  it("groups user-facing commits by scope, largest first", () => {
    const log = [
      "d68324e9d workspace: let a task turn ad blocking off for its own tabs",
      "7dac2a4aa studio: reload only the task tab on agent-browser reload",
      "2699ce60e studio: block ads and trackers in the task browser by default",
      "88c5550c2 studio: search and complete address-field words with DuckDuckGo",
      "bb9cfff4a ai-gateway: add OpenCode Go and Zen as API-key providers",
      "5ccd84067 lint: rename shadowed path and fs, and unexport file-local names",
      "248077b15 registry: pin skills to fa76d13",
      "66ff24909 release: v2.0.0-beta.46",
      "1a2b3c4d5 docs: plan the app directory uplift",
      "9f8e7d6c5 feat(apps): bundle an icon for 121 directory services",
    ].join("\n");
    expect(summarizeCommits(log)).toMatchInlineSnapshot(`
      "*App* (3): reload only the task tab on agent-browser reload; block ads and trackers in the task browser by default
      *Agent* (1): let a task turn ad blocking off for its own tabs
      *Models* (1): add OpenCode Go and Zen as API-key providers
      *Apps* (1): bundle an icon for 121 directory services"
    `);
  });

  it("puts skills under their own area and drops their plumbing", () => {
    expect(
      summarizeCommits(
        "",
        "fa76d13 dx: pin agent-hooks to 1.4.1\n1234567 create-page: scope the wireframe template",
      ),
    ).toMatchInlineSnapshot(`"*Skills* (1): scope the wireframe template"`);
  });

  it("collapses areas past the first five", () => {
    const log = ["a", "b", "c", "d", "e", "f", "g"]
      .map((scope, i) => `abcdef${i} ${scope}: change ${i}`)
      .join("\n");
    expect(summarizeCommits(log).split("\n").at(-1)).toBe("_+2 more areas_");
  });

  it("says so when nothing is user-facing", () => {
    expect(summarizeCommits("abcdef1 dx: tidy\nabcdef2 docs: note")).toBe(
      "_No user-facing changes in this release._",
    );
  });
});

describe("mrkdwn", () => {
  it.each([
    { expected: "a &lt;b&gt; &amp; c", input: "a <b> & c" },
    { expected: "*bold* text", input: "**bold** text" },
    {
      expected: "see <https://example.com|the page>",
      input: "see [the page](https://example.com)",
    },
  ])("converts $input", ({ expected, input }) => {
    expect(mrkdwn(input)).toBe(expected);
  });
});

describe("buildPost", () => {
  const release = {
    commits:
      "abc1234 studio: show typing dots right after you send\nabc1235 ci: cache the build",
    mention: "<!channel>",
    notes: NOTES,
    releaseUrl: "https://github.com/o/r/releases/tag/v2.0.0-beta.101",
    skillsCommits: "def5678 skills: teach the page skill to share",
    tag: "v2.0.0-beta.101",
  };

  it("leads a beta card with the notes and puts every bullet in the thread", () => {
    const { card, thread } = buildPost(release);
    expect(card).toMatchInlineSnapshot(`
      {
        "attachments": [
          {
            "blocks": [
              {
                "text": {
                  "text": ":desktop_computer: *Instrument beta v2.0.0-beta.101 is out*",
                  "type": "mrkdwn",
                },
                "type": "section",
              },
              {
                "text": {
                  "text": "A release focused on a cleaner, more private built-in browser, more ways to connect AI providers, and app icons.
      *Browser*: Ads and trackers are blocked by default; Searches go to DuckDuckGo _(+1 more)_
      *Providers*: Sign in to several ChatGPT accounts
      *Fixes and polish*: Tasks refuse instructions that point at places they cannot reach",
                  "type": "mrkdwn",
                },
                "type": "section",
              },
              {
                "elements": [
                  {
                    "text": "2 changes · 1 skill change · <https://github.com/o/r/releases/tag/v2.0.0-beta.101|Release notes>",
                    "type": "mrkdwn",
                  },
                ],
                "type": "context",
              },
            ],
            "color": "#14B8A6",
          },
        ],
        "text": "Instrument beta v2.0.0-beta.101 is out",
        "unfurl_links": false,
        "unfurl_media": false,
      }
    `);
    expect(thread).toMatchInlineSnapshot(`
      "*Browser*
      • Ads and trackers are blocked by default. The filter lists are the ones popular ad blockers use; turn it off from "Block ads" in a page's menu.
      • Searches go to DuckDuckGo. Address bar suggestions come from DuckDuckGo too.
      • Agents can lift blocking for their own tabs. Your setting stays as you left it.

      *Providers*
      • Sign in to several ChatGPT accounts. Each is listed as its own provider.

      *Fixes and polish*
      • Tasks refuse instructions that point at places they cannot reach."
    `);
  });

  it("asks for the draft to be published on a stable release", () => {
    const { card } = buildPost({ ...release, notes: "", tag: "v2.1.0" });
    expect(card.blocks).toMatchInlineSnapshot(`
      [
        {
          "text": {
            "text": "<!channel>: review and publish the draft GitHub release notes for this version.",
            "type": "mrkdwn",
          },
          "type": "section",
        },
      ]
    `);
  });

  it("marks a big release without notes", () => {
    const commits = Array.from(
      { length: 16 },
      (_, i) => `${String(i).padStart(7, "0")} studio: change ${i}`,
    ).join("\n");
    const { card, thread } = buildPost({ ...release, commits, notes: "" });
    expect(card.attachments[0]?.blocks[1]).toMatchInlineSnapshot(`
      {
        "text": {
          "text": ":warning: *Big release:* 16 changes went out without release notes.",
          "type": "mrkdwn",
        },
        "type": "section",
      }
    `);
    expect(thread?.split("\n").slice(0, 2)).toMatchInlineSnapshot(`
      [
        "*App* (16)",
        "• change 0",
      ]
    `);
  });
});
