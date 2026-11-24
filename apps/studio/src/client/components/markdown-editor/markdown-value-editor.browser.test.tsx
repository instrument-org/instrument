import { renderInBrowser } from "@/tests/render-browser";
import { expect, it, vi } from "vitest";

import { MarkdownValueEditor } from "./markdown-value-editor";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

it("keeps its height when the virtual cursor is given its class", async () => {
  const screen = await renderInBrowser(
    <MarkdownValueEditor
      className="pt-6"
      label="Instructions"
      onChange={() => undefined}
      placeholder="What to know"
      value="Hello there"
    />,
  );
  const editor = await vi.waitUntil(() =>
    screen.container.querySelector<HTMLElement>(
      ".ProseMirror[aria-label=Instructions]",
    ),
  );
  const cursor = await vi.waitUntil(() =>
    editor.querySelector<HTMLElement>(
      ":scope > .ProseMirror-widget, :scope > .prosemirror-virtual-cursor",
    ),
  );
  // As ProseMirror mounts it, then as the cursor's first update leaves it.
  cursor.className = "ProseMirror-widget";
  const mounted = editor.offsetHeight;
  cursor.className = "prosemirror-virtual-cursor";
  expect(editor.offsetHeight).toBe(mounted);
});
