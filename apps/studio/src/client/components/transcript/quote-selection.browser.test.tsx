import {
  PromptEditor,
  type PromptEditorRef,
} from "@/client/components/prompt-editor";
import { createRef, type RefObject } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { QuoteSelection } from "./quote-selection";

vi.mock("@/client/components/skill-mention", () => ({
  SkillMentionByName: ({ name }: { name: string }) => <span>/{name}</span>,
}));

const noop = () => {
  // These tests assert on the words alone.
};

async function draw(words = "") {
  const editor = createRef<PromptEditorRef>();
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
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    await new Promise((resolve) => setTimeout(resolve, 100));
  };
  return {
    button: screen.getByRole("button", { exact: true, name: "Quote" }),
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

it("goes after what is already written", async () => {
  const { button, select, value } = await draw("Thanks.");
  await select("first", "first");
  await button.click();
  expect(value()).toMatchInlineSnapshot(`
    "Thanks.
    > Make soup.

    "
  `);
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
