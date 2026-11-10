import { rpcClient } from "@/client/rpc/client";
import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";

import { renderInBrowser } from "../../tests/render-browser";
import { InstructionsChangesNote } from "./instructions-changes-note";

const gaming = { emoji: "🎮", id: "gaming", name: "Gaming" };

describe("InstructionsChangesNote", () => {
  it("lists each place that changed, a project opening its details", async () => {
    const { container, queryClient } = await renderInBrowser(
      <div className="w-[640px] bg-background p-4">
        <InstructionsChangesNote
          changes={[
            {
              foldersAdded: 1,
              foldersRemoved: 0,
              instructions: "updated",
              kind: "project",
              project: gaming,
            },
            { instructions: "updated", kind: "workspace" },
          ]}
        />
        <InstructionsChangesNote
          changes={[{ kind: "filed", project: { id: "gone", name: "Old" } }]}
        />
      </div>,
    );
    queryClient.setQueryData(
      rpcClient.workspace.projects.list.queryOptions().queryKey,
      [{ ...gaming, created: new Date("2026-11-01") }],
    );
    await expect
      .element(page.getByRole("button", { name: /Gaming/ }))
      .toBeVisible();
    const cards = [
      ...container.querySelectorAll('[data-slot="instructions-changes"]'),
    ].map((card) =>
      [...card.querySelectorAll("li")].map((row) => row.textContent),
    );
    expect(cards).toEqual([
      [
        "🎮GamingInstructions updated1 folder added",
        "Workspace instructionsUpdated",
      ],
      ["OOldThis chat moved here"],
    ]);
    expect(page.getByText("Changed 2 instructions")).toBeTruthy();
  });
});
