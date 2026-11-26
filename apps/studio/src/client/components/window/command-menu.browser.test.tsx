import { commandMenuOpenAtom } from "@/client/atoms/command-menu";
import { renderInBrowser } from "@/tests/render-browser";
import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { CommandMenu } from "./command-menu";

const opened = vi.hoisted(() => ({ page: vi.fn<(url: string) => void>() }));

// Every query stays pending: the menu's own rows are what is under test.
vi.mock("@/client/rpc/client", () => {
  const pending = () => new Promise(() => undefined);
  const procedure = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      apply: pending,
      get(_target, key) {
        if (key === "queryOptions" || key === "experimental_liveOptions") {
          return () => ({ queryFn: pending, queryKey: path });
        }
        if (key === "mutationOptions") {
          return (options: object) => ({ mutationFn: pending, ...options });
        }
        return typeof key === "string" ? procedure([...path, key]) : undefined;
      },
    });
  return { rpcClient: procedure([]) };
});

vi.mock("@/client/components/window/shell-context", () => ({
  useShell: () => ({
    goToPlace: () => undefined,
    newGroup: () => undefined,
    newTab: () => undefined,
    projects: [],
  }),
}));

vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({ setTheme: () => undefined, theme: "system" }),
}));

/** The menu Cmd+K opens, open. */
async function renderMenu() {
  const store = createStore();
  store.set(commandMenuOpenAtom, true);
  await renderInBrowser(
    <CommandMenu
      closeGroups={() => undefined}
      openPage={opened.page}
      openScreen={() => undefined}
      showTab={() => undefined}
    />,
    { store },
  );
  return store;
}

describe("the menu opened again", () => {
  it.each([
    ["while it is still closing", 50],
    ["once it has closed", 500],
  ])("is empty %s, and keeps what is typed", async (_case, wait) => {
    const store = await renderMenu();
    await userEvent.fill(page.getByRole("combobox"), "before");
    // As the chord closes it and opens it again.
    store.set(commandMenuOpenAtom, false);
    await new Promise((resolve) => setTimeout(resolve, wait));
    store.set(commandMenuOpenAtom, true);
    const field = page.getByRole("combobox").last();
    await expect.element(field).toHaveFocus();
    await expect.element(field).toHaveValue("");
    await userEvent.keyboard("after");
    await new Promise((resolve) => setTimeout(resolve, 400));
    await expect.element(field).toHaveValue("after");
    await expect.element(field).toHaveFocus();
    expect(page.getByRole("combobox").elements()).toHaveLength(1);
  });

  it("keeps what is typed after Escape closed it", async () => {
    const store = await renderMenu();
    await userEvent.fill(page.getByRole("combobox"), "before");
    await userEvent.keyboard("{Escape}");
    store.set(commandMenuOpenAtom, true);
    const field = page.getByRole("combobox").last();
    await expect.element(field).toHaveFocus();
    await userEvent.keyboard("after");
    await new Promise((resolve) => setTimeout(resolve, 400));
    await expect.element(field).toHaveValue("after");
  });
});

// Words pasted in arrive in one change, from the list shown before anything
// was typed straight to the rows for the whole of them. Return runs the row
// picked, so one has to be, and it is the first: what the words name.
describe("the row Return runs after a paste", () => {
  it("is the first", async () => {
    await renderMenu();
    const field = page.getByRole("combobox");
    await expect.element(page.getByText("New Tab Group")).toBeVisible();

    await userEvent.fill(field, "/Users/sam/Documents");
    await expect
      .element(page.getByRole("option", { selected: true }))
      .toMatchTextContent("sam/Documents");

    // A row picked by a key stays picked while the words stay.
    await userEvent.fill(field, "");
    await expect.element(page.getByText("New Tab Group")).toBeVisible();
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .element(page.getByRole("option").nth(1))
      .toHaveAttribute("aria-selected", "true");

    await userEvent.fill(field, "example.org");
    await expect
      .element(page.getByRole("option", { selected: true }))
      .toMatchTextContent("example.org");
    await userEvent.keyboard("{Enter}");
    expect(opened.page).toHaveBeenLastCalledWith("https://example.org/");
  });
});

