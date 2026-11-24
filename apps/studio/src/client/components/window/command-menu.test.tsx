import { pageRequestAtom } from "@/client/atoms/page-requests";
import { renderWithProviders } from "@/tests/render";
import { getDefaultStore } from "jotai";
import { installWindowStubs } from "@/tests/window-stubs";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCommandMenuRows } from "./command-menu";

// Nothing is at any path the menu looks for.
vi.mock("@/client/lib/locate-typed-path", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/client/lib/locate-typed-path")>()),
  locateTypedPath: (path: { shown: string }) =>
    Promise.resolve({ kind: "missing", path: path.shown }),
}));

vi.mock("@/client/hooks/use-developer-mode", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/client/hooks/use-developer-mode")
  >()),
  useDeveloperMode: () => true,
}));

// What a query answers, by its path; every other query stays pending.
const answers = new Map<string, unknown>();
vi.mock("@/client/rpc/client", () => {
  const pending = () => new Promise(() => undefined);
  const procedure = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      apply: pending,
      get(_target, key) {
        if (key === "queryOptions" || key === "experimental_liveOptions") {
          return () => ({
            queryFn: () =>
              answers.has(path.join("."))
                ? Promise.resolve(answers.get(path.join(".")))
                : pending(),
            queryKey: path,
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

vi.mock("@/client/components/window/shell-context", () => ({
  useShell: () => ({
    goToPlace: () => undefined,
    newGroup: () => undefined,
    newTab: () => undefined,
    projects: [],
  }),
}));

vi.mock("@/client/bookmarks/store", async (importOriginal) => {
  const { atom } = await import("jotai");
  return {
    ...(await importOriginal<typeof import("@/client/bookmarks/store")>()),
    bookmarksAtom: atom([
      { title: "Weather Radar", url: "https://radar.example.com/" },
    ]),
  };
});

vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({ setTheme: () => undefined, theme: "system" }),
}));

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(window, "electron", {
    configurable: true,
    value: { process: { platform } },
  });
}

/** Every tab Settings could have, by its title, each looked for by name. */
const SETTINGS_TITLES = [
  "General",
  "Account",
  "Providers",
  "Apps",
  "Permissions",
  "Storage",
  "History",
  "Developer",
];

/** The Settings tab the menu finds for its title, by its label. */
function SettingsTabRow({ words }: { words: string }) {
  const { rows } = useCommandMenuRows({
    active: true,
    done: (run) => run,
    openPage: () => undefined,
    openScreen: () => undefined,
    showTab: () => undefined,
    words,
  });
  return rows.map((row) =>
    row.type === "item" && row.detail === "Settings" && row.label === words ? (
      <li key={row.id}>{row.label}</li>
    ) : null,
  );
}

function SettingsTabRows() {
  return (
    <ul>
      {SETTINGS_TITLES.map((title) => (
        <SettingsTabRow key={title} words={title} />
      ))}
    </ul>
  );
}

const listed = () =>
  screen
    .queryAllByRole("listitem")
    .map((item) => item.textContent)
    .sort();

afterEach(() => {
  installWindowStubs();
  answers.clear();
});

// The tabs the menu finds are the ones the Settings sidebar lists, so none
// opens a page the sidebar would not show.
describe("Settings tabs in the command menu in developer mode", () => {
  it.each(["darwin", "win32", "linux"] as const)("on %s", (platform) => {
    setPlatform(platform);
    renderWithProviders(<SettingsTabRows />);

    expect(listed()).toEqual(
      [
        "Account",
        "Apps",
        "History",
        "Developer",
        "Permissions",
        "Providers",
        "Storage",
      ].sort(),
    );
  });
});

/** The menu's rows for words, each section's label and each row a button that runs it. */
function MenuRows({ words }: { words: string }) {
  const { rows } = useCommandMenuRows({
    active: true,
    done: (run) => run,
    openPage: () => undefined,
    openScreen: () => undefined,
    showTab: () => undefined,
    words,
  });
  return (
    <ul>
      {rows.map((row, index) =>
        row.type === "header" ? (
          <li key={`header-${index}`}>{row.label}</li>
        ) : row.type === "item" ? (
          <li key={row.id}>
            <button onClick={row.run} type="button">
              {row.label}
            </button>
          </li>
        ) : null,
      )}
    </ul>
  );
}

// What a Return on a path found is the answer to that Return alone: the
// same words typed again later are a new ask, not the old answer.
describe("a path the command menu found nothing at", () => {
  it("says so until the words change, and not when they come back", async () => {
    const { rerender } = renderWithProviders(<MenuRows words="/nowhere/x" />);
    fireEvent.click(screen.getByRole("button", { name: "/nowhere/x" }));
    expect(
      await screen.findByText("There’s nothing at “/nowhere/x”."),
    ).toBeTruthy();

    rerender(<MenuRows words="/nowhere/" />);
    rerender(<MenuRows words="/nowhere/x" />);

    expect(screen.queryByText("There’s nothing at “/nowhere/x”.")).toBeNull();
    expect(screen.getByRole("button", { name: "/nowhere/x" })).toBeTruthy();
  });
});

// Folders are the Files sidebar's, found by name; a page bookmarked is
// listed once, as a bookmark, however often it was visited.
describe("folders and bookmarks in the command menu", () => {
  it("finds the sidebar's folders by name", async () => {
    answers.set("workspace.computer.places", {
      favorites: [
        {
          kind: "output",
          name: "Instrument",
          path: "/Users/mac-user/Instrument",
        },
        {
          kind: "folder",
          name: "Documents",
          path: "/Users/mac-user/Documents",
        },
      ],
      volumes: [
        { kind: "drive", name: "Backup Disk", path: "/Volumes/Backup Disk" },
      ],
    });
    renderWithProviders(<MenuRows words="doc" />);

    expect(
      await screen.findByRole("button", { name: "Documents" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("listitem")[0]?.textContent).toBe("Documents");
    expect(screen.queryByRole("button", { name: "Backup Disk" })).toBeNull();
  });

  it("lists a bookmarked page once, over the pages visited", async () => {
    answers.set("history.live.recent", [
      {
        favicon: undefined,
        title: "Weather Radar",
        url: "https://radar.example.com/",
      },
      {
        favicon: undefined,
        title: "Weather Today",
        url: "https://today.example.com/",
      },
    ]);
    renderWithProviders(<MenuRows words="weather" />);

    await screen.findByRole("button", { name: "Weather Today" });
    expect(screen.getAllByRole("listitem").map((item) => item.textContent))
      .toMatchInlineSnapshot(`
        [
          "Weather Radar",
          "Pages",
          "Weather Today",
          "Search the web for “weather”",
        ]
      `);
  });
});

describe("the command menu with nothing typed", () => {
  it("lists what was used last, then a few commands", async () => {
    answers.set("history.live.recent", [
      {
        at: 1,
        favicon: undefined,
        title: "Weather Today",
        url: "https://today.example.com/",
      },
    ]);
    renderWithProviders(<MenuRows words="" />);

    await screen.findByRole("button", { name: "Weather Today" });
    expect(screen.getAllByRole("listitem").map((item) => item.textContent))
      .toMatchInlineSnapshot(`
      [
        "Recent",
        "Weather Today",
        "Commands",
        "New tab group",
        "New tab",
        "Settings",
      ]
    `);
  });
});

// A built-in page the menu lists opens as every command opens one
// (`BuiltInPageOpener`): a new tab after the tab up, or the tab already
// showing it brought forward, never in place of the tab up.
describe("built-in pages in the command menu", () => {
  it.each([
    ["History", "/activity"],
    ["What's new", "/release-notes"],
    ["Extensions", "/extensions"],
  ])("asks for %s as a built-in page", (label, href) => {
    const openScreen = vi.fn();
    function Rows() {
      const { rows } = useCommandMenuRows({
        active: true,
        done: (run) => run,
        openPage: () => undefined,
        openScreen,
        showTab: () => undefined,
        words: label.toLowerCase(),
      });
      const row = rows.find(
        (each) => each.type === "item" && each.label === label,
      );
      return row?.type === "item" ? (
        <button onClick={row.run} type="button">
          {row.label}
        </button>
      ) : null;
    }
    renderWithProviders(<Rows />);
    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(getDefaultStore().get(pageRequestAtom)).toEqual({ href });
    expect(openScreen).not.toHaveBeenCalled();
    getDefaultStore().set(pageRequestAtom, null);
  });
});
