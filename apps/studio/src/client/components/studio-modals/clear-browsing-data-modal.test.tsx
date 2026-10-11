import { openClearBrowsingData } from "@/client/atoms/clear-browsing-data-modal";
import { ClearBrowsingDataModal } from "@/client/components/studio-modals/clear-browsing-data-modal";
import { renderWithDefaultStore } from "@/tests/render";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { toast } from "@/client/lib/toast";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { clearHistory, clearSiteData } = vi.hoisted(() => ({
  clearHistory: vi.fn<(input: { since?: number }) => Promise<unknown>>(),
  clearSiteData: vi.fn(),
}));

vi.mock("@/client/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    browsingData: {
      clear: { call: clearSiteData },
      summary: {
        queryOptions: () => ({
          queryFn: () => ({
            cacheBytes: 12_000_000,
            cookieSites: ["google.com", "github.com"],
          }),
          queryKey: ["browsingData.summary"],
        }),
      },
    },
    history: {
      clear: { call: clearHistory },
      summary: {
        queryOptions: ({ input }: { input: { since?: number } }) => ({
          queryFn: () => ({ count: 5, hosts: ["github.com", "x.com"] }),
          queryKey: ["history.summary", input.since],
        }),
      },
    },
  },
}));

async function open() {
  renderWithDefaultStore(<ClearBrowsingDataModal />);
  act(() => {
    openClearBrowsingData();
  });
  await screen.findByText("You visited github.com and 1 other site.");
}

const checkbox = (name: string) => screen.getByRole("checkbox", { name });

describe("ClearBrowsingDataModal", () => {
  beforeEach(() => {
    clearHistory.mockReset().mockResolvedValue({ removed: 5 });
    clearSiteData.mockReset().mockResolvedValue(undefined);
  });

  it("says how much of each there is, with cookies left for the person to pick", async () => {
    await open();

    expect(
      screen.getByText("You'll be signed out of most sites."),
    ).toBeTruthy();
    expect(screen.getByText(/^Clearing it frees up 11 MB,/)).toBeTruthy();
    expect(checkbox("Browsing history").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(
      checkbox("Cookies and other site data").getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      screen.getByText(/^Cached files are cleared from all time/),
    ).toBeTruthy();
  });

  it("clears the history in range and the session's data, then says what went", async () => {
    await open();
    fireEvent.click(checkbox("Cookies and other site data"));
    const before = Date.now();

    fireEvent.click(screen.getByRole("button", { name: "Clear data" }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "Cleared your history from the last hour, cookies, site data, and cached files.",
      );
    });
    expect(clearSiteData).toHaveBeenCalledWith({ cache: true, siteData: true });
    const after = Date.now();
    const since = clearHistory.mock.lastCall?.[0].since ?? 0;
    const HOUR_MS = 60 * 60 * 1000;
    expect(since).toBeGreaterThanOrEqual(before - HOUR_MS);
    expect(since).toBeLessThanOrEqual(after - HOUR_MS);
  });

  it("asks only for the history when that is all that is picked", async () => {
    await open();
    fireEvent.click(checkbox("Cached images and files"));

    fireEvent.click(screen.getByRole("button", { name: "Clear data" }));

    await waitFor(() => {
      expect(clearHistory).toHaveBeenCalled();
    });
    expect(clearSiteData).not.toHaveBeenCalled();
  });

  it("offers nothing to clear with every box empty", async () => {
    await open();
    fireEvent.click(checkbox("Browsing history"));
    fireEvent.click(checkbox("Cached images and files"));

    expect(
      screen
        .getByRole("button", { name: "Clear data" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
