import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StorageSection } from "./storage-section";

// Paths shorten against the home directory the dom setup pins on the preload
// bridge, `/Users/sam`.

const { calls, data } = vi.hoisted(() => ({
  calls: new Map<string, (input: unknown) => unknown>(),
  data: new Map<string, unknown>(),
}));

/**
 * Every route as a query whose data is `data`'s entry for it, and as a
 * call answered by `calls`' entry, so the section reads and asks what each
 * test sets.
 */
vi.mock("@/client/rpc/client", () => {
  const route = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get: (_target, name: string) => {
        const key = path.join(".");
        switch (name) {
          case "call":
            return async (input: unknown) => calls.get(key)?.(input) ?? null;
          case "key":
          case "queryKey":
            return () => [key];
          case "mutationOptions":
            return () => ({ mutationFn: async () => null });
          case "queryOptions":
            return ({ input }: { input?: unknown } = {}) => ({
              enabled: typeof input !== "symbol",
              queryFn: () => data.get(key) ?? null,
              queryKey: [key, input],
            });
          default:
            return route([...path, name]);
        }
      },
    });
  return { rpcClient: route([]) };
});

const NOTES = "/Users/sam/Notes";

beforeEach(() => {
  calls.clear();
  data.clear();
  data.set("workspaces.folder", {
    inAppData: false,
    path: "/Users/sam/Instrument",
    pinned: false,
    suggested: "/Users/sam",
  });
  data.set("workspace.storage.invalidFolders.list", []);
  data.set("workspace.computer.places", { pinned: [], volumes: [] });
  calls.set("utils.showFolderPicker", () => ({ path: NOTES }));
});

async function pickNotes() {
  renderWithProviders(<StorageSection />);
  fireEvent.click(await screen.findByRole("button", { name: "Move…" }));
}

describe("InstrumentFolder", () => {
  it("asks before making a folder in a pick with other files, then moves into the one it makes", async () => {
    const move = vi.fn(() => ({ kind: "canceled" }));
    calls.set("workspaces.move", move);
    calls.set("workspaces.checkPick", () => ({
      folder: {
        contents: "new",
        path: `${NOTES}/Instrument`,
        verdict: { kind: "movable" },
      },
      itself: { contents: "files", path: NOTES, verdict: { kind: "movable" } },
    }));
    await pickNotes();

    expect(
      await screen.findByText("Make a folder for Instrument in “Notes”?"),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Make folder" }));

    expect(
      await screen.findByText("Move your Instrument folder?"),
    ).toBeDefined();
    expect(screen.getByLabelText("sam › Notes › Instrument")).toBeDefined();
    // A folder still to be made says nothing under its path.
    expect(screen.queryByText("Has other files in it")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restart and Move" }));
    await vi.waitFor(() => {
      expect(move).toHaveBeenCalledWith({
        create: true,
        path: `${NOTES}/Instrument`,
      });
    });
  });

  it("uses the pick as it is when the person doesn't make one", async () => {
    calls.set("workspaces.checkPick", () => ({
      folder: {
        contents: "new",
        path: `${NOTES}/Instrument`,
        verdict: { kind: "movable" },
      },
      itself: { contents: "files", path: NOTES, verdict: { kind: "movable" } },
    }));
    await pickNotes();

    fireEvent.click(
      await screen.findByRole("button", { name: "Don’t make one" }),
    );

    expect(await screen.findByLabelText("sam › Notes")).toBeDefined();
    expect(screen.getByText("Has other files in it")).toBeDefined();
  });

  it("won't move into another Instrument folder, and says why", async () => {
    calls.set("workspaces.checkPick", () => ({
      folder: {
        contents: "files",
        path: `${NOTES}/Instrument`,
        verdict: { kind: "workspace", name: "Lab" },
      },
    }));
    await pickNotes();

    expect(
      await screen.findByText(
        "You can’t move one Instrument folder into another. Choose a different place for yours.",
      ),
    ).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "Restart and Move" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
