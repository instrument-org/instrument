import { type AppPlace } from "@/client/atoms/window";
// The rail down the window's edge: New, one entry per place with the one
// stood in in its well, and at the foot Feedback over the user, the way to
// Settings.
import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppRail } from "./app-rail";
import { type RailChatMark } from "./chats";

const openSettings = vi.fn<(options: { tab: string }) => void>();
vi.mock("@/client/atoms/settings-modal", () => ({
  openSettings: (options: { tab: string }) => {
    openSettings(options);
  },
}));

const openReportDialog = vi.fn<(request: unknown) => void>();
vi.mock("@/client/atoms/report-dialog", () => ({
  openReportDialog: (request: unknown) => {
    openReportDialog(request);
  },
}));

const user = vi.fn<() => undefined | { image: null | string; name: string }>();
vi.mock("@/client/hooks/use-live-user", () => ({
  useLiveUser: () => ({ data: user() }),
}));

function renderRail(place: AppPlace = "chat", chatMark?: RailChatMark) {
  const onChoose = vi.fn();
  const onNew = vi.fn();
  renderWithProviders(
    <AppRail
      {...(chatMark ? { chatMark } : {})}
      onChoose={onChoose}
      onNew={onNew}
      place={place}
    />,
  );
  return {
    onChoose,
    onNew,
    rail: within(screen.getByRole("navigation", { name: "Places" })),
  };
}

describe("AppRail", () => {
  it("names New, the places, Feedback and Settings, each a word under its mark, with the place stood in current", () => {
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
      ["Chat", "page"],
      ["Files", null],
      ["Browser", null],
      ["Apps", null],
      ["Feedback", null],
      ["Settings", null],
    ]);
  });

  it("opens a draft from New and moves between the places", () => {
    const { onChoose, onNew, rail } = renderRail("chat");
    fireEvent.click(rail.getByRole("button", { name: "New" }));
    expect(onNew).toHaveBeenCalledOnce();
    fireEvent.click(rail.getByRole("button", { name: "Files" }));
    expect(onChoose).toHaveBeenLastCalledWith("files", { newTab: false });
    fireEvent.click(rail.getByRole("button", { name: "Apps" }));
    expect(onChoose).toHaveBeenLastCalledWith("apps", { newTab: false });
  });

  it("asks for a tab of its own on a middle click or a click with Command", () => {
    const { onChoose, rail } = renderRail("chat");
    fireEvent(
      rail.getByRole("button", { name: "Files" }),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(onChoose).toHaveBeenLastCalledWith("files", { newTab: true });
    fireEvent.click(rail.getByRole("button", { name: "Apps" }), {
      metaKey: true,
    });
    expect(onChoose).toHaveBeenLastCalledWith("apps", { newTab: true });
  });

  it("opens the feedback dialog, about no chat, from Feedback", () => {
    const { rail } = renderRail();
    fireEvent.click(rail.getByRole("button", { name: "Feedback" }));
    expect(openReportDialog).toHaveBeenCalledWith({
      kind: "feedback",
      surface: "rail",
    });
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
      "AL",
    );
  });

  it.each<[AppPlace, RailChatMark, null | string]>([
    ["files", "working", "working"],
    ["browser", "waiting", "waiting"],
    ["apps", "unread", "unread"],
    // Chat shows where its chats stand itself.
    ["chat", "waiting", null],
  ])("in %s, wears the %s dot on Chat: %s", (place, mark, shown) => {
    const { rail } = renderRail(place, mark);
    expect(
      rail
        .getByRole("button", { name: "Chat" })
        .querySelector("[data-chat-mark]")
        ?.getAttribute("data-chat-mark") ?? null,
    ).toBe(shown);
  });
});
