import { typedPathOf } from "@/client/lib/typed-path";
import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { useCommandMenuRows } from "./command-menu";
import { boxOpens } from "./new-tab-box";
import { Omnibar } from "./omnibar";

/** What a surface opened, in the order it opened it. */
const opened = vi.hoisted((): string[] => []);

const HISTORY = [
  {
    at: 2,
    favicon: undefined,
    title: "Pull requests",
    url: "https://github.com/acme/app/pulls",
  },
];

// History answers with one page on github.com; every other query stays pending.
vi.mock("@/client/rpc/client", () => {
  const pending = () => new Promise(() => undefined);
  const answer = (path: string[]) =>
    path.join(".") === "history.live.recent" ||
    path.join(".") === "history.live.completions"
      ? Promise.resolve(HISTORY)
      : pending();
  const procedure = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      apply: pending,
      get(_target, key) {
        if (key === "queryKey") {
          return (options?: { input?: unknown }) => [...path, options?.input];
        }
        if (key === "queryOptions" || key === "experimental_liveOptions") {
          return (options?: { input?: unknown }) => ({
            queryFn: () => answer(path),
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

// A path is looked for and nothing is there, so the look itself is what a
// surface did with the words.
vi.mock("@/client/lib/locate-typed-path", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/client/lib/locate-typed-path")>()),
  locateTypedPath: (path: { shown: string }) => {
    opened.push(`path ${path.shown}`);
    return Promise.resolve({ kind: "missing", path: path.shown });
  },
}));

vi.mock("@/client/components/window/shell-context", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/client/components/window/shell-context")
  >()),
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

vi.mock("./context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./context")>()),
  useWindow: () => ({
    openPage: (url: string) => {
      opened.push(`page ${url}`);
    },
    openScreen: (href: string) => {
      opened.push(`screen ${href}`);
    },
  }),
}));

/** What was opened since the last ask, or that nothing was. */
function taken() {
  const did = opened.join(", ") || "nothing";
  opened.length = 0;
  return did;
}

// A site's icon is asked of the icon service by the site's host; a file's
// address shows its type and asks nobody.
vi.mock("@/client/components/favicon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/client/components/favicon")>()),
  PageFavicon: ({ url }: { url: string }) =>
    /^file:/i.test(url) ? null : <i data-site-icon={url} />,
}));

/** Whether a row draws a site's own icon. */
const asksForIcon = (row: Element | null) =>
  row?.querySelector("[data-site-icon]") ? "site icon" : "no site icon";

function Menu({ words }: { words: string }) {
  const { rows } = useCommandMenuRows({
    active: true,
    closeGroups: () => undefined,
    done: (run) => run,
    openPage: (url) => {
      opened.push(`page ${url}`);
    },
    openScreen: (href) => {
      opened.push(`screen ${href}`);
    },
    showTab: () => undefined,
    words,
  });
  return (
    <ul aria-label={`menu for ${words}`}>
      {rows.map((row) =>
        row.type === "item" ? (
          <li key={row.id}>
            <button onClick={row.run} type="button">
              {row.icon}
              {[row.label, row.detail].filter(Boolean).join(" · ")}
            </button>
          </li>
        ) : null,
      )}
    </ul>
  );
}

/**
 * What a surface shows once it has stopped changing: its rows follow the
 * words, and history, a beat behind.
 */
async function settled(read: () => string) {
  let last = read();
  for (let quiet = 0; quiet < 3;) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    const now = read();
    quiet = now === last ? quiet + 1 : 0;
    last = now;
  }
}

/** The command menu's first row for the words, whether it also offers a web search, and what Return does. */
async function menuFor(words: string) {
  const screen = await renderInBrowser(<Menu words={words} />);
  const list = page.getByRole("list", { name: `menu for ${words}` });
  await expect.element(list).toBeInTheDocument();
  await settled(() => list.element().innerHTML);
  const rows = [...list.element().querySelectorAll("button")];
  const first = rows[0];
  const said =
    first === undefined
      ? "no row"
      : `“${first.textContent}” (${asksForIcon(first)})`;
  const search = rows.some((row) =>
    row.textContent.startsWith("Search the web"),
  )
    ? ", web search offered"
    : "";
  first?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const did = taken();
  await screen.unmount();
  return `${said}${search}; Return: ${did}`;
}

/** The address field's first row for the words, and what Return does. */
async function fieldFor(words: string) {
  const screen = await renderInBrowser(
    <Omnibar
      location={{ kind: "newTab" }}
      onSite={(url) => {
        opened.push(`page ${url}`);
      }}
      onVisit={(href) => {
        opened.push(`screen ${href}`);
      }}
    />,
  );
  await userEvent.fill(page.getByRole("combobox"), words);
  const picked = page.getByRole("option", { selected: true });
  await expect.element(picked).toBeInTheDocument();
  await settled(() => picked.element().parentElement?.innerHTML ?? "");
  const row = picked.element();
  // The row less the key it is marked with.
  const said = `“${row.textContent.replace(/↵$/, "")}” (${asksForIcon(row)})`;
  const search =
    page
      .getByRole("option")
      .elements()
      .slice(1)
      .some((each) => each.textContent.startsWith("Search the web")) &&
    !row.textContent.startsWith("Search the web")
      ? ", web search offered"
      : "";
  await userEvent.keyboard("{Enter}");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const did = taken();
  await screen.unmount();
  return `${said}${search}; Return: ${did}`;
}

