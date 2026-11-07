import { renderInBrowser } from "@/tests/render-browser";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import {
  FileSystem,
  type FileSystemItem,
  type FileSystemView,
} from "./file-system";

// A folder opened while its window cannot draw: a tab restored by an
// automatic restart while the computer sleeps lays out before anything has
// a size, and its resize observer can stay quiet once it does.

const MANY = Array.from(
  { length: 400 },
  (_, index): FileSystemItem => ({
    kind: "file",
    path: `f${String(index).padStart(3, "0")}.html`,
  }),
);

let reveal = () => {};
let fill = () => {};

function Harness({ view }: { view: FileSystemView }) {
  const [isShown, setShown] = useState(false);
  const [items, setItems] = useState<FileSystemItem[]>([]);
  reveal = () => {
    setShown(true);
  };
  fill = () => {
    setItems(MANY);
  };
  return (
    <div
      style={{ display: isShown ? "block" : "none", height: 2000, width: 900 }}
    >
      <FileSystem defaultView={view} items={items} />
    </div>
  );
}

/** Whether the drawn rows reach the bottom of the viewport they scroll in. */
function rowsFillViewport() {
  const viewport = document.querySelector<HTMLElement>(
    '[data-slot="scroll-area-viewport"]',
  );
  const rows = [...document.querySelectorAll('[role="option"]')];
  const last = rows.at(-1)?.getBoundingClientRect().bottom ?? 0;
  const bottom = viewport?.getBoundingClientRect().bottom ?? 0;
  return { fills: last >= bottom - 1, rows: rows.length };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each<FileSystemView>(["list", "table", "columns"])(
  "draws the %s view's rows once a window that was away is back",
  async (view) => {
    // The observer that would have measured the viewport once it had a size.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect() {}
        observe() {}
        unobserve() {}
      },
    );
    await renderInBrowser(<Harness view={view} />);
    fill();
    await settle();
    reveal();
    await settle();
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(rowsFillViewport().fills).toBe(true);
  },
);
