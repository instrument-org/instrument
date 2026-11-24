import { describe, expect, it } from "vitest";

import {
  detailOf,
  planPage,
  PICTURES_WAIT_MS,
  type Release,
  versionLabel,
  whatsNewOf,
} from "./release-notes";

const release = (version: string, body = ""): Release => ({
  body,
  prerelease: version.includes("beta"),
  publishedAt: "2026-10-29T12:00:00Z",
  summary: body ? "A small release." : null,
  url: `https://example.com/${version}`,
  version,
});

// Newest first, as the API lists them.
const RELEASES = [116, 115, 114, 113, 112, 111].map((n) =>
  release(`2.0.0-beta.${n}`),
);

const plan = (options: Parameters<typeof planPage>[1]) => {
  const page = planPage(RELEASES, options);
  const names = (list: Release[]) => list.map((r) => r.version.slice(-3));
  return {
    current: page.current,
    folded: names(page.folded),
    fresh: page.fresh,
    full: names(page.full),
    newer: names(page.newer),
    staged: page.staged?.version,
  };
};

describe("planPage", () => {
  it("shows every version since the one an update left in full, marked new", () => {
    expect(
      plan({
        current: "2.0.0-beta.115",
        since: "2.0.0-beta.112",
        staged: undefined,
      }),
    ).toMatchInlineSnapshot(`
      {
        "current": "2.0.0-beta.115",
        "folded": [
          "112",
          "111",
        ],
        "fresh": true,
        "full": [
          "115",
          "114",
          "113",
        ],
        "newer": [
          "116",
        ],
        "staged": undefined,
      }
    `);
  });

  it("shows only the running version in full without a since, and leads with a staged one", () => {
    expect(
      plan({
        current: "2.0.0-beta.115",
        since: undefined,
        staged: "2.0.0-beta.116",
      }),
    ).toMatchInlineSnapshot(`
      {
        "current": "2.0.0-beta.115",
        "folded": [
          "114",
          "113",
          "112",
          "111",
        ],
        "fresh": false,
        "full": [
          "115",
        ],
        "newer": [],
        "staged": "2.0.0-beta.116",
      }
    `);
  });

  it.each([
    ["a since past the list", "2.0.0-beta.50"],
    ["a since newer than the running build", "2.0.0-beta.116"],
  ])("marks nothing new for %s", (_, since) => {
    const page = plan({ current: "2.0.0-beta.115", since, staged: undefined });
    expect([page.fresh, page.full]).toEqual([false, ["115"]]);
  });

  it("reads a build with no release of its own as the newest", () => {
    const page = plan({
      current: "2.0.0-beta.117",
      since: undefined,
      staged: undefined,
    });
    expect([page.current, page.full, page.newer]).toEqual([
      undefined,
      ["116"],
      [],
    ]);
  });
});

describe("versionLabel", () => {
  it.each([
    ["2.0.0-beta.115", "2.0.0 beta 115"],
    ["2.0.1-beta.0", "2.0.1 beta 0"],
    ["1.6.15", "Version 1.6.15"],
  ])("%s reads as %s", (version, label) => {
    expect(versionLabel(version)).toBe(label);
  });
});

describe("detailOf", () => {
  it("drops the summary paragraph the page shows as the lede", () => {
    expect(
      detailOf(
        release(
          "2.0.0-beta.115",
          "A small release.\n\n## Windows\n\n- One fix.",
        ),
      ),
    ).toBe("## Windows\n\n- One fix.");
  });

  it("keeps a commit list whole", () => {
    const list = {
      ...release("1.4.2-beta.9"),
      body: "## What's changed\n\n- x",
    };
    expect(detailOf(list)).toBe(list.body);
  });
});

const MEDIA = "https://releases.tryinstrument.com/whats-new/2.0.10";

const NOTES = (
  note: string,
  { zoom = "", find = "" } = {},
) => `Zoom into pictures, and find in chats.

## What's new

${note}

- **Zoom into pictures.** Click a large picture to zoom in where you clicked.

  ${zoom}

- **Find in chats.** Press Command-F to find words in a chat.

  ${find}

## Fixes and polish

- Shortened dates show in full on hover.
`;

const PUBLISHED = Date.parse("2026-10-29T12:00:00Z");

describe("whatsNewOf", () => {
  const of = (note: string, media = {}, now = PUBLISHED + 60_000) =>
    whatsNewOf({ ...release("2.0.10", NOTES(note, media)) }, now);
  const READY = "<!-- whats-new\nstatus: ready\n-->";
  const hidden = (media: string) => `<!-- ${media} -->`;

  it("pairs each feature with the video or picture under it", () => {
    expect(
      of(READY, {
        find: hidden(`![Find in chats](${MEDIA}/find.jpg)`),
        zoom: hidden(
          `[![Zoom into pictures](${MEDIA}/zoom.jpg)](${MEDIA}/zoom.mp4)`,
        ),
      }),
    ).toMatchInlineSnapshot(`
      {
        "features": [
          {
            "line": "Click a large picture to zoom in where you clicked.",
            "media": {
              "poster": "https://releases.tryinstrument.com/whats-new/2.0.10/zoom.jpg",
              "video": "https://releases.tryinstrument.com/whats-new/2.0.10/zoom.mp4",
            },
            "title": "Zoom into pictures",
            "version": "2.0.10",
          },
          {
            "line": "Press Command-F to find words in a chat.",
            "media": {
              "poster": "https://releases.tryinstrument.com/whats-new/2.0.10/find.jpg",
              "video": undefined,
            },
            "title": "Find in chats",
            "version": "2.0.10",
          },
        ],
        "waiting": false,
      }
    `);
  });

  it.each([
    ["another host", hidden("![Find](https://example.com/whats-new/find.jpg)")],
    [
      "a video that is not an MP4",
      hidden(`[![Find](${MEDIA}/find.jpg)](${MEDIA}/find.mov)`),
    ],
    [
      "a video from another host",
      hidden(`[![Find](${MEDIA}/find.jpg)](https://example.com/find.mp4)`),
    ],
    ["a line outside a comment", `![Find](${MEDIA}/find.jpg)`],
  ])("ignores media from %s", (_, find) => {
    expect(of(READY, { find })?.features[1]?.media).toBeUndefined();
  });

  it("waits while the media is pending, and gives up a day after publishing", () => {
    const note = "<!-- whats-new\nstatus: pending\n-->";
    expect(of(note)?.waiting).toBe(true);
    expect(of(note)?.features.every((f) => f.media === undefined)).toBe(true);
    expect(of(note, {}, PUBLISHED + PICTURES_WAIT_MS + 1)?.waiting).toBe(false);
  });

  it("takes a section with no note as words alone, and notes without one as none", () => {
    expect(of("")?.waiting).toBe(false);
    expect(of("")?.features.map((f) => f.title)).toEqual([
      "Zoom into pictures",
      "Find in chats",
    ]);
    expect(
      whatsNewOf(release("2.0.9", "A small release.\n\n## Chats\n\n- One."), 0),
    ).toBeNull();
  });

  it("leaves the section out of the notes shown under each version", () => {
    expect(
      detailOf(
        release(
          "2.0.10",
          NOTES(READY, { zoom: hidden(`![Zoom](${MEDIA}/zoom.jpg)`) }),
        ),
      ),
    ).toBe("## Fixes and polish\n\n- Shortened dates show in full on hover.");
  });
});
