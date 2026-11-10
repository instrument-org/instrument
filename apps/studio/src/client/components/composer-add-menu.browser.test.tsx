// Where this menu lands is a measured claim about two boxes -- the plus and the
// menu standing on it -- and jsdom has no layout to measure, so an assertion
// there would only be reading back the props. The zoom cases matter for the same
// reason twice over: the rects Radix positions against are on-screen px while the
// menu is laid out in its own, and only a real browser tells those apart.
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip";
import { createStore } from "jotai";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

// Relative, not `@/tests/render-browser`: oxlint's type-aware pass does not
// resolve the alias to this module and every access downstream then reads as an
// error type.
import { renderInBrowser } from "../../tests/render-browser";
import { zoomAtom } from "../atoms/zoom";
import { ComposerAddMenu, type ComposerMenuView } from "./composer-add-menu";

const noop = () => {
  // These tests assert on where the menu sits, not on what it chooses.
};

// The gap between the plus and the menu over it.
const GAP = 6;
// The menu's own width (`w-72`), whatever the composer's.
const MENU_WIDTH = 288;

function Composer({ top }: { top: number }) {
  return (
    <div style={{ marginTop: top, padding: 16, width: 480 }}>
      <ComposerAddMenu
        actions={[
          {
            icon: PaperclipIcon,
            id: "add-files",
            label: "Add files",
            onSelect: noop,
          },
        ]}
        onReturnFocus={noop}
        onSelectSkill={noop}
        onViewChange={noop}
        skills={[]}
        view="root"
      />
    </div>
  );
}

const box = (selector: string) => {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) {
    throw new Error(`${selector} is not mounted`);
  }
  return found.getBoundingClientRect();
};

const menuBox = () => box('[data-slot="dropdown-menu-content"]');
const plusBox = () => box('[aria-label="Add to this prompt"]');

// floating-ui rounds what it places onto the device pixel grid, so a number
// asked for in layout px lands within half a device px of it. Anything the
// placement gets wrong is out by whole px.
const ROUNDING = 0.5;
const offBy = (actual: number, expected: number) => Math.abs(actual - expected);

describe("ComposerAddMenu in a browser", () => {
  // The menu is open from the first render, so every wait here is on floating-ui
  // settling rather than on anything the user does.
  it("stands over the plus, its left edge on the plus's, at its own width", async () => {
    await renderInBrowser(<Composer top={400} />);

    await vi.waitFor(() => {
      const plus = plusBox();
      const menu = menuBox();
      expect(offBy(menu.width, MENU_WIDTH)).toBeLessThanOrEqual(ROUNDING);
      expect(offBy(menu.left, plus.left)).toBeLessThanOrEqual(ROUNDING);
      expect(offBy(plus.top - menu.bottom, GAP)).toBeLessThanOrEqual(ROUNDING);
    });
  });

  // Zoom is where this goes wrong quietly: the menu is portalled out of the
  // zoomed tree and re-applies zoom to itself, so a width or a gap handed to
  // Radix in the wrong one of the two spaces still looks right at 1x.
  it.each([1.5, 0.75])(
    "holds the gap and the width at %sx zoom",
    async (zoom) => {
      const store = createStore();
      store.set(zoomAtom, zoom);
      await renderInBrowser(
        <div style={{ zoom }}>
          <Composer top={400} />
        </div>,
        { store },
      );

      await vi.waitFor(() => {
        const plus = plusBox();
        const menu = menuBox();
        expect(offBy(menu.width, MENU_WIDTH * zoom)).toBeLessThanOrEqual(
          ROUNDING,
        );
        expect(offBy(menu.left, plus.left)).toBeLessThanOrEqual(ROUNDING);
        expect(offBy(plus.top - menu.bottom, GAP * zoom)).toBeLessThanOrEqual(
          ROUNDING,
        );
      });
    },
  );
});

