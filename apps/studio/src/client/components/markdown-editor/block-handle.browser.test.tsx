import {
  closeMarkdownEditors,
  openMarkdownEditor,
} from "@/tests/markdown-editor";
import { NodeSelection } from "@milkdown/kit/prose/state";
import { type EditorView } from "@milkdown/kit/prose/view";
import { afterEach, expect, test, vi } from "vitest";

// See openMarkdownEditor: the session's file goes through the main process.
vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

const MARKDOWN = `# Notes

The quick brown fox jumps over the lazy dog.

A second paragraph, a block of its own.

- first item in a list
- second item
- third item
`;

/** The blocks a handle can stand beside: a list is its items, not one block. */
const BLOCKS = ":scope > :is(h1, p), .milkdown-list-item-block";

afterEach(closeMarkdownEditors);

/** The editor on the document above, once Crepe has added the handle, which it does a frame after the editor is up. */
async function openEditor() {
  const view = await openMarkdownEditor(MARKDOWN);
  await expect.poll(blockHandle).not.toBeNull();
  return view;
}

function blockHandle() {
  return document.querySelector<HTMLElement>(".milkdown-block-handle");
}

/** Where the block that reads `text` is drawn. */
function block(view: EditorView, text: string) {
  const found = [...view.dom.querySelectorAll<HTMLElement>(BLOCKS)].find(
    (element) => element.textContent.includes(text),
  );
  if (!found) {
    throw new Error(`no block reading "${text}"`);
  }
  return found.getBoundingClientRect();
}

const middleOf = (box: DOMRect) => box.top + box.height / 2;

/** Moves the pointer to a height in the editor, the way a mouse over the text does. */
function point(view: EditorView, clientY: number) {
  const box = view.dom.getBoundingClientRect();
  view.dom.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      clientX: box.left + box.width / 2,
      clientY,
    }),
  );
}

/** The text of the block the handle is drawn beside, or null while it is hidden. */
function besideHandle(view: EditorView) {
  const handle = blockHandle();
  if (handle?.dataset.show !== "true") {
    return null;
  }
  const middle = middleOf(handle.getBoundingClientRect());
  const beside = [...view.dom.querySelectorAll<HTMLElement>(BLOCKS)].find(
    (element) => {
      const at = element.getBoundingClientRect();
      return middle >= at.top && middle <= at.bottom;
    },
  );
  // A list item's marker is markup with whitespace of its own around it.
  return beside?.textContent.trim() ?? "between blocks";
}

/** Long enough for a placement to be drawn, far short of any delay worth noticing. */
const nextFrame = () =>
  new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });

test("the handle is beside the block the pointer is on by the next frame, however soon after the last one", async () => {
  const view = await openEditor();

  // Two readings back to back: the pointer crossing from one block into
  // another faster than the plugin, unpatched, reads it.
  point(view, middleOf(block(view, "quick brown fox")));
  point(view, middleOf(block(view, "second item")));
  await nextFrame();

  expect(besideHandle(view)).toBe("second item");
});

test("a press on the handle picks the block it is beside, however soon after it got there", async () => {
  const view = await openEditor();

  point(view, middleOf(block(view, "quick brown fox")));
  point(view, middleOf(block(view, "A second paragraph")));
  blockHandle()?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

  const { selection } = view.state;
  expect(selection).toBeInstanceOf(NodeSelection);
  expect(selection instanceof NodeSelection && selection.node.textContent).toBe(
    "A second paragraph, a block of its own.",
  );
});

test.each([
  {
    // On no block at all, where the plugin hides the handle.
    between: "two paragraphs",
    on: "The quick brown fox jumps over the lazy dog.",
    under: "A second paragraph",
  },
  {
    // On the list around them, whose own handle stands at its top, beside
    // the first item.
    between: "two items of a list",
    on: "second item",
    under: "third item",
  },
])(
  "the handle stays with its block while the pointer is level with the space between $between",
  async ({ on, under }) => {
    const view = await openEditor();
    const here = block(view, on);

    point(view, middleOf(here));
    await nextFrame();
    expect(besideHandle(view)).toBe(on);

    point(view, (here.bottom + block(view, under).top) / 2);
    await nextFrame();

    expect(besideHandle(view)).toBe(on);
  },
);

test("the handle fades in each time it lands on a block, and not again while the pointer stays on it", async () => {
  const view = await openEditor();
  const first = middleOf(block(view, "quick brown fox"));
  const handle = blockHandle();
  if (!handle) {
    throw new Error("no handle");
  }
  const fade = vi.spyOn(handle, "animate");

  point(view, first);
  await nextFrame();
  expect(fade).toHaveBeenCalledTimes(1);

  point(view, first + 2);
  await nextFrame();
  expect(fade).toHaveBeenCalledTimes(1);

  point(view, middleOf(block(view, "A second paragraph")));
  await nextFrame();
  expect(fade).toHaveBeenCalledTimes(2);
});
