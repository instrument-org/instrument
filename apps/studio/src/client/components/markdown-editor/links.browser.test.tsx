import {
  closeMarkdownEditors,
  openMarkdownEditor,
} from "@/tests/markdown-editor";
import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";

// See openMarkdownEditor; the links plugin also asks which linked files are missing.
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    files: { missing: { call: () => Promise.resolve({ missing: [] }) } },
  },
}));

afterEach(closeMarkdownEditors);

test("clicking the address in the link tooltip opens what it names in the app", async () => {
  const onOpenLink = vi.fn();
  const view = await openMarkdownEditor("See [the plan](plan.md) here.\n", {
    onOpenLink,
  });
  // The preview shows on hover, and only while the editor has focus.
  view.focus();
  await userEvent.hover(view.dom.querySelector("a") ?? view.dom);
  const address = await vi.waitUntil(() =>
    document.querySelector<HTMLElement>(
      ".milkdown-link-preview[data-show='true'] a.link-display[href]:not([href=''])",
    ),
  );
  let defaultPrevented = false;
  window.addEventListener(
    "click",
    (e) => {
      defaultPrevented = e.defaultPrevented;
    },
    { once: true },
  );

  await userEvent.click(address);

  expect(defaultPrevented).toBe(true);
  expect(onOpenLink).toHaveBeenCalledExactlyOnceWith(
    { kind: "path", path: "/plan.md" },
    false,
  );
});
