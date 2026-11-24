import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { PromptEditor } from "./prompt-editor";

// Every anchor the link bar is handed, so a test can tell whether typing
// hands it a new one.
const anchors = vi.hoisted(() => new Set<unknown>());
vi.mock("@/client/components/ui/popover", async (importOriginal) => {
  const popover =
    await importOriginal<typeof import("@/client/components/ui/popover")>();
  return {
    ...popover,
    PopoverAnchor: (props: Parameters<typeof popover.PopoverAnchor>[0]) => {
      if (props.virtualRef) anchors.add(props.virtualRef.current);
      return popover.PopoverAnchor(props);
    },
  };
});

// What only a real caret and real layout show about links and lists in the
// box: the bar coming up when the caret goes into a link, and a wrapped list
// item lining up under its first word. The rules themselves are in
// `prompt-editor-links.test.ts`.

const noop = () => {
  // These tests read the document, not what the box sends.
};

async function renderEditor(defaultValue = "", width = 480) {
  const onChange = vi.fn();
  await renderInBrowser(
    <div
      style={{ display: "flex", flexDirection: "column", height: 200, width }}
    >
      <PromptEditor
        actions={[]}
        apps={[]}
        autoFocus
        bounds={null}
        defaultValue={defaultValue}
        disabled={false}
        onChange={onChange}
        onPaste={() => false}
        onSubmit={noop}
        skills={[]}
      />
    </div>,
  );
  return { onChange };
}

const editor = () => page.getByLabelText("Prompt");

function paste(text: string) {
  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", text);
  document
    .querySelector<HTMLElement>('[aria-label="Prompt"]')
    ?.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData }),
    );
}

describe("links in the reply box", () => {
  // A new anchor on every render has the bar's popper set state after each
  // keystroke, which leaves React a render owed at every commit; enough
  // keystrokes in a row and React stops with "Maximum update depth exceeded".
  it("keeps the bar's anchor while words are typed", async () => {
    await renderEditor();
    await userEvent.click(editor());
    expect(anchors.size).toBeGreaterThan(0);
    anchors.clear();
    await userEvent.keyboard("no links in these words");
    expect(anchors.size).toBe(0);
  });

  it("draws a typed address once a space ends it, and offers the bar in it", async () => {
    await renderEditor();
    await userEvent.click(editor());
    await userEvent.keyboard("See https://zendesk.com/pricing");
    expect(document.querySelector(".prompt-editor .prompt-link")).toBeNull();
    expect(document.querySelector('[aria-label="Copy link"]')).toBeNull();

    await userEvent.keyboard(" now");
    const link = document.querySelector<HTMLElement>(
      ".prompt-editor .prompt-link",
    );
    expect(link?.textContent).toBe("https://zendesk.com/pricing");

    await userEvent.click(page.getByText("https://zendesk.com/pricing"));
    await expect
      .element(page.getByRole("button", { name: "Copy link" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Open" }))
      .toBeVisible();
    // An address written out has no words of its own to edit or unlink.
    expect(document.querySelector('[aria-label="Unlink"]')).toBeNull();
  });

  it("draws a pasted address alone as plain text, with no bar", async () => {
    await renderEditor();
    await userEvent.click(editor());
    paste("https://claude.ai/magic-link#c774b2a4");
    await expect
      .element(page.getByText("https://claude.ai/magic-link#c774b2a4"))
      .toBeVisible();
    expect(document.querySelector(".prompt-editor .prompt-link")).toBeNull();
    expect(document.querySelector('[aria-label="Copy link"]')).toBeNull();
  });

  it("offers the bar for a pasted link only once the caret is clicked into it", async () => {
    await renderEditor();
    await userEvent.click(editor());
    await userEvent.keyboard("See ");
    paste("https://zendesk.com/pricing");
    const link = document.querySelector<HTMLElement>(
      ".prompt-editor .prompt-link",
    );
    expect(link?.textContent).toBe("https://zendesk.com/pricing");
    // The bar's popover mounts a frame after the paste, so give it one.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.querySelector('[aria-label="Copy link"]')).toBeNull();

    await userEvent.click(page.getByText("https://zendesk.com/pricing"));
    await expect
      .element(page.getByRole("button", { name: "Copy link" }))
      .toBeVisible();
  });

  it("unlinks linked words from the bar, keeping the words", async () => {
    const { onChange } = await renderEditor(
      "See [the plans](https://zendesk.com) now",
    );
    await userEvent.click(page.getByText("the plans"));
    await userEvent.click(page.getByRole("button", { name: "Unlink" }));
    expect(onChange).toHaveBeenLastCalledWith("See the plans now");
  });

  it("keeps the links in words copied from a page", async () => {
    const { onChange } = await renderEditor();
    await userEvent.click(editor());
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "Compare the plans page today");
    clipboardData.setData(
      "text/html",
      `Compare the <a href="https://zendesk.com/pricing">plans page</a> today`,
    );
    document
      .querySelector<HTMLElement>('[aria-label="Prompt"]')
      ?.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, clipboardData }),
      );
    expect(onChange).toHaveBeenLastCalledWith(
      "Compare the [plans page](https://zendesk.com/pricing) today",
    );
    expect(
      document.querySelector(".prompt-editor .prompt-link")?.textContent,
    ).toBe("plans page");
  });
});

describe("lists in the reply box", () => {
  it("carries the marker on, and lines a wrapped item up under its first word", async () => {
    const { onChange } = await renderEditor("", 240);
    await userEvent.click(editor());
    await userEvent.keyboard("- one{Shift>}{Enter}{/Shift}");
    expect(onChange).toHaveBeenLastCalledWith("- one\n- ");

    await userEvent.keyboard(
      "a long item that wraps onto a second line in this narrow box",
    );
    const item = document.querySelectorAll<HTMLElement>(".prompt-editor p")[1];
    expect(item?.classList.contains("prompt-list-line")).toBe(true);
    const text = item?.firstChild;
    if (!item || !text) {
      throw new Error("the second item is not drawn");
    }
    const range = document.createRange();
    range.selectNodeContents(item);
    const lines = [...range.getClientRects()];
    // The first word after the marker, and the start of the wrapped line.
    const word = document.createRange();
    word.setStart(text, 2);
    word.setEnd(text, 3);
    const firstWordLeft = word.getBoundingClientRect().left;
    const wrappedLeft = Math.min(
      ...lines
        .filter((line) => line.top > (lines[0]?.bottom ?? 0) - 1)
        .map((line) => line.left),
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(Math.abs(wrappedLeft - firstWordLeft)).toBeLessThan(1.5);
  });
});
