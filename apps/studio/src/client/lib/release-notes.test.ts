import { describe, expect, it } from "vitest";

import {
  detailOf,
  planPage,
  type Release,
  versionLabel,
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
    ["2.0.0-beta.115", "2.0 beta 115"],
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
