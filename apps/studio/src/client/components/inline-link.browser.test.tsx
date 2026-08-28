import { renderInBrowser } from "@/tests/render-browser";
import { StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { Markdown } from "./markdown";
import { UserMessage } from "./user-message";

// Both of these are questions about a stylesheet meeting a component, which is
// the one thing jsdom cannot answer: it applies no CSS, so a chip that doubles
// the height of its line and a link drawn as plain text both pass there.

const PROSE =
  "prose prose-custom font-sans text-sm/relaxed dark:prose-invert";

async function renderMessage(text: string) {
  await renderInBrowser(
    <div style={{ width: 600 }}>
      <UserMessage
        part={{
          metadata: {
            createdAt: new Date("2026-01-01T00:00:00Z"),
            id: StoreId.newPartId(),
            messageId: StoreId.newMessageId(),
            sessionId: StoreId.newSessionId(),
          },
          text,
          type: "text" as const,
        }}
      />
    </div>,
  );
}

async function renderReply(markdown: string) {
  await renderInBrowser(
    <div className={PROSE} style={{ width: 600 }}>
      <Markdown markdown={markdown} />
    </div>,
  );
}

// A site with no icon draws none, and which sites those are is remembered for
// the session. So each case below asks about a host of its own: sharing one
// would make what the second case sees depend on what the first one found.
//
// The element is there to be measured either way. It leaves only once the
// lookup has answered, which is a later task than the render these await.
const siteIcon = () => document.querySelector("a img, a svg");

const chips = () =>
  [...document.querySelectorAll("a, button")].filter(
    (element) => getComputedStyle(element).display === "inline-flex",
  );

describe("An inline link in a browser", () => {
  // The line a chip sits in has to be the height it would have been without
  // one, or a paragraph mentioning a file is visibly looser than the paragraph
  // under it.
  it.each([
    ["a file", "Wrote [notes.md](output/notes.md) to the folder."],
    [
      "an address",
      "Send it to [neil@finalpoint.co](mailto:neil@finalpoint.co).",
    ],
  ])(
    "keeps a line holding a chip for %s the height of one line",
    async (_case, markdown) => {
      await renderReply(markdown);

      const paragraph = document.querySelector("p");
      if (!paragraph) {
        throw new Error("the reply rendered without a paragraph");
      }
      const lineHeight = Number.parseFloat(
        getComputedStyle(paragraph).lineHeight,
      );

      expect(chips()).toHaveLength(1);
      expect(paragraph.getBoundingClientRect().height).toBe(lineHeight);
    },
  );

  // The typography styles give every image a margin of over an em, which is
  // right for a picture between two paragraphs and doubles the height of an
  // icon inside a sentence.
  it("keeps the site icon clear of the margin prose gives an image", async () => {
    await renderReply("Filed under [linear.app](https://linear.app).");

    const icon = document.querySelector("a img");
    if (!icon) {
      throw new Error("the link rendered without a favicon");
    }
    const { marginBottom, marginTop } = getComputedStyle(icon);

    expect([marginTop, marginBottom]).toEqual(["0px", "0px"]);
  });

  // A page is a page whether its label is a sentence or the URL itself, and
  // the rule that used to box one of those and not the other was invisible to
  // anyone reading the result.
  it.each([
    ["a label that says nothing about it", "[the docs](https://linear.app)"],
    ["a label that is the origin", "[linear.app](https://linear.app)"],
    ["the URL written out", "https://linear.app"],
  ])(
    "draws a link with %s as text in the sentence",
    async (_case, markdown) => {
      await renderReply(`Filed under ${markdown} this morning.`);

      expect(chips()).toHaveLength(0);
      expect(document.querySelector("a")).not.toBeNull();
    },
  );

  // The underline is the whole of what sets a link apart. The typography
  // styles give one a heavier weight on top of that, which made a paragraph
  // carrying several of them read as a paragraph with several emphasized
  // phrases in it, none of which the writer had emphasized.
  it.each([
    ["a reply", renderReply],
    ["a sent message", renderMessage],
  ])(
    "gives a link in %s the weight of the words around it",
    async (_case, render) => {
      await render(
        "Rotation is on [the docs](https://notion.so/x) and nowhere else.",
      );

      const link = document.querySelector("a");
      const prose = link?.parentElement;
      if (!link || !prose) {
        throw new Error("nothing rendered a link inside anything");
      }

      expect(getComputedStyle(link).fontWeight).toBe(
        getComputedStyle(prose).fontWeight,
      );
    },
  );

  // The typography styles underline every anchor and carry the same
  // specificity as the utility turning that off, so this is where the two of
  // them meet. The anchor has to lose: a rule declared out there paints over
  // the parts inside it, in the label's color and through the icon.
  it.each([
    ["a reply", renderReply],
    ["a sent message", renderMessage],
  ])("draws no rule on the anchor itself in %s", async (_case, render) => {
    await render(
      "Rotation is on [the channels doc](https://channels.finalpoint.org/x).",
    );

    const link = document.querySelector("a");
    if (!link) {
      throw new Error("nothing rendered a link");
    }

    expect(getComputedStyle(link).textDecorationLine).toBe("none");
  });

  // A decoration is painted in the color of whatever declares it, and a
  // descendant cannot repaint one it inherited. Declared on the anchor, the
  // rule under the muted destination came out in the label's much brighter
  // color.
  it("underlines each part of a link in that part's own color", async () => {
    await renderReply(
      "Rotation is on [the channels doc](https://channels.finalpoint.org/x).",
    );

    const label = document.querySelector("a bdi");
    const disclosure = document.querySelector('[data-slot="link-origin"]');
    if (!label || !disclosure) {
      throw new Error("the link rendered without a label and a destination");
    }
    const [labelStyle, disclosureStyle] = [label, disclosure].map((element) =>
      getComputedStyle(element),
    );

    expect(labelStyle?.textDecorationLine).toBe("underline");
    expect(disclosureStyle?.textDecorationLine).toBe("underline");
    expect(labelStyle?.textDecorationColor).toBe(labelStyle?.color);
    expect(disclosureStyle?.textDecorationColor).toBe(disclosureStyle?.color);
    expect(disclosureStyle?.color).not.toBe(labelStyle?.color);
  });

  // The icon leads the link rather than sitting inside the run of text the
  // rule is drawn under, which is the other half of keeping the decoration off
  // the anchor.
  it("leaves the icon in front of a link unruled", async () => {
    await renderReply("Rotation is on [the docs](https://notion.so/x).");

    const icon = siteIcon();
    if (!icon) {
      throw new Error("the link rendered without a site icon");
    }

    expect(getComputedStyle(icon).textDecorationLine).toBe("none");
  });

  // The icon a plain link carries is the same size as a chip's and sits in the
  // same line box, so neither kind of link may push its line open.
  it("keeps a line holding a link and its icon the height of one line", async () => {
    await renderReply("Rotation is on [the docs](https://github.com/x).");

    const paragraph = document.querySelector("p");
    if (!paragraph) {
      throw new Error("the reply rendered without a paragraph");
    }
    const lineHeight = Number.parseFloat(
      getComputedStyle(paragraph).lineHeight,
    );

    expect(siteIcon()).not.toBeNull();
    expect(paragraph.getBoundingClientRect().height).toBe(lineHeight);
  });
});
