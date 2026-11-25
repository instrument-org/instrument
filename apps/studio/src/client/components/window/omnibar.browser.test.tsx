import { renderInBrowser } from "@/tests/render-browser";
import { installWindowStubs } from "@/tests/window-stubs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { Omnibar } from "./omnibar";
import { editField } from "./omnibar-field";

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
  // A folder's live listing answers with the folder whole, then nothing more.
  const follow = (input: unknown) =>
    answer(["workspace", "computer", "list"], input).then((folder) =>
      (async function* () {
        yield { folder, kind: "snapshot" };
      })(),
    );
  const procedure = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      apply: (_target, _this, args: unknown[]) =>
        path.join(".") === "workspace.computer.live.list.call"
          ? follow(args[0])
          : pending(),
      get(_target, key) {
        if (key === "queryKey") {
          return (options?: { input?: unknown }) => [...path, options?.input];
        }
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

vi.mock("@/client/bookmarks/store", async (importOriginal) => {
  const { atom } = await import("jotai");
  return {
    ...(await importOriginal<typeof import("@/client/bookmarks/store")>()),
    bookmarksAtom: atom([
      {
        id: "radar",
        order: 1,
        title: "Weather Radar",
        url: "https://radar.example.com/",
      },
    ]),
  };
});

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

// A new tab's page already shows the bookmarks, so its field pressed with
// nothing typed lists none of them again.
describe("a new tab's field pressed with nothing typed", () => {
  it("lists nothing", async () => {
    await renderInBrowser(<Omnibar location={{ kind: "newTab" }} />);
    const field = page.getByRole("combobox");
    const box = field.element();
    if (box instanceof HTMLInputElement) {
      editField(box);
    }

    await expect.element(field).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("weather");
    await expect
      .element(page.getByRole("option", { name: /Weather Radar/ }))
      .toMatchTextContent("Weather Radarradar.example.com");
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
      .toMatchTextContent(new RegExp(`^Search the web for “${words}”↵$`));
  });

  it("is offered after a path with nothing at it", async () => {
    await renderInBrowser(<Omnibar location={{ kind: "newTab" }} />);
    await userEvent.fill(page.getByRole("combobox"), "/nowhere/x");
    await userEvent.keyboard("{Enter}");

    await expect
      .element(page.getByRole("option", { selected: true }))
      .toMatchTextContent(/^Search the web for “\/nowhere\/x”↵$/);
  });
});

// A path's names say the folder they are in, which no page's own place
// stands for, and read the same from every page.
describe("a folder's names a whole path reaches", () => {
  it.each([
    ["C:\\Users\\Public\\Documents", "DocumentsPublic"],
    ['"C:\\Users\\Public\\Documents"', "DocumentsPublic"],
    ["C:\\Users\\casey\\Doc", "Documentscasey"],
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
        total: 1,
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
    const box = field.element();
    if (box instanceof HTMLInputElement) {
      editField(box);
    }

    await expect.element(field).toHaveValue(live);
    expect(
      box instanceof HTMLInputElement && [box.selectionStart, box.selectionEnd],
    ).toEqual([0, live.length]);
    await expect.element(field).toHaveAttribute("aria-expanded", "false");
  });
});

// What the tab shows decides nothing about what words mean, so a folder, a
// file and the app's own pages read them as a site's tab does.
describe("words typed over any place", () => {
  const places = [
    ["a site", { kind: "page", url: "https://example.org/" }],
    ["a folder", { kind: "folder", path: "/Users/casey" }],
    ["a file", { kind: "file", name: "w.csv", path: "/Users/casey/w.csv" }],
    ["Settings", { kind: "builtin", part: "Providers", screen: "settings" }],
    ["Apps", { kind: "apps" }],
    ["a chat", { kind: "chat", title: "Trip to Lisbon" }],
  ] as const;

  it.each(places)("open an address from %s", async (_, location) => {
    await renderInBrowser(<Omnibar location={location} />);
    await userEvent.fill(page.getByRole("combobox"), "example.net/a");
    await expect
      .element(page.getByRole("option", { selected: true }))
      .toMatchTextContent(/example\.net\/a/);
  });

  // A page of the app's own by name is a row under the search.
  it.each(places)("search the web from %s", async (_, location) => {
    await renderInBrowser(<Omnibar location={location} />);
    await userEvent.fill(page.getByRole("combobox"), "settings");
    await expect
      .element(page.getByRole("option", { selected: true }))
      .toMatchTextContent(/^Search the web for “settings”↵$/);
    await expect
      .element(page.getByRole("option", { name: "Settings", exact: true }))
      .toBeInTheDocument();
  });
});

describe("the field with the caret brought by the keyboard", () => {
  const chat = { kind: "chat", title: "Trip to Lisbon" } as const;

  it("keeps the place on show for a caret the keyboard brought, until a letter is typed", async () => {
    await renderInBrowser(
      <Omnibar location={chat} resting={<span>Trip to Lisbon</span>} />,
    );
    const field = page.getByRole("combobox");
    field.element().focus();

    await expect.element(page.getByText("Trip to Lisbon")).toBeVisible();
    await userEvent.keyboard("l");
    await expect
      .element(page.getByText("Trip to Lisbon"))
      .not.toBeInTheDocument();
    await expect.element(field).toHaveValue("l");
  });
});
