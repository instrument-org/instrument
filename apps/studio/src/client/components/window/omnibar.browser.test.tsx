import { renderInBrowser } from "@/tests/render-browser";
import { installWindowStubs } from "@/tests/window-stubs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { Omnibar } from "./omnibar";

/** What each folder's listing answers, by its path; every other query stays pending. */
const listings = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/client/rpc/client", () => {
  const pending = () => new Promise(() => undefined);
  const answer = (path: string[], input: unknown) => {
    const folder =
      path.join(".") === "workspace.computer.list" &&
      typeof input === "object" &&
      input !== null &&
      "path" in input &&
      typeof input.path === "string"
        ? input.path
        : undefined;
    return folder !== undefined && listings.has(folder)
      ? Promise.resolve(listings.get(folder))
      : pending();
  };
  const procedure = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      apply: pending,
      get(_target, key) {
        if (key === "queryOptions" || key === "experimental_liveOptions") {
          return (options?: { input?: unknown }) => ({
            queryFn: () => answer(path, options?.input),
            queryKey: [...path, options?.input],
          });
        }
        if (key === "mutationOptions") {
          return (options: object) => ({ mutationFn: pending, ...options });
        }
        return typeof key === "string" ? procedure([...path, key]) : undefined;
      },
    });
  return { rpcClient: procedure([]) };
});

// Nothing is at any path the field looks for.
vi.mock("@/client/lib/locate-typed-path", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/client/lib/locate-typed-path")>()),
  locateTypedPath: (path: { shown: string }) =>
    Promise.resolve({ kind: "missing", path: path.shown }),
}));

vi.mock("./context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./context")>()),
  useWindow: () => ({ openPage: () => undefined }),
}));

afterEach(() => {
  listings.clear();
  installWindowStubs();
});

// What a Return on a path found is the answer to that Return alone: the
// same words typed again later are a new ask, not the old answer.
describe("a path the field found nothing at", () => {
  it("says so until the words change, and not when they come back", async () => {
    await renderInBrowser(<Omnibar location={{ kind: "newTab" }} />);
    const field = page.getByRole("combobox");
    const notice = page.getByText("There’s nothing at “/nowhere/x”.");

    await userEvent.fill(field, "/nowhere/x");
    await userEvent.keyboard("{Enter}");
    await expect.element(notice).toBeVisible();

    await userEvent.fill(field, "/nowhere/");
    await expect.element(notice).not.toBeInTheDocument();
    await userEvent.fill(field, "/nowhere/x");
    await expect
      .element(page.getByRole("option", { selected: true }))
      .toMatchTextContent("/nowhere/x");
    await expect.element(notice).not.toBeInTheDocument();
  });
});

// The same row the command menu and a new tab offer, in the same words.
describe("words the field searches the web for", () => {
  it.each([
    [{ kind: "newTab" } as const, "rust borrow checker"],
    [{ kind: "page", url: "https://example.org/" } as const, "rust borrow"],
  ])("are offered as a web search on %o", async (location, words) => {
    await renderInBrowser(<Omnibar location={location} />);

    await userEvent.fill(page.getByRole("combobox"), words);

    await expect
      .element(page.getByRole("option", { selected: true }))
      .toMatchTextContent(new RegExp(`^Search the web for “${words}”$`));
  });

  it("is offered after a path with nothing at it", async () => {
    await renderInBrowser(<Omnibar location={{ kind: "newTab" }} />);
    await userEvent.fill(page.getByRole("combobox"), "/nowhere/x");
    await userEvent.keyboard("{Enter}");

    await expect
      .element(page.getByRole("option", { selected: true }))
      .toMatchTextContent(/^Search the web for “\/nowhere\/x”$/);
  });
});

// Typed over home in Files, a whole path's names are in some other folder,
// where a name home has too (Documents) would read as home's own.
describe("a folder's names a whole path reaches", () => {
  it.each([
    ["C:\\Users\\Public\\Documents", "DocumentsC:\\Users\\Public"],
    ['"C:\\Users\\Public\\Documents"', "DocumentsC:\\Users\\Public"],
    // In the folder on screen, a name says enough on its own.
    ["C:\\Users\\casey\\Doc", /^Documents$/],
  ])("say where they are for %s", async (typed, row) => {
    Object.defineProperty(window, "electron", {
      configurable: true,
      value: { process: { platform: "win32" } },
    });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { homeDir: "C:\\Users\\casey" },
    });
    for (const folder of ["C:\\Users\\Public", "C:\\Users\\casey"]) {
      listings.set(folder, {
        entries: [
          {
            kind: "folder",
            name: "Documents",
            path: `${folder}\\Documents`,
          },
        ],
        kind: "listing",
        path: folder,
        truncated: false,
      });
    }
    await renderInBrowser(
      <Omnibar location={{ kind: "folder", path: "C:\\Users\\casey" }} />,
    );

    await userEvent.fill(page.getByRole("combobox"), typed);

    await expect
      .element(page.getByRole("option", { selected: true }))
      .toMatchTextContent(row);
  });
});

// Pressed, the field holds what a browser would show for the page as it
// stands now, so what is copied from it opens there; that address is the
// place, not words typed, so it asks for nothing.
describe("a page's file pressed into", () => {
  it("holds the page's address as it stands, selected whole", async () => {
    const shown = "file:///Users/casey/w.html";
    const live = `${shown}?frame=2`;
    await renderInBrowser(
      <Omnibar
        initial={shown}
        liveAddress={() => live}
        location={{
          asPage: true,
          kind: "file",
          name: "w.html",
          path: "/Users/casey/w.html",
        }}
        resting={<span>w.html</span>}
      />,
    );
    const field = page.getByRole("combobox");
    // Out of the pointer's way while the place rests over it; the row hands
    // it the caret on a press, as here.
    field.element().focus();

    await expect.element(field).toHaveValue(live);
    const box = field.element();
    expect(
      box instanceof HTMLInputElement && [box.selectionStart, box.selectionEnd],
    ).toEqual([0, live.length]);
    await expect.element(field).toHaveAttribute("aria-expanded", "false");
  });
});
