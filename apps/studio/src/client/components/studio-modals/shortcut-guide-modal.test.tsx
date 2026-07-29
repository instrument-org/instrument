import { shortcutGuideModalAtom } from "@/client/atoms/shortcut-guide-modal";
import { ShortcutGuideModal } from "@/client/components/studio-modals/shortcut-guide-modal";
import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";

function openGuide() {
  const { store } = renderWithProviders(<ShortcutGuideModal />);
  act(() => {
    store.set(shortcutGuideModalAtom, true);
  });
  return screen.getByPlaceholderText("Search shortcuts");
}

const rowLabels = () =>
  screen
    .getAllByTestId("shortcut-row")
    .map((row) => row.textContent)
    .join(" | ");

describe("ShortcutGuideModal", () => {
  it("groups every shortcut and renders its chord", () => {
    openGuide();

    expect(screen.getByText("General")).toBeTruthy();
    expect(screen.getByText("Tabs")).toBeTruthy();
    // Developer shortcuts are for developer mode, which is off by default.
    expect(screen.queryByText("Developer")).toBeNull();
    expect(rowLabels()).toContain("New Tab");
  });

  it("filters to what was searched", () => {
    const search = openGuide();

    fireEvent.change(search, { target: { value: "sidebar" } });

    expect(rowLabels()).toBe("Toggle Sidebar⌘B");
  });

  it("says so when nothing matches", () => {
    const search = openGuide();

    fireEvent.change(search, { target: { value: "qqq" } });

    expect(screen.queryAllByTestId("shortcut-row")).toHaveLength(0);
    expect(screen.getByText(/No shortcuts match/)).toBeTruthy();
  });
});
