// What a day of Activity is made of once drawn: thread heads with their
// entries under them, and a run of visits between them where its time falls.
import { renderWithProviders } from "@/tests/render";
import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type ActivityEntry, mergeRows, NO_ACTIVITY_FILTERS } from "./activity";
import { ActivityList } from "./activity-list";
import { OrchestratorContext, type OrchestratorWindow } from "./context";

vi.mock("@/client/hooks/use-open-in-task-browser", () => ({
  useOpenInTaskBrowser: () => vi.fn(),
}));

vi.mock("@/client/hooks/use-open-external-link", () => ({
  useOpenExternalLink: () => vi.fn(),
}));

const GROCERIES = StoreId.SessionSchema.parse("ses_01ARZ3NDEKTSV4RRFFQ69G5FAV");
const TAXES = StoreId.SessionSchema.parse("ses_01ARZ3NDEKTSV4RRFFQ69G5FAW");
const MINUTE = 60 * 1000;

function entry(
  thread: ActivityEntry["thread"],
  kind: ActivityEntry["kind"],
  minutesAgo: number,
  now: number,
): ActivityEntry {
  return {
    at: now - minutesAgo * MINUTE,
    id: `${thread.id}:msg:${kind}:${minutesAgo}`,
    kind,
    text: kind,
    thread,
  };
}

describe("ActivityList", () => {
  it("draws a day as thread heads over their entries, with a run of visits between them by time", () => {
    const now = Date.now();
    const groceries = { id: GROCERIES, title: "Groceries", topics: [] };
    const taxes = { id: TAXES, title: "Taxes", topics: [] };
    const rows = mergeRows(
      [
        entry(taxes, "asked", 10, now),
        entry(groceries, "replied", 30, now),
        entry(groceries, "asked", 40, now),
      ],
      [
        {
          at: now - 20 * MINUTE,
          kind: "file",
          target: { href: "/orchestrator/computer?file=/a.md", kind: "screen" },
          title: "a.md",
        },
      ],
    );
    const context = {
      ask: vi.fn(),
      browser: null,
      focusComposer: vi.fn(),
      openPage: vi.fn(),
      openScreen: vi.fn(),
      taskId: TaskIdSchema.parse("orchestrator"),
    } satisfies OrchestratorWindow;
    renderWithProviders(
      <OrchestratorContext value={context}>
        <ActivityList
          appsBySlug={new Map()}
          filters={NO_ACTIVITY_FILTERS}
          isLoading={false}
          rows={rows}
          topics={[]}
        />
      </OrchestratorContext>,
    );
    expect(screen.getByText("Today")).toBeDefined();
    expect(
      screen
        .getAllByRole("button")
        .map((row) => row.textContent.replace(/\d+m ago$/, "").trim()),
    ).toEqual([
      "Taxes",
      "You askedasked",
      "You looked ata.md",
      "Groceries",
      "Repliedreplied",
      "You askedasked",
    ]);
  });
});
