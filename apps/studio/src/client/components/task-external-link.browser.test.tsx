// Where this menu lands is a measured claim about three boxes -- the link, the
// menu, and the point the press happened at -- and jsdom has no layout to
// measure any of them, so the straddle would assert nothing there but the props
// it was handed. The destinations are checked here too rather than in a cheaper
// project, so the click that picks one is a real press and release over a row
// that is really under the pointer.
import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";

// Relative, not `@/tests/render-browser`: oxlint's type-aware pass does not
// resolve the alias to this module and every access downstream then reads as an
// error type.
import { renderInBrowser } from "../../tests/render-browser";
import { TaskExternalLink } from "./task-external-link";

const openInTaskBrowser = vi.fn();
const openExternalLink = vi.fn();

vi.mock("@/client/hooks/use-open-in-task-browser", () => ({
  useOpenInTaskBrowser: () => openInTaskBrowser,
}));

vi.mock("@/client/hooks/use-open-external-link", () => ({
  useOpenExternalLink: () => openExternalLink,
}));

const HREF = "https://example.com/page";
const TASK_ID = TaskIdSchema.parse("a-task");
const SESSION_ID = StoreId.newSessionId();

// `p-1` on the content plus one `py-1.5 text-sm` row: what sits above the press
// point so the second row can sit below it.
const FIRST_ROW_HEIGHT = 36;
// `px-3` plus a `size-4` icon.
const ICON_COLUMN_WIDTH = 28;

// floating-ui rounds what it places onto the device pixel grid, so a number
// asked for in layout px lands within half a device px of it.
const ROUNDING = 0.5;
const offBy = (actual: number, expected: number) => Math.abs(actual - expected);

const box = (selector: string) => {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) {
    throw new Error(`${selector} is not mounted`);
  }
  return found.getBoundingClientRect();
};

const menuBox = () => box('[data-slot="dropdown-menu-content"]');

/** Press the link where a reader would land on it: inside, but not at a corner. */
function pressAt(link: HTMLElement) {
  const rect = link.getBoundingClientRect();
  const point = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };

  // The whole sequence, in the order a browser sends it. The release matters as
  // much as the press here: it is what would pick a destination on its own if
  // the menu were already open under the pointer.
  for (const type of ["pointerdown", "pointerup", "click"]) {
    link.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
      }),
    );
  }

  return point;
}

async function renderLink() {
  const result = await renderInBrowser(
    // Pushed off the window's edges so the menu has room on every side and
    // floating-ui's collision handling never becomes the thing under test.
    <div style={{ padding: 200 }}>
      <TaskExternalLink href={HREF} sessionId={SESSION_ID} taskId={TASK_ID}>
        Page domain reference
      </TaskExternalLink>
    </div>,
  );

  const link = document.querySelector<HTMLElement>(`a[href="${HREF}"]`);
  if (!link) {
    throw new Error("the link is not mounted");
  }
  return { link, ...result };
}

describe("TaskExternalLink in a browser", () => {
  it("straddles the point the press landed on", async () => {
    const { link } = await renderLink();
    const point = pressAt(link);

    await vi.waitFor(() => {
      const menu = menuBox();
      // One row above the press, so the second row is below it and either
      // destination is the same short move away.
      expect(offBy(point.y - menu.top, FIRST_ROW_HEIGHT)).toBeLessThanOrEqual(
        ROUNDING,
      );
      // The pointer lands on the first row's icon rather than outside the
      // menu's rounded left edge.
      expect(offBy(point.x - menu.left, ICON_COLUMN_WIDTH)).toBeLessThanOrEqual(
        ROUNDING,
      );
    });
  });

  it("offers both destinations", async () => {
    const { getByRole, link } = await renderLink();
    pressAt(link);

    await expect
      .element(getByRole("menuitem", { name: "Open in Instrument" }))
      .toBeVisible();
    await expect
      .element(getByRole("menuitem", { name: "Open in your browser" }))
      .toBeVisible();
  });

  it("sends the page to the task browser", async () => {
    const { getByRole, link } = await renderLink();
    pressAt(link);

    await getByRole("menuitem", { name: "Open in Instrument" }).click();

    expect(openInTaskBrowser).toHaveBeenCalledWith(HREF);
    expect(openExternalLink).not.toHaveBeenCalled();
  });

  it("sends the page to the OS browser", async () => {
    const { getByRole, link } = await renderLink();
    pressAt(link);

    await getByRole("menuitem", { name: "Open in your browser" }).click();

    expect(openExternalLink).toHaveBeenCalledWith(HREF, { addReferral: true });
    expect(openInTaskBrowser).not.toHaveBeenCalled();
  });

  // A menu item turns a release it never saw a press for into a click, so that
  // a press-drag-release picks the row it lands on. The menu therefore cannot
  // open until the release is spent: opening it on the press would put a row
  // under a pointer that has not moved, and an ordinary click would choose the
  // first destination before the reader had read either of them.
  it("opens without choosing, on a click that never moves", async () => {
    const { link } = await renderLink();
    const point = pressAt(link);

    await vi.waitFor(() => {
      expect(menuBox().width).toBeGreaterThan(0);
    });

    // The row the menu put where the pointer already is.
    expect(document.elementFromPoint(point.x, point.y)).not.toBeNull();
    expect(openInTaskBrowser).not.toHaveBeenCalled();
    expect(openExternalLink).not.toHaveBeenCalled();
  });
});