describe("a chat's plus", () => {
  function ChatPlus(places: {
    onNameApp: (slug: string) => void;
    onOpenApps: () => void;
    onOpenWeb: () => void;
  }) {
    const [view, setView] = useState<ComposerMenuView | null>(null);
    return (
      <ComposerAddMenu
        actions={[
          {
            icon: PaperclipIcon,
            id: "add-files",
            label: "Attach files",
            onSelect: noop,
          },
          {
            icon: PaperclipIcon,
            id: "work-in-folder",
            label: "Add a folder",
            onSelect: noop,
          },
        ]}
        onReturnFocus={noop}
        onSelectSkill={noop}
        onViewChange={setView}
        places={{
          apps: [{ name: "Gmail", slug: "gmail" }],
          computerName: "This Mac",
          onNameApp: (app) => {
            places.onNameApp(app.slug);
          },
          onOpenApps: places.onOpenApps,
          onOpenComputer: noop,
          onOpenWeb: places.onOpenWeb,
        }}
        skills={[
          {
            aliases: [],
            description: "Turns notes into a page",
            id: "instrument:create-page",
            name: "create-page",
            path: "/skills/create-page",
            qualifiedName: "create-page",
            source: "instrument",
            title: "Create page",
          },
        ]}
        view={view}
      />
    );
  }

  const open = () =>
    userEvent.click(page.getByRole("button", { name: "Add to this prompt" }));

  it("lists what it opens beside the chat, then attaching, then the apps and skills behind rows", async () => {
    const onOpenWeb = vi.fn();
    await renderInBrowser(
      <ChatPlus onNameApp={noop} onOpenApps={noop} onOpenWeb={onOpenWeb} />,
    );
    await open();
    const items = page.getByRole("menuitem").elements();
    expect(items.map((item) => item.textContent.trim())).toMatchInlineSnapshot(`
      [
        "Browser",
        "This Mac",
        "Attach files",
        "Add a folder",
        "Apps",
        "Skills",
      ]
    `);
    await userEvent.click(page.getByRole("menuitem", { name: "Browser" }));
    expect(onOpenWeb).toHaveBeenCalledOnce();
  });

  it("names a connected app from Apps, or goes to connect another", async () => {
    const onNameApp = vi.fn();
    const onOpenApps = vi.fn();
    await renderInBrowser(
      <ChatPlus
        onNameApp={onNameApp}
        onOpenApps={onOpenApps}
        onOpenWeb={noop}
      />,
    );
    await open();
    await userEvent.click(page.getByRole("menuitem", { name: "Apps" }));
    await userEvent.click(
      page.getByRole("menuitem", { exact: false, name: "Gmail" }),
    );
    expect(onNameApp).toHaveBeenCalledWith("gmail");
    await open();
    await userEvent.click(page.getByRole("menuitem", { name: "Apps" }));
    await userEvent.click(
      page.getByRole("menuitem", { name: "Connect an app…" }),
    );
    expect(onOpenApps).toHaveBeenCalledOnce();
  });

  it("opens Apps and Skills as plain rows, with no submenu arrow", async () => {
    await renderInBrowser(
      <ChatPlus onNameApp={noop} onOpenApps={noop} onOpenWeb={noop} />,
    );
    await open();
    const icons = (name: string) =>
      page.getByRole("menuitem", { name }).element().querySelectorAll("svg")
        .length;

    expect([icons("Apps"), icons("Skills")]).toEqual([1, 1]);
  });

  it("cuts a long skill name short to keep where it came from in the menu", async () => {
    const name = "summarize-every-meeting-transcript-in-the-shared-folder";
    function LongSkill() {
      const [view, setView] = useState<ComposerMenuView | null>("skills");
      return (
        <ComposerAddMenu
          actions={[]}
          onReturnFocus={noop}
          onSelectSkill={noop}
          onViewChange={setView}
          places={{
            apps: [],
            computerName: "This Mac",
            onNameApp: noop,
            onOpenApps: noop,
            onOpenComputer: noop,
            onOpenWeb: noop,
          }}
          skills={[
            {
              aliases: [],
              description: "Summarizes meetings",
              id: `workspace:${name}`,
              name,
              path: `/skills/${name}`,
              qualifiedName: name,
              source: "workspace",
              title: "Summarize",
            },
          ]}
          view={view}
        />
      );
    }
    // A view set opens the menu on it, as the composer does.
    await renderInBrowser(<LongSkill />);
    const source = page.getByText("Your workspace").element();

    expect(source.getBoundingClientRect().right).toBeLessThanOrEqual(
      menuBox().right,
    );
  });
});
