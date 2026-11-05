import { type Tab, type TabId } from "@/shared/tabs";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { moveTabCall } = vi.hoisted(() => ({
  moveTabCall: vi.fn<(input: unknown) => Promise<unknown>>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: { window: { moveTab: { call: moveTabCall } } },
}));

const { appTabsAtom } = await import("./app-tabs");
const { moveTabOut } = await import("./move-tab-out");
const { showTabCarryView, tabCarryViewAtom } = await import("./tab-carry-view");

const store = getDefaultStore();
const asTab = (id: string) => ({ id, pathname: `/${id}` }) as Tab;
const asId = (id: string) => id as TabId;
const shown = () => store.get(appTabsAtom).tabs.map((tab) => tab.id);

function withTabs(...ids: string[]) {
  store.set(appTabsAtom, (current) => ({
    ...current,
    recentlyClosed: [],
    selectedId: asId(ids[0] ?? ""),
    tabs: ids.map(asTab),
  }));
}

beforeEach(() => {
  withTabs("a", "b");
  // As a drag or a move leaves it, held away from the row.
  showTabCarryView({ heldId: asId("a"), kind: "alone" });
});

afterEach(() => {
  moveTabCall.mockReset();
});

describe("moving a tab from a menu", () => {
  it("asks main as a drag does, with the tab as it stands", async () => {
    moveTabCall.mockResolvedValue({ kind: "none" });
    await moveTabOut(asId("a"), { kind: "new" }, []);
    expect(moveTabCall).toHaveBeenCalledWith({
      isOnlyTab: false,
      moving: {
        neighborPages: [],
        pages: [],
        tab: expect.objectContaining({ id: "a" }) as Tab,
      },
      to: { kind: "new" },
    });
  });

  it.each([
    ["keeps only the tab where the others stay behind", "keepsTab", ["a"]],
    ["lets the tab go where the tab went instead", "losesTab", ["b"]],
    ["changes nothing where nothing moved", "none", ["a", "b"]],
  ])("%s", async (_case, kind, tabs) => {
    moveTabCall.mockResolvedValue({ kind });
    await moveTabOut(asId("a"), { kind: "new" }, []);
    expect(shown()).toEqual(tabs);
    expect(store.get(tabCarryViewAtom)).toEqual({ kind: "row" });
  });

  it("takes on the strip of the window it joined", async () => {
    moveTabCall.mockResolvedValue({
      kind: "takesStrip",
      model: {
        recentlyClosed: [],
        selectedId: "a",
        tabs: [asTab("x"), asTab("a")],
      },
    });
    await moveTabOut(asId("a"), { id: "w2", kind: "window" }, []);
    expect(shown()).toEqual(["x", "a"]);
  });

  it("goes on showing what it shows while its window closes", async () => {
    moveTabCall.mockResolvedValue({ kind: "closes" });
    await moveTabOut(asId("a"), { id: "w2", kind: "window" }, []);
    expect(store.get(tabCarryViewAtom).kind).toBe("alone");
  });

  it("stays as it was and back on its row when the call fails", async () => {
    moveTabCall.mockRejectedValue(new Error("the connection went"));
    await moveTabOut(asId("a"), { kind: "new" }, []);
    expect(shown()).toEqual(["a", "b"]);
    expect(store.get(tabCarryViewAtom)).toEqual({ kind: "row" });
  });

  it("leaves a window's only tab where it is, but can take it to another window", async () => {
    withTabs("a");
    await moveTabOut(asId("a"), { kind: "new" }, []);
    expect(moveTabCall).not.toHaveBeenCalled();

    moveTabCall.mockResolvedValue({ kind: "closes" });
    await moveTabOut(asId("a"), { id: "w2", kind: "window" }, []);
    expect(moveTabCall).toHaveBeenCalledWith(
      expect.objectContaining({ isOnlyTab: true }),
    );
  });
});
