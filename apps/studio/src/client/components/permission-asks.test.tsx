import { rpcClient } from "@/client/rpc/client";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../../tests/render";
import { installWindowStubs } from "../../tests/window-stubs";
import { PermissionAsksFoot } from "./permission-asks";

const chatId = ChatIdSchema.parse("test-chat");

function showAsks(asks: { kind?: "app" | "folder"; target: string }[]) {
  const { queryClient } = renderWithProviders(
    <PermissionAsksFoot chatId={chatId} messages={[]} />,
  );
  queryClient.setQueryData(
    rpcClient.workspace.chats.live.asks.experimental_liveOptions({
      input: { id: chatId },
    }).queryKey,
    asks.map(({ kind = "folder", target }, index) => ({
      askedAt: new Date(index),
      askers: [{ sessionId: StoreId.newSessionId() }],
      id: `ask-${index}`,
      kind,
      status: "open",
      target,
    })),
  );
}

afterEach(installWindowStubs);

describe("PermissionAsksFoot", () => {
  it.each([
    ["/Users/sam/Desktop", "Desktop"],
    // A backslash is a character a name can hold on a Mac or Linux.
    ["/Users/sam/Documents/a\\b", "a\\b"],
    ["D:\\Projects\\Clients", "Clients"],
  ])("names %s as %s over its whole path", async (target, name) => {
    showAsks([{ target }]);

    expect(await screen.findByText(name)).toBeDefined();
    expect(screen.getByText(target)).toBeDefined();
  });

  it("asks about an app by its name, with no path", async () => {
    showAsks([{ kind: "app", target: "Calendar" }]);

    expect(
      await screen.findByText("Can Instrument use this app?"),
    ).toBeDefined();
    expect(screen.getByText("Calendar")).toBeDefined();
  });

  it.each([
    ["/Users/sam", "/Users/sam/.config/gh", true],
    // A folder in home called `.config\gh`, and one beside home called
    // `sam\.ssh`, hold nobody's sign-ins.
    ["/Users/sam", "/Users/sam/.config\\gh", false],
    ["/Users/sam", "/Users/sam\\.config\\gh", false],
    ["C:\\Users\\sam", "C:\\Users\\sam\\.config\\gh", true],
  ])(
    "with home at %s, says %s holds sign-ins: %s",
    async (home, target, holds) => {
      window.api.homeDir = home;
      showAsks([{ target }]);

      await screen.findByText("Can Instrument use this folder?");
      expect(
        screen.queryByText("This folder has your sign-in to GitHub.") !== null,
      ).toBe(holds);
    },
  );

  it("draws the oldest of several asks, with how many are waiting", async () => {
    showAsks([
      { target: "/Users/sam/Desktop" },
      { target: "/Users/sam/Downloads" },
      { kind: "app", target: "Calendar" },
    ]);

    expect(await screen.findByText("1 of 3")).toBeDefined();
    expect(screen.getByText("Desktop")).toBeDefined();
    expect(screen.queryByText("Downloads")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Don’t allow any of these" }),
    ).toBeDefined();
  });

  it("offers no answer to all for one ask alone", async () => {
    showAsks([{ target: "/Users/sam/Desktop" }]);

    await screen.findByText("Desktop");
    expect(screen.queryByText(/ of /)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Don’t allow any of these" }),
    ).toBeNull();
  });
});
