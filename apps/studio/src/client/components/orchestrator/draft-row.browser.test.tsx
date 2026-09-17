import { type Draft } from "@/client/atoms/orchestrator";
import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { DraftRow } from "./draft-row";
import { type RowDensity } from "./row-shell";
import { ThreadList } from "./thread-list";
import { type Topic } from "./threads";

/** The moment every row is read at: a Wednesday afternoon. */
const NOW = new Date(2026, 8, 16, 14, 30);

/** When the fixture's draft was last touched, earlier the same day. */
const TOUCHED_AT = new Date(2026, 8, 16, 9, 11);

const WORDS =
  "Guard the Nest eco mode before 5 p.m.\nIt keeps tripping while the second floor is empty.";

const HOUSE: Topic = {
  color: "#0f9d6e",
  createdAt: 1,
  emoji: "🏠",
  id: "house",
  name: "House",
};

/** The row's own action, by name. */
function actionOf(row: HTMLElement, label: string) {
  const action = row.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!action) {
    throw new Error(`no ${label}`);
  }
  return action;
}

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    createdAt: TOUCHED_AT.getTime() - 60_000,
    id: "draft-1",
    updatedAt: TOUCHED_AT.getTime(),
    words: WORDS,
    ...overrides,
  };
}

/** The gutter at the row's left, which holds the mark. */
function gutterOf(row: HTMLElement) {
  const gutter = row.firstElementChild;
  if (!(gutter instanceof HTMLElement)) {
    throw new TypeError("no gutter");
  }
  return gutter;
}

async function renderRow(
  row: Draft,
  {
    density = "tall",
    onDelete = vi.fn(),
    onOpen = vi.fn(),
  }: {
    density?: RowDensity;
    onDelete?: () => void;
    onOpen?: () => void;
  } = {},
) {
  const rendered = await renderInBrowser(
    <div style={{ width: density === "slim" ? "800px" : "400px" }}>
      <DraftRow
        density={density}
        draft={row}
        now={NOW}
        onDelete={onDelete}
        onOpen={onOpen}
        topics={[HOUSE]}
      />
    </div>,
  );
  const element =
    rendered.container.querySelector<HTMLElement>('[role="button"]');
  if (!element) {
    throw new Error("no row");
  }
  return { ...rendered, onDelete, onOpen, row: element };
}

/** The time at the row's end. */
function timeOf(row: HTMLElement) {
  const time = row.querySelector<HTMLElement>(".text-right");
  if (!time) {
    throw new Error("no time");
  }
  return time;
}

describe("DraftRow", () => {
  it.each<RowDensity>(["tall", "slim"])(
    "wears a pencil, the topic, the first line of the words, Draft, and the time, %s",
    async (density) => {
      const { row } = await renderRow(draft({ topicId: "house" }), {
        density,
      });
      expect(gutterOf(row).querySelector("[aria-label]")?.ariaLabel).toBe(
        "Draft",
      );
      expect(row.querySelector("svg")).not.toBeNull();
      // Slim, the time ends the one line; tall, it ends the first, and
      // Draft sits on the second where a thread's latest line goes.
      expect(row.textContent).toBe(
        density === "slim"
          ? "🏠HouseGuard the Nest eco mode before 5 p.m.Draft9:11 AM"
          : "🏠HouseGuard the Nest eco mode before 5 p.m.9:11 AMDraft",
      );
      expect(row.textContent).not.toContain("second floor");
      const time = timeOf(row).getBoundingClientRect();
      for (const child of row.children) {
        expect(child.getBoundingClientRect().right).toBeLessThanOrEqual(
          time.right,
        );
      }
      // The pill names the topic and opens nothing of its own.
      expect(row.querySelector("button.rounded-full")).toBeNull();
    },
  );

  it("is a new thread while it has no words, and wears no pill for a topic that is gone", async () => {
    const { row } = await renderRow(draft({ topicId: "money", words: " \n" }));
    expect(row.textContent).toBe("New thread9:11 AMDraft");
  });

  it("opens the draft from a click anywhere on it, and from Enter", async () => {
    const { onDelete, onOpen, row } = await renderRow(draft());
    row.click();
    gutterOf(row).click();
    timeOf(row).click();
    expect(onOpen).toHaveBeenCalledTimes(3);
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(4);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("deletes from the action at its edge, which is there only under the pointer and stops short of opening", async () => {
    const { onDelete, onOpen, row } = await renderRow(draft());
    const remove = actionOf(row, "Delete draft");
    await userEvent.unhover(row);
    expect(remove.getClientRects().length).toBe(0);
    await userEvent.hover(gutterOf(row));
    await vi.waitFor(() => {
      expect(remove.getClientRects().length).toBeGreaterThan(0);
    });
    const time = timeOf(row).getBoundingClientRect();
    const box = remove.getBoundingClientRect();
    expect(box.left).toBeLessThan(time.right);
    expect(box.bottom).toBeGreaterThan(time.top);
    await userEvent.click(remove);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("offers opening and deleting on its menu", async () => {
    const { onDelete, onOpen, row } = await renderRow(draft());
    await userEvent.click(row, { button: "right" });
    const menu = page.getByRole("menu");
    await expect.element(menu).toBeVisible();
    expect(
      [...menu.element().querySelectorAll('[role="menuitem"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(["Open", "Delete draft"]);
    await userEvent.click(menu.getByText("Delete draft"));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(row, { button: "right" });
    await userEvent.click(page.getByRole("menuitem", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("the list of drafts", () => {
  it("lists the drafts newest first in place of the threads, each opening and deleting by its id", async () => {
    const onOpenDraft = vi.fn();
    const onDeleteDraft = vi.fn();
    const rendered = await renderInBrowser(
      <div style={{ height: "300px", width: "400px" }}>
        <ThreadList
          appsBySlug={new Map()}
          drafts={[
            draft({
              id: "older",
              updatedAt: Date.now() - 2000,
              words: "Older",
            }),
            draft({
              id: "newer",
              updatedAt: Date.now() - 1000,
              words: "Newer",
            }),
          ]}
          emptyLine="No drafts yet."
          isLoading={false}
          onDeleteDraft={onDeleteDraft}
          onNewTopic={vi.fn()}
          onOpen={vi.fn()}
          onOpenDraft={onOpenDraft}
          onSetTopics={vi.fn()}
          openId={undefined}
          scrollSignal={0}
          threads={[]}
          topics={[]}
        />
      </div>,
    );
    const rows = [
      ...rendered.container.querySelectorAll<HTMLElement>('[role="button"]'),
    ];
    expect(rows.map((row) => row.textContent.slice(0, 5))).toEqual([
      "Newer",
      "Older",
    ]);
    expect(rows.every((row) => row.textContent.endsWith("Draft"))).toBe(true);
    rows[1]?.click();
    expect(onOpenDraft).toHaveBeenCalledWith("older");
    await userEvent.hover(rows[0] ?? document.body);
    await userEvent.click(actionOf(rows[0] ?? document.body, "Delete draft"));
    expect(onDeleteDraft).toHaveBeenCalledWith("newer");
    expect(onOpenDraft).toHaveBeenCalledOnce();
  });
});
