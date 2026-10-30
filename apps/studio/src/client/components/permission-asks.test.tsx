import { rpcClient } from "@/client/rpc/client";
import {
  ChatIdSchema,
  DeviceIdSchema,
  StoreId,
} from "@instrument-org/workspace/client";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../../tests/render";
import { installWindowStubs } from "../../tests/window-stubs";
import { PermissionAsksFoot } from "./permission-asks";

const chatId = ChatIdSchema.parse("test-chat");

const device = DeviceIdSchema.parse("dev_MAC00000");

function showAsks(
  asks: {
    /** Set for a card another computer raised, which this one shows. */
    elsewhere?: {
      answerable: boolean;
      answered?: { by: string; decision: "allowed"; taken: boolean };
    };
    kind?: "app" | "folder" | "tab";
    reason?: string;
    status?: "macos-asking" | "macos-private" | "macos-refused" | "open";
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
    asks.map(
      (
        { elsewhere, kind = "folder", reason, status = "open", target },
        index,
      ) => ({
        answerable: elsewhere?.answerable ?? true,
        ...(elsewhere?.answered && { answered: elsewhere.answered }),
        askedAt: new Date(index),
        askers: [
          {
            at: new Date(index),
            sessionId: StoreId.newSessionId(),
            ...(reason && { reason }),
          },
        ],
        computer: "Studio Mac",
        device,
        here: elsewhere === undefined,
        id: `ask-${index}`,
        kind,
        status,
        target,
      }),
    ),
  );
}

afterEach(installWindowStubs);

describe("PermissionAsksFoot", () => {
  it.each([
    ["/Users/sam/Desktop", "Desktop", "sam › Desktop"],
    // A backslash is a character a name can hold on a Mac or Linux.
    ["/Users/sam/Documents/a\\b", "a\\b", "sam › Documents › a\\b"],
    ["D:\\Projects\\Clients", "Clients", "D: › Projects › Clients"],
  ])(
    "names %s as %s over its path from the home folder's name",
    async (target, name, shown) => {
      showAsks([{ target }]);

      const path = await screen.findByLabelText(shown);
      expect(path.previousElementSibling?.textContent).toBe(name);
    },
  );

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
    expect(screen.getByLabelText("sam › Desktop")).toBeDefined();
    expect(screen.queryByText("Downloads")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Don’t allow any of these" }),
    ).toBeDefined();
  });

  it("offers no answer to all for one ask alone", async () => {
    showAsks([{ target: "/Users/sam/Desktop" }]);

    await screen.findByLabelText("sam › Desktop");
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
        "Your Mac prevented Instrument from accessing “Desktop”",
      ),
    ).toBeDefined();
    // An ask with no reason says why in general terms.
    expect(
      screen.getByText(
        "Instrument needs access to “Desktop” to finish your task.",
      ),
    ).toBeDefined();
    // The test window has no Files view, so the folder's own button names
    // the Finder.
    expect(
      screen
        .getAllByRole("button")
        .map(
          (button) => button.getAttribute("aria-label") ?? button.textContent,
        ),
    ).toMatchInlineSnapshot(`
      [
        "Show in Finder: Desktop",
        "Allow",
        "Open System Settings",
        "Don’t allow",
      ]
    `);
  });

  const buttons = () =>
    screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);

  it("offers only System Settings for an app macOS refused", async () => {
    showAsks([{ kind: "app", status: "macos-refused", target: "Reminders" }]);

    expect(
      await screen.findByText(
        "Your Mac prevented Instrument from using Reminders",
      ),
    ).toBeDefined();
    expect(buttons()).toEqual(["Open System Settings", "Don’t allow"]);
  });

  it("points at macOS's own window while it asks, with nothing to answer here", async () => {
    showAsks([{ status: "macos-asking", target: "/Users/sam/Downloads" }]);

    expect(
      await screen.findByText("Your Mac is asking about “Downloads”"),
    ).toBeDefined();
    expect(
      screen.getByText("Choose Allow in the window your Mac opened."),
    ).toBeDefined();
    expect(buttons()).toEqual(["Show in Finder: Downloads", "Don’t allow"]);
  });

  it("says a folder only its own app opens is private, with no way in", async () => {
    showAsks([{ status: "macos-private", target: "/Users/sam/Library/Mail" }]);

    expect(
      await screen.findByText("Your Mac keeps “Mail” private"),
    ).toBeDefined();
    expect(buttons()).toEqual(["Show in Finder: Mail", "OK"]);
  });

  it("says an answer that didn't go through can be given again", async () => {
    const { queryClient } = renderWithProviders(
      <PermissionAsksFoot chatId={chatId} />,
    );
    queryClient.setQueryData(
      rpcClient.workspace.chats.live.asks.experimental_liveOptions({
        input: { id: chatId },
      }).queryKey,
      [
        {
          answerable: true,
          askedAt: new Date(0),
          askers: [{ at: new Date(0), sessionId: StoreId.newSessionId() }],
          computer: "Studio Mac",
          device,
          failed: {
            at: new Date(1),
            decision: "always",
            device,
            message: "Couldn't write the folder rule",
          },
          here: true,
          id: "ask-0",
          kind: "folder",
          status: "open",
          target: "/Users/sam/Pantry",
        },
      ],
    );

    expect(
      await screen.findByText(
        "Your last answer didn’t go through on Studio Mac, so you can answer again.",
      ),
    ).toBeDefined();
    expect(buttons()).toContain("Allow in this chat");
  });

  describe("raised on another computer", () => {
    it("answers it from here, saying where the answer goes", async () => {
      showAsks([
        { elsewhere: { answerable: true }, target: "/Users/sam/Pantry" },
      ]);

      expect(
        await screen.findByText(
          "Your answer goes to Studio Mac, which asked for this.",
        ),
      ).toBeDefined();
      expect(buttons()).toEqual([
        "Show in Finder: Pantry",
        "Allow in this chat",
        "Always allow",
        "Don’t allow",
      ]);
    });

    it.each([
      [
        "a tab, which moves on the screen it is on",
        { answerable: false },
        "tab",
        "open",
        "You can answer this on Studio Mac.",
      ],
      [
        "an answer that computer has not picked up yet",
        {
          answerable: false,
          answered: {
            by: "Jeremy's iPhone",
            decision: "allowed",
            taken: false,
          },
        },
        "folder",
        "open",
        "You answered from Jeremy's iPhone. It takes effect once Studio Mac picks it up.",
      ],
      [
        "a yes that macOS there is still asking about",
        {
          answerable: false,
          answered: {
            by: "Jeremy's iPhone",
            decision: "allowed",
            taken: true,
          },
        },
        "folder",
        "macos-asking",
        "You answered from Jeremy's iPhone, and Studio Mac needs you to finish it there.",
      ],
    ] as const)(
      "points at that computer for %s, with nothing to answer here",
      async (_name, elsewhere, kind, status, line) => {
        showAsks([{ elsewhere, kind, status, target: "/Users/sam/Pantry" }]);

        expect(await screen.findByText(line)).toBeDefined();
        expect(
          screen.queryByRole("button", { name: /allow|Skip|Move tab/i }),
        ).toBeNull();
      },
    );
  });
});
