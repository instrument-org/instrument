// The rail down the window's edge: New, one entry per place with the one
// stood in marked, and the user at the foot as the way to Settings.
import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppRail } from "./app-rail";

const openSettings = vi.fn<(options: { tab: string }) => void>();
vi.mock("@/client/atoms/settings-modal", () => ({
  openSettings: (options: { tab: string }) => {
    openSettings(options);
  },
}));

const user = vi.fn<() => undefined | { image: null | string; name: string }>();
vi.mock("@/client/hooks/use-live-user", () => ({
  useLiveUser: () => ({ data: user() }),
}));

function renderRail(place: "chat" | "files" | "home" = "chat") {
  const onChoose = vi.fn();
  const onNew = vi.fn();
  renderWithProviders(
    <AppRail onChoose={onChoose} onNew={onNew} place={place} />,
  );
  return {
    onChoose,
    onNew,
    rail: within(screen.getByRole("navigation", { name: "Places" })),
  };
}

describe("AppRail", () => {
  it("names New, the places, and Settings, each a word under its mark, with the place stood in current", () => {
    const { rail } = renderRail("chat");
    expect(
      rail
        .getAllByRole("button")
        .map((entry) => [
          entry.textContent,
          entry.getAttribute("aria-current"),
        ]),
    ).toEqual([
      ["New", null],
      ["Home", null],
      ["Chat", "page"],
      ["Files", null],
      ["Settings", null],
    ]);
  });

  it("opens a draft from New and moves between the places", () => {
    const { onChoose, onNew, rail } = renderRail("chat");
    fireEvent.click(rail.getByRole("button", { name: "New" }));
    expect(onNew).toHaveBeenCalledOnce();
    fireEvent.click(rail.getByRole("button", { name: "Files" }));
    expect(onChoose).toHaveBeenLastCalledWith("files");
    fireEvent.click(rail.getByRole("button", { name: "Home" }));
    expect(onChoose).toHaveBeenLastCalledWith("home");
  });

  it("opens Settings from the foot", () => {
    user.mockReturnValue(undefined);
    const { rail } = renderRail();
    fireEvent.click(rail.getByRole("button", { name: "Settings" }));
    expect(openSettings).toHaveBeenCalledWith({ tab: "General" });
  });

  it("wears the user's initials at the foot once they are signed in", () => {
    user.mockReturnValue({ image: null, name: "Ada Lovelace" });
    const { rail } = renderRail();
    expect(rail.getByRole("button", { name: /Settings/ }).textContent).toBe(
      "ALSettings",
    );
  });
});
