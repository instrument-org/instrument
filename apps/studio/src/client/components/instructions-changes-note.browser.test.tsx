import { rpcClient } from "@/client/rpc/client";
import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";

import { renderInBrowser } from "../../tests/render-browser";
import { InstructionsChangesNote } from "./instructions-changes-note";

const gaming = { emoji: "🎮", id: "gaming", name: "Gaming" };

describe("InstructionsChangesNote", () => {
  it("says each change, naming the project by its pill", async () => {
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
      [{ ...gaming, created: "2026-11-01" }],
    );
    await expect
      .element(page.getByRole("button", { name: /Gaming/ }))
      .toBeVisible();
    const lines = [...container.querySelectorAll("p")].map(
      (line) => line.textContent,
    );
    expect(lines).toEqual([
      "Updated instructions, added 1 folder from🎮Gaming",
      "Updated workspace instructions",
      "Moved toOld",
    ]);
  });
});
