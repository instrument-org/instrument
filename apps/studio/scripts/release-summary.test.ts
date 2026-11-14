import { describe, expect, it } from "vitest";

import { buildPost, mrkdwn, richInline, updateBodies } from "./release-summary";

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

const release = {
  commits:
    "abc1234 studio: show typing dots right after you send\nabc1235 ci: cache the build",
  mention: "<@U0123>",
  notes: NOTES,
  releaseUrl: "https://github.com/o/r/releases/tag/untagged-1a2b3c",
  skillsCommits: "def5678 skills: teach the page skill to share",
  tag: "v2.1.0",
};

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

describe("richInline", () => {
  it("keeps text as written and turns bold and links into elements", () => {
    expect(
      richInline("Use **Ask** & see [the page](https://example.com) <now>"),
    ).toMatchInlineSnapshot(`
      [
        {
          "text": "Use ",
          "type": "text",
        },
        {
          "style": {
            "bold": true,
          },
          "text": "Ask",
          "type": "text",
        },
        {
          "text": " & see ",
          "type": "text",
        },
        {
          "text": "the page",
          "type": "link",
          "url": "https://example.com",
        },
        {
          "text": " <now>",
          "type": "text",
        },
      ]
    `);
  });
});

describe("buildPost", () => {
  it("tags a stable release's card as a draft and asks for it in the thread", () => {
    const { card, thread } = buildPost(release);
    expect(card).toMatchInlineSnapshot(`
      {
        "blocks": [
          {
            "elements": [
              {
                "elements": [
                  {
                    "style": {
                      "bold": true,
                    },
                    "text": "Instrument 2.1.0 is out",
                    "type": "text",
                  },
                  {
                    "text": "  ",
                    "type": "text",
                  },
                  {
                    "color": "yellow",
                    "text": "Notes in draft",
                    "type": "tag",
                  },
                ],
                "type": "rich_text_section",
              },
            ],
            "type": "rich_text",
          },
          {
            "elements": [
              {
                "elements": [
                  {
                    "text": "A release focused on a cleaner, more private built-in browser, more ways to connect AI providers, and app icons.",
                    "type": "text",
                  },
                ],
                "type": "rich_text_section",
              },
            ],
            "type": "rich_text",
          },
          {
            "elements": [
              {
                "action_id": "review_draft",
                "style": "primary",
                "text": {
                  "text": "Review the draft",
                  "type": "plain_text",
                },
                "type": "button",
                "url": "https://github.com/o/r/releases/tag/untagged-1a2b3c",
              },
            ],
            "type": "actions",
          },
        ],
        "text": "Instrument 2.1.0 is out, and its notes are a draft",
        "unfurl_links": false,
        "unfurl_media": false,
      }
    `);
    expect(thread).toMatchInlineSnapshot(`
      "<@U0123> the notes for 2.1.0 are a draft on GitHub. Read them over and publish them when they look right.

      *Browser*
      • Ads and trackers are blocked by default. The filter lists are the ones popular ad blockers use; turn it off from "Block ads" in a page's menu.
      • Searches go to DuckDuckGo. Address bar suggestions come from DuckDuckGo too.
      • Agents can lift blocking for their own tabs. Your setting stays as you left it.

      *Providers*
      • Sign in to several ChatGPT accounts. Each is listed as its own provider.

      *Fixes and polish*
      • Tasks refuse instructions that point at places they cannot reach.

      _2 changes · 1 skill change · <https://github.com/o/r/releases/tag/v2.1.0|Release on GitHub>_"
    `);
  });

  it("tags a published release and drops the button", () => {
    const { card, thread } = buildPost({ ...release, published: true });
    expect(card.blocks).toMatchInlineSnapshot(`
      [
        {
          "elements": [
            {
              "elements": [
                {
                  "style": {
                    "bold": true,
                  },
                  "text": "Instrument 2.1.0 is out",
                  "type": "text",
                },
                {
                  "text": "  ",
                  "type": "text",
                },
                {
                  "color": "green",
                  "text": "Published",
                  "type": "tag",
                },
              ],
              "type": "rich_text_section",
            },
          ],
          "type": "rich_text",
        },
        {
          "elements": [
            {
              "elements": [
                {
                  "text": "A release focused on a cleaner, more private built-in browser, more ways to connect AI providers, and app icons.",
                  "type": "text",
                },
              ],
              "type": "rich_text_section",
            },
          ],
          "type": "rich_text",
        },
      ]
    `);
    expect(thread?.split("\n")[0]).toBe("*Browser*");
  });

  it("names a beta plainly, with no tag or button", () => {
    const { card } = buildPost({
      ...release,
      releaseUrl: "https://github.com/o/r/releases/tag/v2.0.0-beta.139",
      tag: "v2.0.0-beta.139",
    });
    expect(card.text).toBe("Instrument 2.0.0 beta 139 is out");
    expect(card.blocks).toHaveLength(2);
    expect(card.blocks[0]).toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "elements": [
              {
                "style": {
                  "bold": true,
                },
                "text": "Instrument 2.0.0 beta 139 is out",
                "type": "text",
              },
            ],
            "type": "rich_text_section",
          },
        ],
        "type": "rich_text",
      }
    `);
  });

  it("says when a release has no notes, and lists the commits in the thread", () => {
    const { card, thread } = buildPost({ ...release, notes: "" });
    expect(card.blocks[1]).toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "elements": [
              {
                "text": "This release has no notes. Its 2 changes are listed in the thread.",
                "type": "text",
              },
            ],
            "type": "rich_text_section",
          },
        ],
        "type": "rich_text",
      }
    `);
    expect(thread).toMatchInlineSnapshot(`
      "<@U0123> the notes for 2.1.0 are a draft on GitHub. Read them over and publish them when they look right.

      *App* (1)
      • show typing dots right after you send

      *ci* (1)
      • cache the build

      *Skills* (1)
      • teach the page skill to share

      _2 changes · 1 skill change · <https://github.com/o/r/releases/tag/v2.1.0|Release on GitHub>_"
    `);
  });

  it("marks a big release without notes", () => {
    const commits = Array.from(
      { length: 16 },
      (_, i) => `${String(i).padStart(7, "0")} studio: change ${i}`,
    ).join("\n");
    const { card, thread } = buildPost({ ...release, commits, notes: "" });
    expect(card.blocks[1]).toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "elements": [
              {
                "text": "16 changes went out without release notes. They are listed in the thread.",
                "type": "text",
              },
            ],
            "type": "rich_text_section",
          },
        ],
        "type": "rich_text",
      }
    `);
    expect(thread?.split("\n").slice(2, 4)).toMatchInlineSnapshot(`
      [
        "*App* (16)",
        "• change 0",
      ]
    `);
  });

  it("names the sections when the notes have no summary line", () => {
    const { card } = buildPost({
      ...release,
      notes:
        "## Chats\n\n- One.\n\n## Apps\n\n- Two.\n\n## Fixes\n\n- Three.\n",
    });
    expect(card.blocks[1]).toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "elements": [
              {
                "text": "The notes in the thread cover Chats, Apps, and Fixes.",
                "type": "text",
              },
            ],
            "type": "rich_text_section",
          },
        ],
        "type": "rich_text",
      }
    `);
  });
});

