import { type Draft } from "@/shared/drafts";
import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { type Project } from "./chats";
import { DraftRow } from "./draft-row";

/** The moment every row is read at: a Wednesday afternoon. */
const NOW = new Date(2026, 8, 16, 14, 30);

/** When the fixture's draft was last touched, earlier the same day. */
const TOUCHED_AT = new Date(2026, 8, 16, 9, 11);

const WORDS =
  "Guard the Nest eco mode before 5 p.m.\nIt keeps tripping while the second floor is empty.";

const HOUSE: Project = {
  color: "#0f9d6e",
  created: new Date(1),
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
    onDelete = vi.fn(),
    onOpen = vi.fn(),
  }: {
    onDelete?: () => void;
    onOpen?: () => void;
  } = {},
) {
  const rendered = await renderInBrowser(
    <div style={{ width: "400px" }}>
      <DraftRow
        draft={row}
        now={NOW}
        onDelete={onDelete}
        onOpen={onOpen}
        projects={[HOUSE]}
      />
    </div>,
  );
  const element =
    rendered.container.querySelector<HTMLElement>('[role="button"]');
  if (!element) {
    throw new Error("no row");
  }
  // The pointer is wherever the last test left it, which may be over this row,
  // and a hovered row trades its time for the delete action.
  await userEvent.unhover(element);
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
  it("wears a dashed circle, the project, the first line of the words, Draft, and the time", async () => {
    const { row } = await renderRow(draft({ projectId: "house" }));
    expect(gutterOf(row).querySelector("[aria-label]")?.ariaLabel).toBe(
      "Draft",
    );
    expect(row.querySelector("svg")).not.toBeNull();
    // The time ends the first line, and Draft sits on the second where a
    // chat's latest line goes.
    expect(row.textContent).toBe(
      "HouseGuard the Nest eco mode before 5 p.m.9:11 AMDraft",
    );
    expect(row.textContent).not.toContain("second floor");
    const time = timeOf(row).getBoundingClientRect();
    for (const child of row.children) {
      expect(child.getBoundingClientRect().right).toBeLessThanOrEqual(
        time.right,
      );
    }
    // The pill names the project and opens nothing of its own.
    expect(row.querySelector("button.rounded-full")).toBeNull();
  });

  it("is a new chat while it has no words, and wears no pill for a project that is gone", async () => {
    const { row } = await renderRow(
      draft({ projectId: "money", words: " \n" }),
    );
    expect(row.textContent).toBe("New chat9:11 AMDraft");
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

  it("deletes from the action in the time's place, which is there only under the pointer and stops short of opening", async () => {
    const { onDelete, onOpen, row } = await renderRow(draft());
    const remove = actionOf(row, "Delete draft");
    await userEvent.unhover(row);
    expect(remove.getClientRects().length).toBe(0);
    const time = timeOf(row).getBoundingClientRect();
    await userEvent.hover(gutterOf(row));
    await vi.waitFor(() => {
      expect(remove.getClientRects().length).toBeGreaterThan(0);
    });
    // In the time's place at the line's end, which steps aside for it.
    expect(timeOf(row).getClientRects().length).toBe(0);
    const box = remove.getBoundingClientRect();
    expect(box.right).toBeCloseTo(time.right, 0);
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
