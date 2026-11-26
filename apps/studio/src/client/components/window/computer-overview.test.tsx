import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ComputerOverview } from "./computer-overview";

const { pressPlace } = vi.hoisted(() => ({ pressPlace: vi.fn() }));
vi.mock("./drag/press-bookmark", () => ({ pressPlace }));
vi.mock("@/client/hooks/use-active-tab", () => ({
  useRefreshWhileShown: () => ({}),
}));
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      computer: {
        drives: {
          queryOptions: () => ({
            queryFn: () => [{ name: "Macintosh HD", path: "/" }],
            queryKey: ["drives"],
          }),
        },
      },
    },
  },
}));

describe("ComputerOverview", () => {
  it("holds a place as a link to Files at its folder, never as the folder itself", async () => {
    renderWithProviders(
      <ComputerOverview
        clouds={[]}
        folders={[{ name: "Desktop", path: "/Users/mac-user/Desktop" }]}
        home="/Users/mac-user"
        menu={() => null}
        onOpen={vi.fn()}
        onOpenInNewTab={vi.fn()}
        refreshInterval={false}
      />,
    );
    const desktop = screen.getByRole("button", { name: "Desktop" });
    // Nothing the system's drag could copy out of the app.
    expect(desktop.hasAttribute("draggable")).toBe(false);
    fireEvent.pointerDown(desktop, { button: 0, isPrimary: true });
    expect(pressPlace).toHaveBeenCalledWith(expect.anything(), {
      name: "Desktop",
      path: "/Users/mac-user/Desktop",
    });
    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "Macintosh HD" }),
      { button: 0, isPrimary: true },
    );
    expect(pressPlace).toHaveBeenLastCalledWith(expect.anything(), {
      name: "Macintosh HD",
      path: "/",
    });
  });
});
