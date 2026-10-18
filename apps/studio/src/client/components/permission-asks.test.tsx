import { rpcClient } from "@/client/rpc/client";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../../tests/render";
import { installWindowStubs } from "../../tests/window-stubs";
import { PermissionAsksFoot } from "./permission-asks";

const chatId = ChatIdSchema.parse("test-chat");

function showAsks(
  asks: {
    kind?: "app" | "folder";
    reason?: string;
    status?: "macos-refused" | "open";
    target: string;
  }[],
) {
  const { queryClient } = renderWithProviders(
    <PermissionAsksFoot chatId={chatId} />,
  );
  queryClient.setQueryData(
    rpcClient.workspace.chats.live.asks.experimental_liveOptions({
      input: { id: chatId },
    }).queryKey,
    asks.map(({ kind = "folder", reason, status = "open", target }, index) => ({
      askedAt: new Date(index),
      askers: [
        { sessionId: StoreId.newSessionId(), ...(reason && { reason }) },
      ],
      id: `ask-${index}`,
      kind,
      status,
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

  it("says what the agent needs it for", async () => {
    showAsks([
      {
        reason: "Saving a copy of the comparison on your Desktop",
        target: "/Users/sam/Desktop",
      },
    ]);

    expect(
      await screen.findByText(
        "Saving a copy of the comparison on your Desktop",
      ),
    ).toBeDefined();
  });

  it("offers the ways past macOS, not the yes again, once macOS refused", async () => {
    showAsks([{ status: "macos-refused", target: "/Users/sam/Desktop" }]);

    expect(
      await screen.findByText(
        "Your Mac is keeping Instrument out of “Desktop”",
      ),
    ).toBeDefined();
    expect(screen.getAllByRole("button").map((button) => button.textContent))
      .toMatchInlineSnapshot(`
      [
        "Choose “Desktop”…",
        "Open System Settings",
        "Don’t allow",
      ]
    `);
  });
});
