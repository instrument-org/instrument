import { type HistoryPage } from "@/client/hooks/use-browser-history";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VisitedPageRows } from "./visited-page-rows";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));
vi.mock("@/client/components/favicon", () => ({ PageFavicon: () => null }));
vi.mock("./page-menu", () => ({
  PageContextMenu: ({ children }: { children: React.ReactNode }) => children,
  usePageClicks: () => (url: string, onOpen: (url: string) => void) => ({
    onClick: () => {
      onOpen(url);
    },
  }),
}));
vi.mock("./page-tooltip", () => ({
  PageTooltip: ({ children }: { children: React.ReactNode }) => children,
}));

const page: HistoryPage = {
  at: Date.now(),
  title: "Example",
  typedCount: 0,
  url: "https://example.com/",
  visitCount: 1,
};

describe("VisitedPageRows", () => {
  it.each([false, true])(
    "drags a row out as its page's link (compact: %s)",
    (isCompact) => {
      const onOpen = vi.fn();
      render(
        <VisitedPageRows
          isCompact={isCompact}
          onOpen={onOpen}
          visits={[{ page }]}
        />,
      );
      const row = screen.getByRole("button");
      expect(row.getAttribute("draggable")).toBe("true");
      const data = new Map<string, string>();
      fireEvent.dragStart(row, {
        dataTransfer: {
          clearData: () => {
            data.clear();
          },
          setData: (type: string, value: string) => {
            data.set(type, value);
          },
          setDragImage: vi.fn(),
        },
      });
      expect(data.get("text/uri-list")).toBe("https://example.com/");
      fireEvent.click(row);
      expect(onOpen).toHaveBeenCalledWith("https://example.com/");
    },
  );
});
