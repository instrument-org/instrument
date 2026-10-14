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
      .toHaveTextContent("sam/Documents");

    // A row picked by a key stays picked while the words stay.
    await userEvent.fill(field, "");
    await expect.element(page.getByText("Go to")).toBeVisible();
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .element(page.getByRole("option", { selected: true }))
      .toHaveTextContent("Files");

    await userEvent.fill(field, "example.org");
    await expect
      .element(page.getByRole("option", { selected: true }))
      .toHaveTextContent("example.org");
    await userEvent.keyboard("{Enter}");
    expect(opened.page).toHaveBeenLastCalledWith("https://example.org/");
  });
});