/** What Return does with the words in a new tab's box, which shows no row for them. */
function boxFor(words: string) {
  const opens = boxOpens({ path: typedPathOf(words, "darwin"), words });
  if (opens === undefined) {
    return "Return: sends a message";
  }
  if (opens.kind === "path") {
    return `Return: path ${opens.path.shown}`;
  }
  if (opens.kind === "site") {
    return `Return: page ${opens.url}`;
  }
  return opens.address.kind === "page"
    ? `Return: page ${opens.address.url}`
    : `Return: app ${opens.address.address}`;
}

const WORDS = [
  "https://example.com/a",
  "example.com",
  "instrument://chat/x",
  "instrument://settings/general",
  "localhost:3000",
  "myserver:8080",
  "127.0.0.1:3000",
  "foo.localhost",
  "node.js",
  "foo.zzzzz",
  "ftp://example.com",
  "chrome://extensions",
  "/tmp",
  "/Users",
  "/Applications",
  "git",
  "github.com",
];

// The same words typed into the command menu, a tab's address field and a
// new tab's box: what the menu and the field say they are and whether they
// ask for a site's icon, and what Return does with them in each. The window has been to github.com and
// nowhere else.
describe("typed words across the menu, the field and the box", () => {
  it("are read the same way by each", async () => {
    const table: string[] = [];
    for (const words of WORDS) {
      table.push(
        words,
        `  menu:  ${await menuFor(words)}`,
        `  field: ${await fieldFor(words)}`,
        `  box:   ${boxFor(words)}`,
      );
    }
    expect(`\n${table.join("\n")}\n`).toMatchInlineSnapshot(`
      "
      https://example.com/a
        menu:  “Go to example.com/a” (no site icon); Return: page https://example.com/a
        field: “Go to example.com/a” (no site icon); Return: page https://example.com/a
        box:   Return: page https://example.com/a
      example.com
        menu:  “Go to example.com” (no site icon); Return: page https://example.com/
        field: “Go to example.com” (no site icon); Return: page https://example.com/
        box:   Return: page https://example.com/
      instrument://chat/x
        menu:  “Go to Chat” (no site icon); Return: screen /chats/x
        field: “Go to Chat” (no site icon); Return: screen /chats/x
        box:   Return: app instrument://chat/x
      instrument://settings/general
        menu:  “Go to Settings” (no site icon); Return: screen /settings/general
        field: “Go to Settings” (no site icon); Return: screen /settings/general
        box:   Return: app instrument://settings/general
      localhost:3000
        menu:  “Go to localhost:3000” (no site icon); Return: page http://localhost:3000/
        field: “Go to localhost:3000” (no site icon); Return: page http://localhost:3000/
        box:   Return: page http://localhost:3000/
      myserver:8080
        menu:  “Go to myserver:8080” (no site icon); Return: page https://myserver:8080/
        field: “Go to myserver:8080” (no site icon); Return: page https://myserver:8080/
        box:   Return: page https://myserver:8080/
      127.0.0.1:3000
        menu:  “Go to 127.0.0.1:3000” (no site icon); Return: page http://127.0.0.1:3000/
        field: “Go to 127.0.0.1:3000” (no site icon); Return: page http://127.0.0.1:3000/
        box:   Return: page http://127.0.0.1:3000/
      foo.localhost
        menu:  “Go to foo.localhost” (no site icon); Return: page http://foo.localhost/
        field: “Go to foo.localhost” (no site icon); Return: page http://foo.localhost/
        box:   Return: page http://foo.localhost/
      node.js
        menu:  “Go to node.js” (no site icon), web search offered; Return: page https://node.js/
        field: “Go to node.js” (no site icon), web search offered; Return: page https://node.js/
        box:   Return: sends a message
      foo.zzzzz
        menu:  “Go to foo.zzzzz” (no site icon), web search offered; Return: page https://foo.zzzzz/
        field: “Go to foo.zzzzz” (no site icon), web search offered; Return: page https://foo.zzzzz/
        box:   Return: sends a message
      ftp://example.com
        menu:  “Go to ftp://example.com” (no site icon); Return: page ftp://example.com/
        field: “Go to ftp://example.com” (no site icon); Return: page ftp://example.com/
        box:   Return: sends a message
      chrome://extensions
        menu:  “Go to chrome://extensions” (no site icon); Return: page chrome://extensions/
        field: “Go to chrome://extensions” (no site icon); Return: page chrome://extensions/
        box:   Return: sends a message
      /tmp
        menu:  “/tmp” (no site icon); Return: path /tmp
        field: “/tmp” (no site icon); Return: path /tmp
        box:   Return: path /tmp
      /Users
        menu:  “/Users” (no site icon); Return: path /Users
        field: “/Users” (no site icon); Return: path /Users
        box:   Return: path /Users
      /Applications
        menu:  “/Applications” (no site icon); Return: path /Applications
        field: “/Applications” (no site icon); Return: path /Applications
        box:   Return: path /Applications
      git
        menu:  “Pull requests · github.com” (site icon), web search offered; Return: page https://github.com/acme/app/pulls
        field: “Go to github.com” (site icon); Return: page https://github.com/
        box:   Return: sends a message
      github.com
        menu:  “Go to github.com” (site icon); Return: page https://github.com/
        field: “Go to github.com” (site icon); Return: page https://github.com/
        box:   Return: page https://github.com/
      "
    `);
  });
});
