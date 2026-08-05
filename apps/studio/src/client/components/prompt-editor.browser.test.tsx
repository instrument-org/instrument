// The scroll fade is a real stylesheet rule driven by a real scroll timeline,
// so this file needs the app's CSS rather than bare markup.
import "@/client/styles/globals.css";
import { type ComponentProps, createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import { PromptEditor, type PromptEditorRef } from "./prompt-editor";

vi.mock("@/client/components/skill-mention", () => ({
  SkillMention: ({ name }: { name: string }) => <span>/{name}</span>,
}));

// What jsdom cannot observe: a real caret, a real selection, and text that
// arrives by being typed rather than by being handed in as a prop. Everything
// here needs a browser to mean anything; anything that does not belongs in
// `prompt-editor.test.tsx`, which is far cheaper to run.

const noop = () => {
  // Nothing to do: these tests assert on the document, not on submit or paste.
};

const editorProps = {
  disabled: false,
  onPaste: () => false,
  onSubmit: noop,
  skills: [] as ComponentProps<typeof PromptEditor>["skills"],
};

const ffmpegSkill = {
  aliases: ["instrument:ffmpeg"],
  description: "Edit video and audio with FFmpeg",
  id: "instrument:ffmpeg",
  name: "ffmpeg",
  path: "/skills/ffmpeg",
  qualifiedName: "ffmpeg",
  source: "instrument",
  title: "FFmpeg",
} satisfies ComponentProps<typeof PromptEditor>["skills"][number];

function renderEditor(defaultValue = "", skills = editorProps.skills) {
  const onChange = vi.fn();
  const ref = createRef<PromptEditorRef>();
  // The editor fills the column it is given, so the height it has to work
  // within belongs to the host -- here a stand-in for the composer's box.
  // `render` reports a thenable so it can be awaited; nothing here needs to.
  void render(
    <div style={{ display: "flex", flexDirection: "column", height: 200 }}>
      <PromptEditor
        {...editorProps}
        autoFocus
        defaultValue={defaultValue}
        onChange={onChange}
        ref={ref}
        skills={skills}
      />
    </div>,
  );
  return { onChange, ref };
}

// The editor is a contenteditable div, which carries no implicit role, so it is
// found by the label ProseMirror puts on it rather than by role.
const editor = () => page.getByLabelText("Prompt");

async function pasteText(text: string) {
  await userEvent.click(editor());
  const target = document.querySelector<HTMLElement>('[aria-label="Prompt"]');
  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", text);
  clipboardData.setData("text/html", `<p>${text}</p>`);
  target?.dispatchEvent(
    new ClipboardEvent("paste", { bubbles: true, clipboardData }),
  );
}

describe("PromptEditor in a browser", () => {
  it("reports what was typed", async () => {
    const { onChange } = renderEditor();

    await userEvent.click(editor());
    await userEvent.keyboard("hello");

    await expect.element(editor()).toHaveTextContent("hello");
    expect(onChange).toHaveBeenLastCalledWith("hello");
  });

  // The regression that emptied stored drafts: the composer mounts empty while
  // the saved draft is still loading, and anything reporting the document
  // before the user touches it overwrites what was saved. Focus is what moved
  // the caret in the app, and it is exactly the step jsdom cannot reproduce,
  // because it never delivers `selectionchange`.
  it("reports nothing when focus alone places the caret", async () => {
    const { onChange } = renderEditor("a stored draft");

    await userEvent.click(editor());

    await expect.element(editor()).toHaveTextContent("a stored draft");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps typing where the caret is rather than at the end", async () => {
    const { onChange } = renderEditor();

    await userEvent.click(editor());
    await userEvent.keyboard("ac");
    await userEvent.keyboard("{ArrowLeft}b");

    expect(onChange).toHaveBeenLastCalledWith("abc");
  });

  // "Add this file to the chat" while the user is mid-sentence. The text has to
  // land where they are looking, which is only observable against a real caret:
  // an editor that appends would report "one two src/app.ts " and pass every
  // assertion jsdom can make about the document.
  it("inserts external text at the caret rather than at the end", async () => {
    const { onChange, ref } = renderEditor();

    await userEvent.click(editor());
    await userEvent.keyboard("one two");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    ref.current?.insertText("src/app.ts");

    expect(onChange).toHaveBeenLastCalledWith("one src/app.ts two");
  });

  it("leaves the caret after inserted text, ready to keep typing", async () => {
    const { onChange, ref } = renderEditor();

    await userEvent.click(editor());
    await userEvent.keyboard("one two");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    ref.current?.insertText("src/app.ts");
    await userEvent.keyboard("!");

    expect(onChange).toHaveBeenLastCalledWith("one src/app.ts !two");
  });

  // Plain Enter sends, so Shift-Enter is the only way to write a second line.
  // The schema has no hard-break node, which makes the break a paragraph split
  // and the key binding the only thing that produces one.
  it("breaks the line on shift+enter", async () => {
    const { onChange } = renderEditor();

    await userEvent.click(editor());
    await userEvent.keyboard("one{Shift>}{Enter}{/Shift}two");

    expect(onChange).toHaveBeenLastCalledWith("one\ntwo");
  });

  // Chromium holds a scroll-driven animation at its last committed value once
  // its scroller stops being scrollable, so a draft cleared from a scrolled
  // position left the top fade painted over an empty composer. Only a real
  // browser runs the scroll timeline at all.
  it("drops the scroll fade once the draft no longer overflows", async () => {
    const { ref } = renderEditor();
    const scroller = () => {
      const found = document.querySelector(
        '[aria-label="Prompt"]',
      )?.parentElement;
      if (!found) {
        throw new Error("editor is not mounted");
      }
      return found;
    };
    await userEvent.click(editor());

    ref.current?.setValue(
      Array.from({ length: 40 }, (_, line) => `line ${line}`).join("\n"),
    );
    scroller().scrollTo(0, scroller().scrollHeight);

    await vi.waitFor(() => {
      expect(
        getComputedStyle(scroller()).getPropertyValue("--scroll-fade-top"),
      ).toBe("24px");
    });

    ref.current?.clear();

    await vi.waitFor(() => {
      expect(getComputedStyle(scroller()).maskImage).toBe("none");
    });
  });

  it.each(["/ffmpeg is cool", "/instrument:ffmpeg is cool"])(
    "tokenizes a recognized pasted skill command: %s",
    async (text) => {
      const { onChange, ref } = renderEditor("", [ffmpegSkill]);

      await pasteText(text);

      expect(ref.current?.getValue()).toBe(
        "[$instrument:ffmpeg](skill:instrument:ffmpeg) is cool",
      );
      expect(
        document.querySelector('[data-skill="instrument:ffmpeg"]'),
      ).not.toBeNull();
      expect(onChange).toHaveBeenLastCalledWith(ref.current?.getValue());
    },
  );
});
