import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { MarkdownDocument } from "./markdown-outline";
import { SessionMarkdown } from "./session-markdown";
import { ThemeProvider } from "./theme-provider";

const paragraphs = (count: number) =>
  Array.from(
    { length: count },
    () =>
      "The quick brown fox jumps over the lazy dog, and then again, and again, until the line is long enough to wrap a few times in a narrow pane.",
  ).join("\n\n");

// Sections long enough that each heading can climb to the top of a 400px
// viewer on its own, except the last two, which together are shorter than the
// viewer; plus a fenced `#` that must never become an entry.
const DOCUMENT = [
  "# Field notes",
  paragraphs(3),
  "## Setup",
  paragraphs(6),
  "### Tools",
  paragraphs(6),
  "## Method",
  "```python\n# a comment, not a heading\nprint(1)\n```",
  paragraphs(6),
  "## Results",
  paragraphs(8),
  "### Caveats",
  paragraphs(1),
  "## Discussion",
  paragraphs(1),
].join("\n\n");

/** The document inside a viewer of the given width, 400px tall. */
async function renderDocument(width: number, markdown = DOCUMENT) {
  await renderInBrowser(
    // The fence renders a code block, which asks the theme which palette to
    // highlight in.
    <ThemeProvider defaultTheme="light">
      <div className="flex flex-col" style={{ height: 400, width }}>
        <MarkdownDocument>
          <SessionMarkdown className="p-8" markdown={markdown} />
        </MarkdownDocument>
      </div>
    </ThemeProvider>,
  );

  const scroller = document.querySelector<HTMLElement>(".overflow-auto");
  if (!scroller) {
    throw new Error("the document did not render");
  }
  const entries = () =>
    [...document.querySelectorAll<HTMLElement>("nav [data-heading]")].filter(
      (element) => element.tagName === "BUTTON",
    );
  const current = () =>
    document.querySelector<HTMLElement>('[aria-current="location"]')
      ?.textContent ?? null;
  // Read off computed style rather than through a role query: a hidden entry
  // is out of the accessibility tree, so a locator for it resolves to nothing
  // rather than to something invisible.
  const entryVisibility = () => {
    const entry = document.querySelector<HTMLElement>(
      'button[title="Results"]',
    );
    return entry ? getComputedStyle(entry).visibility : null;
  };
  const headingTop = (text: string) => {
    const heading = [...scroller.querySelectorAll("h1, h2, h3")].find(
      (element) => element.textContent === text,
    );
    if (!heading) {
      throw new Error(`no heading reads ${text}`);
    }
    return (
      heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    );
  };
  return { current, entries, entryVisibility, headingTop, scroller };
}

// Moves the pointer to the top-left corner, off the outline and off whatever
// the open list covers, so nothing is hovered. `force` because the corner is
// padding rather than anything Playwright would agree is a hover target.
const parkPointer = () =>
  userEvent.hover(document.body, { force: true, position: { x: 4, y: 4 } });

