import { renderWithProviders } from "@/tests/render";
import { APP_NAME, HOME_FOLDERS } from "@instrument-org/shared";
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
          case "experimental_liveOptions":
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
    expect(screen.queryByText("Already contains some files")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restart and move" }));
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
    expect(screen.getByText("Already contains some files")).toBeDefined();
  });

  it("says once that files in a folder named for the app are its own", async () => {
    calls.set("workspaces.checkPick", () => ({
      folder: {
        contents: "files",
        path: `${NOTES}/${HOME_FOLDERS.instrument}`,
        verdict: { kind: "movable" },
      },
    }));
    await pickNotes();

    const madeBy = `It has files ${APP_NAME} made for you before, and ${APP_NAME}’s new files will go in beside them.`;
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(
      `“Notes” already has a folder named “${HOME_FOLDERS.instrument}”${madeBy}`,
    );
    expect(screen.getAllByText(madeBy)).toHaveLength(1);
    expect(dialog.textContent).not.toContain("other files");

    fireEvent.click(screen.getByRole("button", { name: "Use it anyway" }));
    expect(await screen.findByText(madeBy)).toBeDefined();
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
        .getByRole("button", { name: "Restart and move" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
