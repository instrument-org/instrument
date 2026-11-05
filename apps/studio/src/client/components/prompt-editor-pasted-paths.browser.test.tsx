import { createRef } from "react";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import { PromptEditor, type PromptEditorRef } from "./prompt-editor";

// The disk's answer, by whatever a test hands back.
const missing = vi.hoisted(() => vi.fn());
vi.mock("@/client/rpc/client", () => ({
  rpcClient: { files: { missing: { call: missing } } },
}));

const PATH = "/Users/me/My Docs";
const QUOTED = `"${PATH}"`;

const noop = () => {
  // Nothing to do: these tests assert on the document.
};

async function renderEditor() {
  const ref = createRef<PromptEditorRef>();
  await render(
    <div style={{ height: 200, width: 600 }}>
      <PromptEditor
        actions={[]}
        apps={[]}
        autoFocus={false}
        bounds={null}
        defaultValue=""
        disabled={false}
        onChange={noop}
        onPaste={() => false}
        onSubmit={noop}
        ref={ref}
        skills={[]}
      />
    </div>,
  );
  return ref;
}

const editor = () => page.getByLabelText("Prompt");

async function paste(text: string) {
  await userEvent.click(editor());
  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", text);
  document
    .querySelector('[aria-label="Prompt"]')
    ?.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData }),
    );
}

/** An answer a test gives when it chooses to. */
function heldAnswer() {
  let give: (answer: { missing: string[] }) => void = noop;
  missing.mockReturnValueOnce(
    new Promise((resolve) => {
      give = resolve;
    }),
  );
  return (paths: string[] = []) => {
    give({ missing: paths });
  };
}

