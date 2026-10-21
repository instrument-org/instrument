import { commandMenuOpenAtom } from "@/client/atoms/command-menu";
import { renderInBrowser } from "@/tests/render-browser";
import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { CommandMenu } from "./command-menu";
import { NewTabPage } from "./new-tab-page";

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
    appTabs: { openNewTab: () => undefined },
    chats: [],
    goToPlace: () => undefined,
    newDraft: () => undefined,
    topics: [],
  }),
}));

vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({ setTheme: () => undefined, theme: "system" }),
}));

vi.mock("./context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./context")>()),
  useWindow: () => ({ openPage: opened.page, openScreen: () => undefined }),
}));

// Words pasted in arrive in one change, from the list shown before anything
// was typed straight to the rows for the whole of them. Return runs the row
// picked, so one has to be, and it is the first: what the words name.
describe("the row Return runs after a paste", () => {
  it.each([
    [
      "the command menu",
      async () => {
        const store = createStore();
        store.set(commandMenuOpenAtom, true);
        await renderInBrowser(
          <CommandMenu openPage={opened.page} openScreen={() => undefined} />,
          { store },
        );
      },
    ],
    [
      "a new tab",
      async () => {
        await renderInBrowser(<NewTabPage />);
      },
    ],
  ])("in %s is the first", async (_where, render) => {
    await render();
    const field = page.getByRole("combobox");
    await expect.element(page.getByText("Go to")).toBeVisible();

    await userEvent.fill(field, "/Users/sam/Documents");
    await expect
      .element(page.getByRole("option", { selected: true }))
      .toMatchTextContent("sam/Documents");

    // A row picked by a key stays picked while the words stay.
    await userEvent.fill(field, "");
    await expect.element(page.getByText("Go to")).toBeVisible();
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .element(page.getByRole("option", { selected: true }))
      .toMatchTextContent("Files");

    await userEvent.fill(field, "example.org");
    await expect
      .element(page.getByRole("option", { selected: true }))
      .toMatchTextContent("example.org");
    await userEvent.keyboard("{Enter}");
    expect(opened.page).toHaveBeenLastCalledWith("https://example.org/");
  });
});

describe("the row Return runs while typing", () => {
  it.each([
    [
      "the command menu",
      async () => {
        const store = createStore();
        store.set(commandMenuOpenAtom, true);
        await renderInBrowser(
          <CommandMenu openPage={opened.page} openScreen={() => undefined} />,
          { store },
        );
      },
    ],
    [
      "a new tab",
      async () => {
        await renderInBrowser(<NewTabPage />);
      },
    ],
  ])("in %s is for every letter typed", async (_where, render) => {
    await render();
    const field = page.getByRole("combobox");
    await expect.element(page.getByText("Go to")).toBeVisible();

    // Return straight after the last letter, before the rows can follow.
    await userEvent.type(field, "example.com{Enter}");
    expect(opened.page).toHaveBeenLastCalledWith("https://example.com/");
  });

  it("stays on the first row when the rows change under a resting pointer", async () => {
    await renderInBrowser(<NewTabPage />);
    await expect.element(page.getByText("Go to")).toBeVisible();
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

describe("the menu's icons", () => {
  it("asks for no icon for an address being typed", async () => {
    await renderInBrowser(<NewTabPage />);
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
