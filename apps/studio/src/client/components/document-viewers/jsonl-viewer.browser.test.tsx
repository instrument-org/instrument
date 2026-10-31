import { renderInBrowser } from "@/tests/render-browser";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import "../../styles/globals.css";
import { JsonlViewer } from "./jsonl-viewer";

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  ["an empty", ""],
  ["a blank-lines-only", "\n  \n"],
])("says %s file is a table with no rows", async (_, text) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(text))),
  );

  await renderInBrowser(
    <div className="flex h-96 w-[48rem] flex-col">
      <JsonlViewer url="instrument://computer-test/edits.jsonl" />
    </div>,
  );

  await expect
    .element(page.getByText("This table has no rows."))
    .toBeInTheDocument();
});
