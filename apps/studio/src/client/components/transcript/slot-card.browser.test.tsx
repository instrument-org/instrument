import { renderInBrowser } from "@/tests/render-browser";
import { StoreId, type TurnStep } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { SlotCardView } from "./slot-card";

// Whether Markdown came out as Markdown and code in its colors is a question
// about what the browser drew, which jsdom answers for any markup at all.

function writing(path: string, words: string): TurnStep {
  return {
    metadata: {
      createdAt: new Date("2026-01-01T00:00:00Z"),
      id: StoreId.newPartId(),
      messageId: StoreId.newMessageId(),
      sessionId: StoreId.newSessionId(),
    },
    shows: { kind: "file", path, words },
    status: "writing",
    tool: "tool-write_file",
    type: "step",
  };
}

async function renderCard(path: string, words: string) {
  return renderInBrowser(
    <div style={{ width: 460 }}>
      <SlotCardView
        card={{
          changedFile: undefined,
          kind: "files",
          steps: [writing(path, words)],
        }}
        isCurrent
        sessionId={StoreId.newSessionId()}
      />
    </div>,
  );
}

describe("a live card's file as it is written", () => {
  it("shows Markdown as it reads, with nothing in it to press", async () => {
    const screen = await renderCard(
      "/work/report.md",
      "- **Obsidian for Agents.** See [Thread](https://example.com).",
    );
    await expect
      .element(screen.getByText("Obsidian for Agents."))
      .toBeVisible();
    const card = screen.container.querySelector("[data-slot-card]");
    expect(card?.querySelector("strong")?.textContent).toBe(
      "Obsidian for Agents.",
    );
    expect(card?.textContent).not.toContain("**");
    expect(card?.querySelector("[inert] a")).not.toBeNull();
  });

  it("shows code in its colors", async () => {
    const screen = await renderCard(
      "/work/raw.json",
      '[{"q": ["website"], "count": 2}]',
    );
    await expect
      .poll(() =>
        screen.container.querySelector(".code-highlight .syntax-string"),
      )
      .not.toBeNull();
  });

  it("shows a file with no grammar as typed", async () => {
    const screen = await renderCard("/work/notes.txt", "**not bold**");
    await expect.element(screen.getByText("**not bold**")).toBeVisible();
  });
});
