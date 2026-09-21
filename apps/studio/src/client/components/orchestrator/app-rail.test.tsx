// The rail down the window's edge: New, one entry per place with the one
// stood in in its well, the Apps mark fanned from the workspace's apps, and
// the user at the foot as the way to Settings.
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

/** The apps the workspace reaches, as the rail reads them; empty until a test says otherwise. */
const apps = vi.fn<
  () => { name: string; site: string; slug: string; standing: string }[]
>(() => []);
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    apps: {
      live: {
        list: {
          experimental_liveOptions: () => ({
            queryFn: () => ({ apps: apps() }),
            queryKey: ["apps"],
          }),
        },
      },
    },
  },
}));

function renderRail(place: "apps" | "chat" | "files" | "home" = "chat") {
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
      ["Apps", null],
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
    fireEvent.click(rail.getByRole("button", { name: "Apps" }));
    expect(onChoose).toHaveBeenLastCalledWith("apps");
  });

  it("fans the workspace's apps out on the Apps mark, connected ones in front, three at most", async () => {
    // No sites: an app with none draws its initial, which is what a DOM with
    // no images to load can show.
    apps.mockReturnValue([
      { name: "Drafts", site: "", slug: "drafts", standing: "setup" },
      { name: "Slack", site: "", slug: "slack", standing: "connected" },
      { name: "Notion", site: "", slug: "notion", standing: "connected" },
      { name: "Linear", site: "", slug: "linear", standing: "connected" },
    ]);
    const { rail } = renderRail();
    const mark = rail.getByRole("button", { name: "Apps" });
    // The sample hand stands in until the list is read.
    await within(mark).findByRole("img", { hidden: true, name: "Slack" });
    const cards = within(mark).getAllByRole("img", { hidden: true });
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      "Slack",
      "Notion",
      "Linear",
    ]);
  });

  it("fans a sample hand, Notion in front between Slack and Linear, while the workspace reaches no app", async () => {
    apps.mockReturnValue([]);
    const { rail } = renderRail();
    const mark = rail.getByRole("button", { name: "Apps" });
    // The sites' icons, as their images name them; the front card comes
    // first in the hand.
    const cards = await within(mark).findAllByRole("img", { hidden: true });
    expect(cards.map((card) => card.getAttribute("alt"))).toEqual([
      "Favicon for notion.so",
      "Favicon for slack.com",
      "Favicon for linear.app",
    ]);
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
