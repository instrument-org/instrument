// The copy menu is portalled out of the thumbnail, and React still passes a
// press inside it up to the thumbnail's own pointer handlers. Whether the
// menu item then gets its click depends on pointer capture, which only a real
// browser dispatches.
import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

// Relative, not `@/tests/render-browser`: oxlint's type-aware pass does not
// resolve the alias to this module and every access downstream then reads as an
// error type.
import { renderInBrowser } from "../../../tests/render-browser";
import { CaptureLayer } from "./capture-layer";
import { captureThumbnailAtom } from "./capture-store";

const agentNote = vi.hoisted(() =>
  vi.fn(async () => ({
    note: "A note for an agent",
    path: "/captures/capture.png",
  })),
);

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    captures: { agentNote: { call: agentNote } },
    workspaces: {
      current: {
        queryOptions: () => ({
          queryFn: () => null,
          queryKey: ["workspaces.current"],
        }),
      },
    },
  },
}));

vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

describe("CaptureLayer's corner thumbnail", () => {
  it.each([
    ["Copy path", "/captures/capture.png"],
    ["Copy for an agent", "A note for an agent"],
  ])("copies from its menu with %s", async (item, copied) => {
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    const store = createStore();
    store.set(captureThumbnailAtom, { name: "capture.png", stamp: 1 });
    await renderInBrowser(<CaptureLayer />, { store });

    await userEvent.click(
      page.getByRole("button", { name: "More ways to copy" }),
    );
    await userEvent.click(page.getByRole("menuitem", { name: item }));

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(copied);
    });
  });
});
