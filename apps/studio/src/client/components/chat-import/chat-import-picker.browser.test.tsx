import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it, vi } from "vitest";

import { type Candidate } from "./chat-import-model";
import { ChatImportPicker } from "./chat-import-picker";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

/** A thousand chats a day apart, every tenth incidental, the fifth imported. */
const CANDIDATES: Candidate[] = Array.from({ length: 1000 }, (_, index) => ({
  createdAt: new Date(NOW - index * DAY),
  imported: index === 5 ? ("chat-5" as Candidate["imported"]) : null,
  incidental: index % 10 === 9 || undefined,
  kind: "chatgpt-export",
  messages: 3,
  preview: `First words of chat ${index}`,
  sourceId: `c${index}`,
  title: `Chat ${index}`,
  updatedAt: new Date(NOW - index * DAY),
}));

async function renderPicker() {
  const onImport = vi.fn<(picked: Candidate[]) => void>();
  const screen = await renderInBrowser(
    <div className="flex h-[600px] flex-col">
      <ChatImportPicker
        candidates={CANDIDATES}
        onImport={onImport}
        sourceName="ChatGPT"
      />
    </div>,
  );
  return { onImport, screen };
}

describe("ChatImportPicker", () => {
  it("starts with every chat the person had picked, and draws only a screenful", async () => {
    const { screen } = await renderPicker();
    // 1000, less 100 incidental and the one already imported.
    await expect
      .element(screen.getByRole("button", { name: "Import 899 chats" }))
      .toBeVisible();
    expect(
      document.querySelectorAll("button[role=checkbox]").length,
    ).toBeLessThan(40);
  });

  it("imports exactly the rows picked after clearing", async () => {
    const { onImport, screen } = await renderPicker();
    await screen.getByRole("button", { name: "Clear" }).click();
    await screen.getByRole("checkbox", { name: /^Chat 2 / }).click();
    await screen.getByRole("button", { name: "Import 1 chat" }).click();
    expect(onImport.mock.calls[0]?.[0].map((entry) => entry.sourceId)).toEqual([
      "c2",
    ]);
  });

  it("shows the incidental chats behind a toggle that counts them", async () => {
    const { screen } = await renderPicker();
    await expect
      .element(screen.getByRole("checkbox", { name: /^Chat 9 / }))
      .not.toBeInTheDocument();
    await screen.getByText("Show 100 automatic chats").click();
    await expect
      .element(screen.getByRole("checkbox", { name: /^Chat 9 / }))
      .toBeVisible();
  });
});
