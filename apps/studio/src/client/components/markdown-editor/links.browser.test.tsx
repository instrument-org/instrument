import {
  closeMarkdownEditors,
  openMarkdownEditor,
} from "@/tests/markdown-editor";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

// See openMarkdownEditor; the links plugin also asks which linked files are
// missing, which is none of them unless a test names the files that are there.
const disk = vi.hoisted(() => ({ files: null as null | Set<string> }));
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    files: {
      missing: {
        call: ({ paths }: { paths: string[] }) =>
          Promise.resolve({
            missing: paths.filter((path) => disk.files?.has(path) === false),
          }),
      },
    },
  },
}));

afterEach(() => {
  disk.files = null;
});

afterEach(closeMarkdownEditors);

/** Whether the next click anywhere in the page was kept from its default. */
function nextClickPrevented() {
  const seen = { prevented: false };
  window.addEventListener(
    "click",
    (e) => {
      seen.prevented = e.defaultPrevented;
    },
    { once: true },
  );
  return seen;
}

const CASES = [
  ["plan.md", { kind: "path", path: "/plan.md" }],
  [
    "instrument://chat/2026-09-16-ascii-dog-generation",
    { href: "/chats/2026-09-16-ascii-dog-generation", kind: "screen" },
  ],
] as const;

it.each(CASES)(
  "clicking %s in the link tooltip opens what it names in the app",
  async (href, target) => {
    const onOpenLink = vi.fn();
    const view = await openMarkdownEditor(`See [the plan](${href}) here.\n`, {
      onOpenLink,
    });
    // The preview shows on hover, and only while the editor has focus.
    view.focus();
    await userEvent.hover(view.dom.querySelector("a") ?? view.dom);
    const address = await vi.waitUntil(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          ".milkdown-link-preview[data-show='true'] a.link-display",
        ),
      ].find((a) => a.textContent),
    );
    const click = nextClickPrevented();

    await userEvent.click(address);

    expect(click.prevented).toBe(true);
    expect(onOpenLink).toHaveBeenCalledExactlyOnceWith(target, false);
  },
);

it.each(CASES)(
  "Cmd-clicking %s in the text opens what it names in the app",
  async (href, target) => {
    const onOpenLink = vi.fn();
    const view = await openMarkdownEditor(`See [the plan](${href}) here.\n`, {
      onOpenLink,
    });
    const click = nextClickPrevented();

    // The window stubs pin the platform to macOS, so the command key is Meta
    // whatever host runs the suite; ControlOrMeta would send Control on Linux.
    await userEvent.click(view.dom.querySelector("a") ?? view.dom, {
      modifiers: ["Meta"],
    });

    expect(click.prevented).toBe(true);
    expect(onOpenLink).toHaveBeenCalledExactlyOnceWith(target, false);
  },
);

it("draws a link into the app as a chip with its kind's glyph, and a web link as text", async () => {
  const view = await openMarkdownEditor(
    "[the dog](instrument://chat/ascii-dog) and [a site](https://example.com)\n",
  );
  const [chat, site] = view.dom.querySelectorAll("a");

  expect(chat?.querySelector(".md-app-chip-icon")).not.toBeNull();
  expect(chat?.textContent).toBe("the dog");
  expect(getComputedStyle(chat ?? view.dom).textDecorationLine).toBe("none");
  expect(site?.querySelector(".md-app-chip-icon")).toBeNull();
  expect(view.state.doc.textContent).toBe("the dog and a site");
});

it("puts the site's icon in front of a web link, and none in front of a file's", async () => {
  const view = await openMarkdownEditor(
    "[a site](https://example.com/page) and [a file](plan.md)\n",
  );
  const [site, file] = view.dom.querySelectorAll("a");

  expect(site?.querySelector("img.md-site-icon")?.getAttribute("src")).toMatch(
    /site-icon\/example\.com$/,
  );
  expect(file?.querySelector("img")).toBeNull();
  expect(view.state.doc.textContent).toBe("a site and a file");
});

it("finds a link rooted at `/` under a folder above the file, as a repository's own docs write them", async () => {
  disk.files = new Set(["/repo/apps/main.ts"]);
  const onOpenLink = vi.fn();
  const view = await openMarkdownEditor(
    "[there](/apps/main.ts#L4) and [gone](/apps/gone.ts)\n",
    { hostPath: "/repo/docs/notes.md", onOpenLink },
  );
  const [there, gone] = view.dom.querySelectorAll("a");
  await vi.waitUntil(() => gone?.querySelector(".md-link-broken"));

  expect(there?.querySelector(".md-link-broken")).toBeNull();

  await userEvent.click(there ?? view.dom, { modifiers: ["Meta"] });

  expect(onOpenLink).toHaveBeenCalledExactlyOnceWith(
    { kind: "path", path: "/repo/apps/main.ts" },
    false,
  );
});
