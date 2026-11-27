import {
  PromptEditor,
  type PromptEditorRef,
} from "@/client/components/prompt-editor";
import { createRef, type RefObject } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { QuoteSelection } from "./quote-selection";

vi.mock("@/client/components/ui/message-scroller", () => ({
  useFarRows: () => undefined,
  useMessageScroller: () => ({
    releaseAutoScroll: noop,
    scrollToMessage: noop,
  }),
}));

vi.mock("@/client/components/skill-mention", () => ({
  SkillMentionByName: ({ name }: { name: string }) => <span>/{name}</span>,
}));

const noop = () => {
  // These tests assert on the words alone.
};

async function draw(words = "") {
  const editor = createRef<PromptEditorRef>();
  const onShow = vi.fn();
  const root: RefObject<HTMLDivElement | null> = createRef();
  const screen = await render(
    <div>
      <div className="select-text" ref={root}>
        <p id="mine">What should I cook?</p>
        <div data-reply-row="one">
          <p id="first">Make soup.</p>
          <p id="second">Or bake bread.</p>
        </div>
        <p id="tool">ran a search</p>
        <div data-reply-row="two">
          <p id="other">Done.</p>
        </div>
      </div>
      <QuoteSelection
        onQuote={(quoted) => {
          editor.current?.appendQuote(quoted);
        }}
        quoted="[]"
        rootRef={root}
      />
      <PromptEditor
        actions={[]}
        apps={[]}
        autoFocus={false}
        bounds={null}
        defaultValue={words}
        disabled={false}
        onChange={noop}
        onPaste={() => false}
        onShowQuote={onShow}
        onSubmit={noop}
        placeholder=""
        ref={editor}
        skills={[]}
      />
    </div>,
  );
  const select = async (from: string, to: string, toOffset?: number) => {
    const start = document.querySelector(`#${from}`);
    const end = document.querySelector(`#${to}`);
    if (!start || !end) {
      throw new Error("nothing to select");
    }
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, toOffset ?? end.childNodes.length);
    // A drag over a reply takes the keyboard from the box.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    await new Promise((resolve) => setTimeout(resolve, 100));
  };
  return {
    button: screen.getByRole("button", { exact: true, name: "Quote" }),
    onShow,
    screen,
    select,
    value: () => editor.current?.getValue(),
  };
}

it("puts the words in the box as a quote, ready to answer", async () => {
  const { button, select, value } = await draw();
  await select("first", "second");
  await button.click();
  await userEvent.keyboard("Which?");
  expect(value()).toMatchInlineSnapshot(`
    "> Make soup.
    >
    > Or bake bread.

    Which?"
  `);
  expect(document.getSelection()?.toString()).toBe("");
});

it("goes over what is already written, under an earlier quote", async () => {
  const { button, select, value } = await draw("Thanks.");
  await select("first", "first");
  await button.click();
  await select("second", "second");
  await button.click();
  await userEvent.keyboard(" Why?");
  expect(value()).toMatchInlineSnapshot(`
    "> Make soup.

    > Or bake bread.

    Thanks. Why?"
  `);
});

it("takes a quote out with its button, Backspace or undo", async () => {
  const { button, screen, select, value } = await draw();
  await select("first", "first");
  await button.click();
  await select("second", "second");
  await button.click();
  await userEvent.keyboard("{Backspace}");
  expect(value()).toBe("> Make soup.\n\n");
  await screen.getByRole("button", { name: "Remove quote" }).click();
  expect(value()).toBe("");
  await userEvent.keyboard("{ControlOrMeta>}z{/ControlOrMeta}");
  expect(value()).toBe("> Make soup.\n\n");
});

it("reads a draft's quotes back as cards, and shows where one is from", async () => {
  const { onShow, screen, value } = await draw("> Make soup.\n\nWhy?");
  expect(value()).toBe("> Make soup.\n\nWhy?");
  await screen.getByRole("button", { name: "Show quote in chat" }).click();
  expect(onShow).toHaveBeenCalledWith("Make soup.");
});

it("takes a selection that ends at the start of what follows the reply", async () => {
  const { button, select } = await draw();
  await select("second", "tool", 0);
  await expect.element(button).toBeVisible();
});

it.each([
  ["mine", "mine"],
  ["tool", "tool"],
  ["second", "other"],
])("offers nothing for words from %s to %s", async (from, to) => {
  const { button, select } = await draw();
  await select(from, to);
  expect(button.query()).toBeNull();
});