describe("the row Return runs while typing", () => {
  it("is for every letter typed", async () => {
    await renderMenu();
    const field = page.getByRole("combobox");
    await expect.element(page.getByText("New Tab Group")).toBeVisible();

    // Return straight after the last letter, before the rows can follow.
    await userEvent.type(field, "example.com{Enter}");
    expect(opened.page).toHaveBeenLastCalledWith("https://example.com/");
  });

  it("stays on the first row when the rows change under a resting pointer", async () => {
    await renderMenu();
    await expect.element(page.getByText("New Tab Group")).toBeVisible();
    const first = page.getByRole("option").first();
    const last = page.getByRole("option").last();
    await expect.element(first).toHaveAttribute("aria-selected", "true");
    const moveTo = (x: number, y: number) => {
      const at = {
        bubbles: true,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
      };
      last.element().dispatchEvent(new PointerEvent("pointermove", at));
      last.element().dispatchEvent(new MouseEvent("mousemove", at));
    };

    // The pointer came to rest over the last row before these rows were
    // drawn, and the browser says so again once they are.
    moveTo(40, 40);
    moveTo(40, 40);
    // A pick the moves made would be drawn by now.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect.element(first).toHaveAttribute("aria-selected", "true");

    // A pointer that moves picks the row it is over.
    moveTo(42, 40);
    await expect.element(last).toHaveAttribute("aria-selected", "true");
  });
});

// The menu stays mounted between openings, so nothing of the last one's
// pick may carry over: Return runs the first row of a fresh opening.
describe("the row Return runs in a fresh opening", () => {
  const moveOver = (row: ReturnType<typeof page.getByRole>, x: number) => {
    const at = {
      bubbles: true,
      clientX: x,
      clientY: 40,
      screenX: x,
      screenY: 40,
    };
    row.element().dispatchEvent(new PointerEvent("pointermove", at));
    row.element().dispatchEvent(new MouseEvent("mousemove", at));
  };

  it("is the first, under a pointer that moved while it was closed", async () => {
    const store = await renderMenu();
    await expect.element(page.getByText("New Tab Group")).toBeVisible();
    const last = page.getByRole("option").last();
    moveOver(last, 40);
    moveOver(last, 42);
    await expect.element(last).toHaveAttribute("aria-selected", "true");

    store.set(commandMenuOpenAtom, false);
    await new Promise((resolve) => setTimeout(resolve, 500));
    store.set(commandMenuOpenAtom, true);
    await expect.element(page.getByText("New Tab Group")).toBeVisible();
    // The list comes up under a pointer now somewhere else, and the browser
    // says where it is.
    moveOver(page.getByRole("option").last(), 300);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect
      .element(page.getByRole("option").first())
      .toHaveAttribute("aria-selected", "true");
  });

  it("is the first after a key picked another in the last one", async () => {
    const store = await renderMenu();
    await expect.element(page.getByText("New Tab Group")).toBeVisible();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await expect
      .element(page.getByRole("option").nth(2))
      .toHaveAttribute("aria-selected", "true");

    store.set(commandMenuOpenAtom, false);
    await new Promise((resolve) => setTimeout(resolve, 500));
    store.set(commandMenuOpenAtom, true);
    await expect.element(page.getByText("New Tab Group")).toBeVisible();
    await expect
      .element(page.getByRole("option").first())
      .toHaveAttribute("aria-selected", "true");
  });
});

describe("the menu's icons", () => {
  it("asks for no icon for an address being typed", async () => {
    await renderMenu();
    const asked: string[] = [];
    const watch = new MutationObserver(() => {
      for (const image of document.querySelectorAll("img")) {
        asked.push(image.src);
      }
    });
    watch.observe(document.body, { childList: true, subtree: true });
    const field = page.getByRole("combobox");
    await userEvent.type(field, "never-visited.org");
    await expect
      .element(page.getByRole("option", { selected: true }))
      .toMatchTextContent("never-visited.org");
    watch.disconnect();
    expect(asked.filter((src) => src.includes("site-icon"))).toEqual([]);
  });
});

// The field never moves under the caret: the list hangs from it, as tall as
// its rows.
describe("the menu's list", () => {
  it("grows and shrinks below a field that stays where it is", async () => {
    await renderMenu();
    const field = page.getByRole("combobox");
    const list = page.getByRole("listbox");
    await expect.element(page.getByText("New Tab Group")).toBeVisible();
    // Once the menu has finished opening.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const top = () => field.element().getBoundingClientRect().top;
    const height = () => list.element().getBoundingClientRect().height;
    const start = { height: height(), top: top() };

    await userEvent.fill(field, "keyboard shortcuts");
    await expect
      .element(page.getByRole("option", { selected: true }))
      .toMatchTextContent("Keyboard Shortcuts");
    expect(top()).toBe(start.top);
    expect(height()).toBeLessThan(start.height);
    expect(list.element().querySelector("[class*='border-t']")).toBeNull();

    await userEvent.fill(field, "");
    await expect.element(page.getByText("New Tab Group")).toBeVisible();
    expect({ height: height(), top: top() }).toEqual(start);
  });
});