describe("MarkdownOutline", () => {
  it("lists the rendered headings and nothing inside a fence", async () => {
    const { entries } = await renderDocument(1000);

    await expect
      .poll(() => entries().map((entry) => entry.textContent))
      .toEqual([
        "Field notes",
        "Setup",
        "Tools",
        "Method",
        "Results",
        "Caveats",
        "Discussion",
      ]);
    // Indented by depth below the shallowest heading, not by absolute level.
    const indents = entries().map((entry) => entry.style.paddingLeft);
    expect(indents[0]).toBe("0.5rem");
    expect(indents[1]).toBe("1.25rem");
    expect(indents[2]).toBe("2rem");
  });

  it("marks the section being read as the document scrolls", async () => {
    const { current, scroller } = await renderDocument(1000);
    await expect.poll(current).toBe("Field notes");

    const results = scroller.querySelector<HTMLElement>("h2:nth-of-type(3)");
    if (!results) {
      throw new Error("the Results heading did not render");
    }
    // The Method section still holds the top edge 150px above Results.
    scroller.scrollTop = results.offsetTop - 150;
    await expect.poll(current).toBe("Method");
    // A sliver of it under the tolerance does not.
    scroller.scrollTop = results.offsetTop - 10;
    await expect.poll(current).toBe("Results");

    // The end of the document is the last section, however short it is.
    scroller.scrollTop = scroller.scrollHeight;
    await expect.poll(current).toBe("Discussion");
  });

  it("jumps to a heading and holds it as current", async () => {
    const { current, headingTop, scroller } = await renderDocument(1000);

    await page.getByRole("button", { name: "Results" }).click();

    await expect.poll(() => Math.round(headingTop("Results"))).toBe(24);
    expect(current()).toBe("Results");

    // A heading the document ends too soon after never reaches the top on its
    // own, and at the end the last heading is the one read; the jump is what
    // marks it, until the reader scrolls.
    await page.getByRole("button", { name: "Caveats" }).click();
    await expect
      .poll(() => scroller.scrollTop + scroller.clientHeight)
      .toBeGreaterThanOrEqual(scroller.scrollHeight - 1);
    expect(current()).toBe("Caveats");
  });

  it("opens the list over a narrow document only while the rail is hovered", async () => {
    const { entryVisibility } = await renderDocument(480);

    await expect.poll(entryVisibility).toBe("hidden");

    // `force`, because the list opens over the rail the moment the pointer
    // arrives, and a hit-target check then finds an entry where it expected
    // the rail. That is the design: from here on the pointer is on an entry,
    // and a click is a jump rather than anything to do with the rail.
    await userEvent.hover(
      page.getByRole("button", { exact: true, name: "Contents" }),
      {
        force: true,
      },
    );
    await expect.poll(entryVisibility).toBe("visible");
    await page.getByRole("button", { name: "Results" }).click();
    await parkPointer();
    await expect.poll(entryVisibility).toBe("hidden");
  });

  it("keeps the card closed while the document is moving", async () => {
    const { entryVisibility, scroller } = await renderDocument(480);
    await userEvent.hover(
      page.getByRole("button", { exact: true, name: "Contents" }),
      {
        force: true,
      },
    );
    await expect.poll(entryVisibility).toBe("visible");

    // Synthetic, because a real scroll's `scrollend` follows too closely to
    // observe the window between them.
    scroller.dispatchEvent(new Event("scroll"));
    await expect.poll(entryVisibility).toBe("hidden");
    scroller.dispatchEvent(new Event("scrollend"));
    await expect.poll(entryVisibility).toBe("visible");
  });

  it("puts a pinned card away on a press outside it", async () => {
    const { entryVisibility, scroller } = await renderDocument(480);
    await parkPointer();

    // A press on the bare rail pins the card. The rail is bare while the
    // document is moving; without that the card, which opens without delay
    // here, would be under the pointer first and take the press as a jump.
    scroller.dispatchEvent(new Event("scroll"));
    await page
      .getByRole("button", { exact: true, name: "Contents" })
      .click({ force: true });
    scroller.dispatchEvent(new Event("scrollend"));
    await parkPointer();
    await expect.poll(entryVisibility).toBe("visible");

    await page.getByRole("heading", { name: "Field notes" }).click();
    await expect.poll(entryVisibility).toBe("hidden");
  });

  it("holds the list open from the keyboard until an entry is picked or Escape", async () => {
    const { entryVisibility } = await renderDocument(480);
    const rail = page.getByRole("button", { exact: true, name: "Contents" });
    // The pointer is wherever the last test left it, and over the rail it
    // would hold the list open on its own.
    await parkPointer();

    rail.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(entryVisibility).toBe("visible");
    await expect.element(rail).toHaveAttribute("aria-expanded", "true");

    await userEvent.keyboard("{Escape}");
    await expect.poll(entryVisibility).toBe("hidden");
    await expect.element(rail).toHaveAttribute("aria-expanded", "false");

    await userEvent.keyboard("{Enter}");
    await expect.poll(entryVisibility).toBe("visible");
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await expect.poll(entryVisibility).toBe("hidden");
  });

  it("collapses the wide column to a rail and brings it back from the card", async () => {
    const { entryVisibility } = await renderDocument(1000);
    await expect.poll(entryVisibility).toBe("visible");

    await page.getByRole("button", { name: "Hide contents" }).click();
    // The pointer is now on the rail, and the card stays closed for it until
    // the pointer has been away once.
    await expect.poll(entryVisibility).toBe("hidden");
    const rail = page.getByRole("button", { exact: true, name: "Contents" });
    await expect.element(rail).toBeInTheDocument();
    await userEvent.hover(rail, { force: true });
    await expect.poll(entryVisibility).toBe("hidden");
    await parkPointer();

    // The way back is in the card.
    await userEvent.hover(rail, { force: true });
    await expect.poll(entryVisibility).toBe("visible");
    await page.getByRole("button", { name: "Show contents" }).click();
    await parkPointer();
    await expect.poll(entryVisibility).toBe("visible");
    await expect
      .element(page.getByRole("button", { name: "Hide contents" }))
      .toBeInTheDocument();
    expect(document.querySelector('button[aria-label="Contents"]')).toBeNull();
  });

  it("pins a column into a narrow pane from the card", async () => {
    const { entryVisibility } = await renderDocument(480);

    await userEvent.hover(
      page.getByRole("button", { exact: true, name: "Contents" }),
      { force: true },
    );
    await expect.poll(entryVisibility).toBe("visible");
    await page.getByRole("button", { name: "Show contents" }).click();
    await parkPointer();

    await expect.poll(entryVisibility).toBe("visible");
    await expect
      .element(page.getByRole("button", { name: "Hide contents" }))
      .toBeInTheDocument();
    expect(document.querySelector('button[aria-label="Contents"]')).toBeNull();
  });

  it("hangs the rail in the gutter, clear of the scrollbar", async () => {
    const { scroller } = await renderDocument(480);
    const rail = page
      .getByRole("button", { exact: true, name: "Contents" })
      .element();
    const strip = rail.parentElement;
    if (!strip) {
      throw new Error("the rail did not render");
    }

    // Inside the scroll container, so a wheel over it scrolls the document.
    expect(scroller.contains(strip)).toBe(true);
    const scrollbar = scroller.offsetWidth - scroller.clientWidth;
    await expect.poll(() => strip.style.right).toBe(`${scrollbar + 12}px`);
    await expect
      .poll(() => strip.getBoundingClientRect().height)
      .toBe(scroller.clientHeight);
  });

  it("draws nothing for a document with a single heading", async () => {
    await renderDocument(1000, `# Only\n\n${paragraphs(3)}`);
    await expect.element(page.getByText("Only")).toBeVisible();

    expect(document.querySelector("nav")).toBeNull();
  });
});