describe("updateBodies", () => {
  it("redraws a posted card as published, with the tag's page", () => {
    const [body] = updateBodies(
      { channel: "C1", release, ts: "1.0" },
      {
        published: true,
        releaseUrl: "https://github.com/o/r/releases/tag/v2.1.0",
      },
    );
    expect(body).toMatchInlineSnapshot(`
      {
        "blocks": [
          {
            "elements": [
              {
                "elements": [
                  {
                    "style": {
                      "bold": true,
                    },
                    "text": "Instrument 2.1.0 is out",
                    "type": "text",
                  },
                  {
                    "text": "  ",
                    "type": "text",
                  },
                  {
                    "color": "green",
                    "text": "Published",
                    "type": "tag",
                  },
                ],
                "type": "rich_text_section",
              },
            ],
            "type": "rich_text",
          },
          {
            "elements": [
              {
                "elements": [
                  {
                    "text": "A release focused on a cleaner, more private built-in browser, more ways to connect AI providers, and app icons.",
                    "type": "text",
                  },
                ],
                "type": "rich_text_section",
              },
            ],
            "type": "rich_text",
          },
        ],
        "channel": "C1",
        "text": "Instrument 2.1.0 is out",
        "ts": "1.0",
      }
    `);
  });

  it("keeps the stored address when the update names none", () => {
    const [body] = updateBodies(
      { channel: "C1", release, ts: "1.0" },
      { published: false },
    );
    expect(body?.blocks?.at(-1)).toMatchObject({
      elements: [{ url: release.releaseUrl }],
    });
  });

  it("drops the ask to publish from the thread reply once the notes are published", () => {
    const posted = { channel: "C1", release, threadTs: "1.1", ts: "1.0" };
    const [, draft] = updateBodies(posted, { published: false });
    const [, published] = updateBodies(posted, { published: true });
    expect(draft?.text).toMatch(/^<@U0123> the notes for 2\.1\.0 are a draft/);
    expect(published).toMatchObject({ channel: "C1", ts: "1.1" });
    expect(published?.text).not.toContain("are a draft");
    expect(published?.text?.split("\n")[0]).toBe("*Browser*");
  });

  it("leaves the thread reply alone when the card file has no thread ts", () => {
    expect(
      updateBodies({ channel: "C1", release, ts: "1.0" }, { published: true }),
    ).toHaveLength(1);
  });
});
