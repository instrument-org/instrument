import { windowHoldsAtom } from "@/client/atoms/tab-navigation-block";
import {
  PromptEditor,
  type PromptEditorRef,
} from "@/client/components/prompt-editor";
import { getDefaultStore } from "jotai";
import { createRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { installTypeToCompose } from "./type-to-compose";

vi.mock("@/client/components/skill-mention", () => ({
  SkillMentionByName: ({ name }: { name: string }) => <span>/{name}</span>,
}));

const noop = () => {
  // These tests assert on the words alone.
};

let uninstall: () => void;

beforeEach(() => {
  uninstall = installTypeToCompose();
});

afterEach(() => {
  uninstall();
  getDefaultStore().set(windowHoldsAtom, []);
});

async function draw({
  chatHasKeyboard = true,
  words = "",
}: { chatHasKeyboard?: boolean; words?: string } = {}) {
  const ref = createRef<PromptEditorRef>();
  await render(
    <div data-app-tab-active="">
      <div data-group-side="" data-keyboard={chatHasKeyboard ? "" : undefined}>
        <button data-testid="plain" type="button">
          Copy
        </button>
        <input data-testid="field" />
        <div data-testid="menu" role="menu" tabIndex={-1} />
        <div
          data-testid="finds-names"
          onKeyDown={(event) => {
            event.preventDefault();
          }}
          tabIndex={-1}
        />
        <div data-keyboard-home="1">
          <div data-slot="composer-frame">
            <PromptEditor
              actions={[]}
              apps={[]}
              bounds={null}
              autoFocus={false}
              defaultValue={words}
              disabled={false}
              onChange={noop}
              onPaste={() => false}
              onSubmit={noop}
              placeholder=""
              ref={ref}
              skills={[]}
            />
          </div>
        </div>
      </div>
      <div
        data-group-side=""
        data-keyboard={chatHasKeyboard ? undefined : ""}
      />
    </div>,
  );
  const focus = (id: string) =>
    document.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.focus();
  return { focus, value: () => ref.current?.getValue() };
}

it("types every letter into the composer when the keyboard is on nothing", async () => {
  const { value } = await draw();
  await userEvent.keyboard("hello there");
  expect(value()).toBe("hello there");
});

it("carries on from where the caret was in a draft", async () => {
  const { value } = await draw({ words: "hello" });
  document.getSelection()?.removeAllRanges();
  await userEvent.keyboard("there");
  expect(value()).toBe("hellothere");
});

it("keeps words that were left selected", async () => {
  const { focus, value } = await draw({ words: "hello" });
  document.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
  await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}");
  focus("plain");
  await userEvent.keyboard("x");
  expect(value()).toBe("hellox");
});

it("takes a letter from a button, which does nothing with one", async () => {
  const { focus, value } = await draw();
  focus("plain");
  await userEvent.keyboard("hi");
  expect(value()).toBe("hi");
});

it.each(["field", "menu", "finds-names"])(
  "leaves a letter to what reads it: %s",
  async (id) => {
    const { focus, value } = await draw();
    focus(id);
    await userEvent.keyboard("h");
    expect(value()).toBe("");
  },
);

it.each([" ", "?", "{Enter}", "{ArrowDown}", "{Control>}b{/Control}"])(
  "leaves %s alone",
  async (keys) => {
    const { value } = await draw();
    await userEvent.keyboard(keys);
    expect([value(), document.activeElement?.tagName]).toEqual(["", "BODY"]);
  },
);

it("types nothing into a chat on the side without the keyboard", async () => {
  const { value } = await draw({ chatHasKeyboard: false });
  await userEvent.keyboard("h");
  expect(value()).toBe("");
});

it("types nothing under something that holds the window", async () => {
  const { value } = await draw();
  getDefaultStore().set(windowHoldsAtom, [{}]);
  await userEvent.keyboard("h");
  expect(value()).toBe("");
});
