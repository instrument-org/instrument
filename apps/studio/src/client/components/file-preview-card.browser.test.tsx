import { getComputerThumbnailUrl } from "@/client/lib/computer-file-url";
import { ariaSnapshot } from "@/tests/aria-snapshot";
import { renderInBrowser } from "@/tests/render-browser";
import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { FilePreviewCard } from "./file-preview-card";

vi.mock(import("@/client/lib/computer-file-url"), async (importOriginal) => ({
  ...(await importOriginal()),
  getComputerThumbnailUrl: vi.fn(() => ""),
}));
vi.mock("./theme-provider", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

afterEach(() => {
  vi.mocked(getComputerThumbnailUrl).mockReturnValue("");
});

// One white pixel, standing in for the picture the channel keeps of a file.
const PICTURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

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
  hostPath: "/Users/casey/tasks/task_1/notes.md",
  mimeType: "text/markdown",
  modifiedAt: 0,
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

// A Word document is the case this is for: no lines to stand in for text, so
// without the picture the card is a mark and a name.
const DOCUMENT = {
  filename: "digest.docx",
  hostPath: "/Users/casey/Instrument/digest.docx",
  url: "blob:none",
};

test("draws a document as the picture the channel keeps of it", async () => {
  vi.mocked(getComputerThumbnailUrl).mockReturnValue(PICTURE);
  const { container } = await renderInBrowser(
    <FilePreviewCard file={DOCUMENT} onClick={vi.fn()} />,
  );

  await expect
    .poll(() => container.querySelector("img")?.getAttribute("src"))
    .toBe(PICTURE);
});

test("draws a document as its type's mark where there is no picture of it", async () => {
  // The channel answers a file it has no picture of with a 404, which is an
  // image that fails to load.
  vi.mocked(getComputerThumbnailUrl).mockReturnValue("data:image/png;base64,");
  const { container } = await renderInBrowser(
    <FilePreviewCard file={DOCUMENT} onClick={vi.fn()} />,
  );

  await expect
    .poll(() => container.querySelector("svg use")?.getAttribute("href"))
    .toMatch(/^#/);
  expect(container.querySelector("img")).toBeNull();
});

test("gives the name the row until the pointer or focus asks for the menu", async () => {
  // A grid cell is narrow, and a menu nobody has asked for yet is the room a
  // long name would otherwise be cut short in.
  const { container } = await renderRow(vi.fn());
  // By its name rather than its role: collapsed, it has no box for a role
  // query to count as shown.
  const menu = () =>
    container.querySelector<HTMLElement>("[aria-label='Actions for notes.md']");
  const menuWidth = () =>
    Math.round(menu()?.parentElement?.getBoundingClientRect().width ?? -1);

  const row = container.firstElementChild?.firstElementChild;
  if (!(row instanceof HTMLElement)) {
    throw new TypeError("the row did not render");
  }
  // The pointer is wherever the last test left it, which may be this row.
  await userEvent.unhover(row);
  await expect.poll(menuWidth).toBe(0);

  await userEvent.hover(row);
  await expect.poll(menuWidth).toBeGreaterThan(0);

  await userEvent.unhover(row);
  await expect.poll(menuWidth).toBe(0);

  // From the keyboard too: the menu is the next stop after the row.
  await userEvent.tab();
  await userEvent.tab();
  expect(document.activeElement).toBe(menu());
  expect(menuWidth()).toBeGreaterThan(0);
});
