import { renderWithProviders } from "@/tests/render";
import { StoreId } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WindowContext, type WindowContextValue } from "./context";
import { GroupItem } from "./group-item";

const DOWNLOADS = "/files?path=&root=%2FUsers%2Fsam%2FDownloads";

const calls = vi.hoisted(() => ({
  openScreen: vi.fn<(href: string) => void>(),
  visitHref: vi.fn<(id: string, href: string) => void>(),
}));

// The row's field, as a press that names the Downloads folder.
vi.mock("./tab-location-row", () => ({
  TabLocationRow: ({ onVisit }: { onVisit?: (href: string) => void }) => (
    <button
      onClick={() => {
        onVisit?.(DOWNLOADS);
      }}
      type="button"
    >
      Open Downloads
    </button>
  ),
}));

vi.mock("./window-tabs", () => ({
  useWindowTabs: () => ({ visitHref: calls.visitHref }),
}));

vi.mock("./use-tab-steps", () => ({
  useTabSteps: () => ({
    canGoBack: false,
    canGoForward: false,
    go: () => undefined,
  }),
}));

vi.mock("./apps-by-slug", () => ({ useAppsBySlug: () => new Map() }));
vi.mock("./task-titles", () => ({ useTaskTitles: () => new Map() }));
vi.mock("./file-ask-button", () => ({ PageAskButton: () => null }));

const appWindow: WindowContextValue = {
  ask: vi.fn(),
  browser: null,
  focusComposer: vi.fn(),
  openPage: vi.fn(),
  openPath: vi.fn(),
  openScreen: calls.openScreen,
};

function renderPage({ atWindowLevel }: { atWindowLevel: boolean }) {
  const id = StoreId.newTabId();
  renderWithProviders(
    <WindowContext value={appWindow}>
      <GroupItem
        {...(atWindowLevel
          ? { before: { back: () => undefined, canGoBack: true } }
          : {})}
        closeTab={() => undefined}
        group="site-1"
        onPageChrome={() => undefined}
        onPageHost={() => undefined}
        up={{
          group: "site-1",
          id,
          kind: "page",
          openedAt: 0,
          url: "https://example.org/",
        }}
      />
    </WindowContext>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open Downloads" }));
  return id;
}

describe("a screen a page's field names", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A site at the window's level is the window tab's page, so the window's
  // tab goes to the screen, the way the command menu sends it: it becomes
  // that screen's tab, and back returns to the page.
  it("takes the window's tab there from a site of the window's own", () => {
    renderPage({ atWindowLevel: true });

    expect(calls.openScreen).toHaveBeenLastCalledWith(DOWNLOADS);
    expect(calls.visitHref).not.toHaveBeenCalled();
  });

  it("turns a chat's page into the screen in its place", () => {
    const id = renderPage({ atWindowLevel: false });

    expect(calls.visitHref).toHaveBeenLastCalledWith(id, DOWNLOADS);
    expect(calls.openScreen).not.toHaveBeenCalled();
  });
});
