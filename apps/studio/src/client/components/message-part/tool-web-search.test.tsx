import { renderWithProviders } from "@/tests/render";
import { StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";

import { ToolCallSessionProvider } from "./tool-call-session";
import { ToolWebSearch } from "./tool-web-search";

const REMOTE_IMAGE = "https://raw.githubusercontent.com/o/r/main/p.png";
const LOOPBACK_IMAGE = "http://x.localhost:11434/probe";

// A page of somebody else's writing: one image on a host the agent's own
// markdown would be allowed, one on the loopback suffix every port on this
// machine answers to.
const PAGE_MARKDOWN = [
  "Some prose.",
  `![](${REMOTE_IMAGE})`,
  `![](${LOOPBACK_IMAGE})`,
].join("\n\n");

const part = (results: unknown) =>
  ({
    input: { query: "anything" },
    metadata: {
      id: StoreId.newPartId(),
      messageId: StoreId.newMessageId(),
      sessionId: StoreId.newSessionId(),
    },
    output: { results, state: "success" },
    state: "output-available",
    toolCallId: "call-1",
    type: "tool-web_search",
  }) as unknown as Parameters<typeof ToolWebSearch>[0]["part"];

// Every `<img>` on the card, favicons included, which is why the assertions
// name the sources that must be absent rather than demanding an empty page.
function imageSources(results: unknown): (null | string)[] {
  const { container } = renderWithProviders(
    <ToolCallSessionProvider isRunning={false} isStreaming={false}>
      <ToolWebSearch onRetry={vi.fn()} part={part(results)} />
    </ToolCallSessionProvider>,
  );
  return [...container.querySelectorAll("img")].map((image) =>
    image.getAttribute("src"),
  );
}

// Search results are pages someone else wrote, and an `<img>` naming a host is
// fetched the moment the card renders: no click, an IP disclosed, and over a
// loopback host whatever else is listening on this machine reached.
describe("ToolWebSearch images", () => {
  it("does not draw an excerpt's remote or loopback images", () => {
    const sources = imageSources({
      kind: "excerpts",
      sources: [
        { text: PAGE_MARKDOWN, title: "A page", url: "https://example.test/a" },
      ],
    });

    expect(sources).not.toContain(REMOTE_IMAGE);
    expect(sources).not.toContain(LOOPBACK_IMAGE);
  });

  it("does not draw a summary's remote or loopback images", () => {
    const sources = imageSources({
      kind: "summary",
      sources: [{ url: "https://example.test/a" }],
      text: PAGE_MARKDOWN,
    });

    expect(sources).not.toContain(REMOTE_IMAGE);
    expect(sources).not.toContain(LOOPBACK_IMAGE);
  });

  // Dropped means dropped: a scraped page's images leave no chip behind, so a
  // page of logos and tracker pixels does not become a column of them.
  it("stands no chip in for a dropped image", () => {
    const { container } = renderWithProviders(
      <ToolCallSessionProvider isRunning={false} isStreaming={false}>
        <ToolWebSearch
          onRetry={vi.fn()}
          part={part({
            kind: "summary",
            sources: [{ url: "https://example.test/a" }],
            text: PAGE_MARKDOWN,
          })}
        />
      </ToolCallSessionProvider>,
    );
    expect(container.textContent).not.toContain("raw.githubusercontent.com");
    expect(container.textContent).not.toContain("x.localhost");
  });
});
