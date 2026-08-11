import { ariaSnapshot } from "@/tests/aria-snapshot";
import { renderInBrowser } from "@/tests/render-browser";
import { type TaskId } from "@instrument-org/workspace/client";
import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { FilePreviewCard } from "./file-preview-card";

/**
 * A file row opens the file, and for most of its life it did that from a click
 * handler on a plain `<div>`. That reads correctly to a pointer and to nothing
 * else: no tab stop, no name, no Enter, and no way for a script driving the app
 * to address it except by position.
 *
 * jsdom would answer the first of these and none of the rest, since what is
 * reachable is a question about hit-testing and focus, so this lives here.
 */

const FILE = {
  filename: "notes.md",
  filePath: "/task/notes.md",
  mimeType: "text/markdown",
  modifiedAt: 0,
  taskId: "task_1" as TaskId,
  url: "blob:none",
};

async function renderRow(onClick: () => void) {
  return renderInBrowser(
    <div style={{ width: 420 }}>
      <FilePreviewCard file={FILE} onClick={onClick} />
    </div>,
  );
}

test("offers the row as one named control", async () => {
  const { locator } = await renderRow(vi.fn());

  await expect(ariaSnapshot(locator)).resolves.toMatchInlineSnapshot(`
    "- button "Open notes.md"
    - text: notes.md Markdown
    - button "Actions for notes.md""
  `);
});

test("opens the file from the keyboard, not only from a click", async () => {
  const onClick = vi.fn();
  await renderRow(onClick);

  // Tab rather than focusing the control directly: a control that cannot be
  // reached this way is one a keyboard user does not have, however well it
  // behaves once focus is on it.
  await userEvent.tab();
  await expect
    .element(page.getByRole("button", { name: "Open notes.md" }))
    .toHaveFocus();

  await userEvent.keyboard("{Enter}");

  // Once, not twice. The row above the button carries the click handler, so a
  // second handler on the button itself would run on the way past.
  expect(onClick).toHaveBeenCalledTimes(1);
});

test("still opens the file from a press anywhere along the row", async () => {
  const onClick = vi.fn();
  const { container } = await renderRow(onClick);

  // The empty strip to the right of the filename, which is where the actions
  // menu sits once it is hovered into view. Pressing it used to do nothing at
  // all, and that is the reason the row carries the handler rather than a
  // button wrapping only the text.
  const row = container.firstElementChild?.firstElementChild;
  if (!row) {
    throw new Error("the row did not render");
  }
  const box = row.getBoundingClientRect();
  await userEvent.click(row, {
    position: { x: box.width - 8, y: box.height / 2 },
  });

  expect(onClick).toHaveBeenCalledTimes(1);
});
