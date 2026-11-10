import { openFindForKeyboard } from "@/client/lib/find-targets";
import { renderInBrowser } from "@/tests/render-browser";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { MarkdownDocument } from "./markdown-outline";
import { SessionMarkdown } from "./session-markdown";
import { ThemeProvider } from "./theme-provider";

// Narrow enough for the outline to be the rail, whose hidden card has every
// heading's text in the same scroll container as the document.
const DOCUMENT = [
  "# Fox notes",
  "The quick brown fox jumps.",
  "## Second fox",
  "Nothing here.",
  "## Third",
  "A fox again.",
].join("\n\n");

it("finds in the document with cmd+f, counting each heading once", async () => {
  await renderInBrowser(
    <ThemeProvider defaultTheme="light">
      <div data-find-surface style={{ height: 400, width: 500 }}>
        <MarkdownDocument>
          <SessionMarkdown className="p-8" markdown={DOCUMENT} />
        </MarkdownDocument>
      </div>
    </ThemeProvider>,
  );
  await expect
    .element(page.getByRole("button", { name: "Contents" }))
    .toBeInTheDocument();

  expect(openFindForKeyboard()).toBe(true);
  const field = page.getByPlaceholder("Find in document");
  await expect.element(field).toHaveFocus();
  await userEvent.keyboard("fox");
  await expect.element(page.getByText("1 of 4")).toBeInTheDocument();

  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByText("2 of 4")).toBeInTheDocument();

  await userEvent.keyboard("{Escape}");
  await expect.element(field).not.toBeInTheDocument();
  expect(CSS.highlights.size).toBe(0);
});
