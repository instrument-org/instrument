import { type WindowTab } from "@/client/atoms/window";
import { fileHref } from "@/shared/computer-href";
import { renderInBrowser } from "@/tests/render-browser";
import { ChatIdSchema, type LayoutTab } from "@instrument-org/workspace/client";
import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { AwarenessLine } from "./chat-tab-screens";
import { standInTabsAtom } from "./stand-in-tabs";
import { chatHref } from "./window-href";

/** A one-pixel PNG, so a site's icon loads here as it does in the app, where it comes from the main process. */
const ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

vi.mock(import("@/client/lib/favicon-url"), async (original) => ({
  ...(await original()),
  getFaviconUrl: () => ICON,
}));

const GROUP = "group:prices";

const PAGE: WindowTab = {
  group: GROUP,
  id: "tab_page",
  kind: "page",
  openedAt: 1,
  title: "Help desk software",
  url: "https://en.wikipedia.org/wiki/Help_desk_software",
};
const FILE: WindowTab = {
  group: GROUP,
  href: fileHref("/Users/mac-user/Downloads/quote.pdf"),
  id: "tab_file",
  kind: "screen",
};
const CHAT: WindowTab = {
  group: GROUP,
  href: chatHref(ChatIdSchema.parse("2026-11-13-prices")),
  id: "tab_chat",
  kind: "screen",
};

const TABS: LayoutTab[] = [
  {
    address: PAGE.kind === "page" ? PAGE.url : "",
    id: PAGE.id,
    kind: "website",
    title: "Help desk software",
  },
  {
    address: "/Users/mac-user/Downloads/quote.pdf",
    id: FILE.id,
    kind: "file",
    title: "quote.pdf",
  },
  {
    address: "instrument://chat/2026-11-13-prices",
    id: CHAT.id,
    kind: "chat",
    title: "Help desk prices",
  },
];

async function renderLine() {
  const store = createStore();
  store.set(standInTabsAtom, {
    activeByGroup: { [GROUP]: CHAT.id },
    tabs: [PAGE, FILE, CHAT],
  });
  const { container } = await renderInBrowser(<AwarenessLine tabs={TABS} />, {
    store,
  });
  const row = container.querySelector<HTMLElement>(
    '[data-slot="group-awareness"]',
  );
  if (!row) {
    throw new Error("no row");
  }
  return row;
}

describe("AwarenessLine", () => {
  it("draws a mark per tab, none of which names itself on hover", async () => {
    const row = await renderLine();
    expect(row.children).toHaveLength(3);
    expect(row.querySelectorAll("img")).toHaveLength(1);
    expect(row.hasAttribute("title")).toBe(false);
    expect(row.querySelectorAll("[title]")).toHaveLength(0);
    expect(row.querySelectorAll('[data-slot="tooltip-trigger"]')).toHaveLength(
      0,
    );
  });

  it("says what the marks are for over the list of tabs", async () => {
    const row = await renderLine();
    await userEvent.hover(row);
    await expect
      .poll(() => document.querySelector('[data-slot="group-awareness-list"]'))
      .not.toBeNull();
    const list = document.querySelector<HTMLElement>(
      '[data-slot="group-awareness-list"]',
    );
    expect(list?.firstElementChild?.textContent).toBe(
      "Messages you send here include these tabs.",
    );
    expect(
      [...(list?.children ?? [])]
        .slice(1)
        .map((each) => each.querySelector(".truncate")?.textContent),
    ).toEqual(["Help desk software", "quote.pdf", "Help desk prices"]);
    expect(list?.querySelectorAll("[title]")).toHaveLength(0);
    expect(
      list?.querySelectorAll('[data-slot="tooltip-trigger"]'),
    ).toHaveLength(0);
  });
});