/** A turn for an answer already given to reach the document. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

const tinted = () =>
  [...document.querySelectorAll("[data-path]")]
    .map((span) => span.textContent)
    .join("");

const undoKey = /Mac/u.test(navigator.platform) ? "Meta" : "Control";

describe("a pasted path with spaces", () => {
  beforeEach(() => {
    missing.mockReset();
    missing.mockResolvedValue({ missing: [] });
  });

  it("gets quotes when it is real, and what is typed after stays out of it", async () => {
    const answer = heldAnswer();
    const ref = await renderEditor();

    await paste(PATH);
    expect(ref.current?.getValue()).toBe(PATH);
    answer();
    await vi.waitFor(() => {
      expect(ref.current?.getValue()).toBe(QUOTED);
    });
    expect(missing).toHaveBeenCalledExactlyOnceWith({ paths: [PATH] });

    await userEvent.keyboard(" dude");
    expect(ref.current?.getValue()).toBe(`${QUOTED} dude`);
    expect(tinted()).toBe(PATH);
  });

  it("takes up no room for its quotes", async () => {
    await renderEditor();

    await paste(PATH);
    await vi.waitFor(() => {
      expect(document.querySelectorAll("[data-path-quote]")).toHaveLength(2);
    });
    for (const quote of document.querySelectorAll("[data-path-quote]")) {
      expect(quote.textContent).toBe('"');
      expect(quote.getBoundingClientRect().width).toBe(0);
    }
  });

  it("asks about the home folder's path by where it really is", async () => {
    const ref = await renderEditor();

    await paste("~/My Docs");
    await vi.waitFor(() => {
      expect(ref.current?.getValue()).toBe('"~/My Docs"');
    });
    expect(missing).toHaveBeenCalledExactlyOnceWith({
      paths: ["/Users/sam/My Docs"],
    });
  });

  it("keeps a Windows folder whole with a word typed after it", async () => {
    const mac = window.electron;
    onTestFinished(() => {
      Object.defineProperty(window, "electron", {
        configurable: true,
        value: mac,
      });
    });
    Object.defineProperty(window, "electron", {
      configurable: true,
      value: { process: { platform: "win32" } },
    });
    const folder = "D:\\Games\\World of Warcraft";
    const ref = await renderEditor();

    await paste(folder);
    await vi.waitFor(() => {
      expect(ref.current?.getValue()).toBe(`"${folder}"`);
    });
    await userEvent.keyboard(" dude");
    expect(missing).toHaveBeenCalledExactlyOnceWith({ paths: [folder] });
    expect(ref.current?.getValue()).toBe(`"${folder}" dude`);
    expect(tinted()).toBe(folder);
  });

  it("goes in the quotes around a path pasted after other words", async () => {
    const ref = await renderEditor();

    await userEvent.click(editor());
    await userEvent.keyboard("look in ");
    await paste(PATH);
    await vi.waitFor(() => {
      expect(ref.current?.getValue()).toBe(`look in ${QUOTED}`);
    });
    expect(tinted()).toBe(PATH);
  });

  it("goes in the quotes around words typed while waiting", async () => {
    const answer = heldAnswer();
    const ref = await renderEditor();

    await paste(PATH);
    await userEvent.keyboard(" dude");
    answer();

    await vi.waitFor(() => {
      expect(ref.current?.getValue()).toBe(`${QUOTED} dude`);
    });
  });

  it("undoes with the paste in one step", async () => {
    const answer = heldAnswer();
    const ref = await renderEditor();

    await paste(PATH);
    // Past the time the history would join two edits on its own.
    await new Promise((resolve) => setTimeout(resolve, 600));
    answer();
    await vi.waitFor(() => {
      expect(ref.current?.getValue()).toBe(QUOTED);
    });

    await userEvent.keyboard(`{${undoKey}>}z{/${undoKey}}`);
    expect(ref.current?.getValue()).toBe("");
  });

  it("stays as pasted when nothing is there", async () => {
    missing.mockResolvedValue({ missing: [PATH] });
    const ref = await renderEditor();

    await paste(PATH);
    await vi.waitFor(() => {
      expect(missing).toHaveBeenCalled();
    });
    await settled();
    expect(ref.current?.getValue()).toBe(PATH);
  });

  it("stays as pasted when the check fails", async () => {
    missing.mockRejectedValue(new Error("no answer"));
    const ref = await renderEditor();

    await paste(PATH);
    await vi.waitFor(() => {
      expect(missing).toHaveBeenCalled();
    });
    await settled();
    expect(ref.current?.getValue()).toBe(PATH);
  });

  it("stays as pasted when the answer comes too late", async () => {
    const answer = heldAnswer();
    const ref = await renderEditor();

    await paste(PATH);
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 60_000);
    answer();
    await settled();
    clock.mockRestore();
    expect(ref.current?.getValue()).toBe(PATH);
  });

  it("stays as it is when the words were edited before the answer", async () => {
    const answer = heldAnswer();
    const ref = await renderEditor();

    await paste(PATH);
    await userEvent.keyboard("{ArrowLeft}x");
    expect(ref.current?.getValue()).toBe("/Users/me/My Docxs");
    answer();
    await settled();
    expect(ref.current?.getValue()).toBe("/Users/me/My Docxs");
  });

  it("stays out of the document when the words were undone before the answer", async () => {
    const answer = heldAnswer();
    const ref = await renderEditor();

    await paste(PATH);
    await userEvent.keyboard(`{${undoKey}>}z{/${undoKey}}`);
    expect(ref.current?.getValue()).toBe("");
    answer();
    await settled();
    expect(ref.current?.getValue()).toBe("");
  });

  it("leaves words it cannot quote into a path, in the middle of a word", async () => {
    const answer = heldAnswer();
    const ref = await renderEditor();

    await userEvent.click(editor());
    await userEvent.keyboard("ab{ArrowLeft}");
    await paste(PATH);
    answer();
    await settled();
    expect(ref.current?.getValue().includes('"')).toBe(false);
  });
});

describe("a paste left alone without asking the disk", () => {
  beforeEach(() => {
    missing.mockReset();
    missing.mockResolvedValue({ missing: [] });
  });

  it.each([
    ["no spaces", "/Users/me/Docs"],
    ["already quoted", QUOTED],
    ["more than one line", `${PATH}\nand more`],
    ["read whole without quotes", "/Users/me/My Docs/report.pdf"],
    ["a Terminal's escaped space", "/Users/me/My\\ Docs"],
    ["a sentence with a path in it", `look in ${PATH} please`],
  ])("%s", async (_name, text) => {
    const ref = await renderEditor();

    await paste(text);
    await settled();
    expect(missing).not.toHaveBeenCalled();
    expect(ref.current?.getValue()).toBe(text);
  });
});

describe("the caret around a quoted path", () => {
  beforeEach(() => {
    missing.mockReset();
    missing.mockResolvedValue({ missing: [] });
  });

  const pasted = async () => {
    const ref = await renderEditor();
    await paste(PATH);
    await vi.waitFor(() => {
      expect(ref.current?.getValue()).toBe(QUOTED);
    });
    return ref;
  };

  it("deletes the path's last letter on Backspace after it", async () => {
    const ref = await pasted();

    await userEvent.keyboard("{Backspace}");
    expect(ref.current?.getValue()).toBe('"/Users/me/My Doc"');
  });

  it("crosses the quote in one press of the Left arrow", async () => {
    const ref = await pasted();

    await userEvent.keyboard("{ArrowLeft}x");
    expect(ref.current?.getValue()).toBe('"/Users/me/My Docxs"');
  });

  it("crosses the quote in one press of the Right arrow", async () => {
    const ref = await pasted();

    await userEvent.keyboard(" dude{Home}");
    await userEvent.keyboard("{ArrowRight}x");
    expect(ref.current?.getValue()).toBe('"/xUsers/me/My Docs" dude');
  });

  it("deletes the words after it with Delete from its end", async () => {
    const ref = await pasted();

    await userEvent.keyboard("!");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowRight}");
    await userEvent.keyboard("{Delete}");
    expect(ref.current?.getValue()).toBe(QUOTED);
  });

  it("joins the line with Backspace from the path's first letter", async () => {
    const ref = await renderEditor();

    await userEvent.click(editor());
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await paste(PATH);
    await vi.waitFor(() => {
      expect(ref.current?.getValue()).toBe(`\n${QUOTED}`);
    });
    await userEvent.keyboard(`{ArrowLeft>${PATH.length.toString()}/}`);
    await userEvent.keyboard("{Backspace}");
    expect(ref.current?.getValue()).toBe(QUOTED);
  });
});
