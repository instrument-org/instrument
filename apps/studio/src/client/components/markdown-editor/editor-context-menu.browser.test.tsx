import "@milkdown/crepe/theme/common/style.css";

import "./markdown-editor.css";

import { NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { createEditorSession, type EditorSession } from "./editor-session";

// The session reads and writes its file through the main process; nothing
// here saves, so neither is reached.
vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

const MARKDOWN = `# Notes

The quick brown fox jumps over the lazy dog.

- first item in a list
- second item
`;

let session: EditorSession | null = null;

afterEach(async () => {
  await session?.destroy();
  session = null;
  document.body.replaceChildren();
});

async function openEditor() {
  const frame = document.createElement("div");
  frame.className = "md-editor";
  frame.style.width = "640px";
  const root = document.createElement("div");
  frame.append(root);
  document.body.append(frame);
  session = await createEditorSession({
    hostPath: "/notes.md",
    initial: { content: MARKDOWN, version: "1" },
    onAsk: vi.fn(),
    onExternalChange: vi.fn(),
    onFrontMatter: vi.fn(),
    onStatus: vi.fn(),
    renderFence: () => null,
    resolveSrc: (src) => src,
    root,
  });
  return session.view();
}

/** Right-clicks a word and reports whether anything in the page claimed the event. */
async function rightClick(dom: HTMLElement, word: string) {
  let claimed: boolean | null = null;
  const record = (e: MouseEvent) => {
    claimed = e.defaultPrevented;
  };
  window.addEventListener("contextmenu", record);
  await userEvent.click(dom, {
    button: "right",
    position: wordBox(dom, word),
  });
  window.removeEventListener("contextmenu", record);
  return claimed;
}

/** Where a word is drawn, relative to the editor's own box. */
function wordBox(dom: HTMLElement, word: string) {
  const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const at = n.textContent?.indexOf(word) ?? -1;
    if (at >= 0) {
      const range = document.createRange();
      range.setStart(n, at);
      range.setEnd(n, at + word.length);
      const box = range.getBoundingClientRect();
      const origin = dom.getBoundingClientRect();
      return {
        x: box.left - origin.left + box.width / 2,
        y: box.top - origin.top + box.height / 2,
      };
    }
  }
  throw new Error(`no "${word}" in the editor`);
}

test("right-clicking text leaves the event to the native menu and the selection a text selection", async () => {
  const view = await openEditor();
  await userEvent.click(view.dom, { position: wordBox(view.dom, "lazy") });

  expect(await rightClick(view.dom, "first")).toBe(false);
  expect(view.state.selection).toBeInstanceOf(TextSelection);
  expect(view.state.selection).not.toBeInstanceOf(NodeSelection);
  expect(document.querySelector(".md-menu")).toBeNull();
});

test("right-clicking inside a selected range keeps the range", async () => {
  const view = await openEditor();
  await userEvent.click(view.dom, { position: wordBox(view.dom, "lazy") });
  const heading = view.dom.querySelector("h1");
  const headingTop = heading?.getBoundingClientRect().top;
  let start = -1;
  view.state.doc.descendants((node, pos) => {
    const at = node.isText ? (node.text?.indexOf("quick") ?? -1) : -1;
    if (start < 0 && at >= 0) {
      start = pos + at;
    }
  });
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, start, start + "quick".length),
    ),
  );

  // Making the range must not move the page under the pointer.
  expect(heading?.getBoundingClientRect().top).toBe(headingTop);
  expect(await rightClick(view.dom, "quick")).toBe(false);
  const { from: selFrom, to: selTo } = view.state.selection;
  expect(view.state.doc.textBetween(selFrom, selTo)).toBe("quick");
});
