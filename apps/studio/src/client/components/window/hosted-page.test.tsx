import { StoreId } from "@instrument-org/workspace/client";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useHostedPage } from "./hosted-page";

const FILE_URL = "file:///Users/mac-user/site/index.html";
const GROUP = "page:files";

const window_ = vi.hoisted(() => ({
  close: vi.fn<(id: string) => void>(),
  tabs: [] as { group?: string; id: string; kind: string; url?: string }[],
}));

vi.mock("@/client/lib/browser-pool", () => ({
  getGuest: () => null,
  goGuest: () => false,
  onPageThumb: () => () => undefined,
}));
vi.mock("./page-hosts", () => ({ usePageHost: () => undefined }));
vi.mock("./context", () => ({
  useWindow: () => ({
    browser: { navigateTab: vi.fn(), openOrFocus: vi.fn() },
  }),
}));
vi.mock("./window-tabs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./window-tabs")>()),
  useWindowTabs: () => ({ allTabs: window_.tabs, close: window_.close }),
}));

function Viewer() {
  useHostedPage({
    group: GROUP,
    host: { chrome: false, isActive: true },
    url: FILE_URL,
  });
  return null;
}

describe("useHostedPage", () => {
  beforeEach(() => {
    window_.close.mockClear();
    window_.tabs = [
      { group: GROUP, id: StoreId.newTabId(), kind: "page", url: FILE_URL },
    ];
  });

  it("closes the page once its viewer goes", async () => {
    const { unmount } = render(<Viewer />);
    unmount();
    await Promise.resolve();
    expect(window_.close).toHaveBeenCalledTimes(1);
  });

  // A file tab's screen drawn afresh (its router made again) puts its viewer
  // away and back in one commit, and the page stays with the new one.
  it("keeps the page for a viewer drawn afresh in one commit", async () => {
    const { rerender } = render(<Viewer key="before" />);
    rerender(<Viewer key="after" />);
    await Promise.resolve();
    expect(window_.close).not.toHaveBeenCalled();
  });
});
