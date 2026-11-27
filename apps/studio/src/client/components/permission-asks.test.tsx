import { rpcClient } from "@/client/rpc/client";
import {
  ChatIdSchema,
  DeviceIdSchema,
  StoreId,
} from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../../tests/render";
import { installWindowStubs } from "../../tests/window-stubs";
import { type WindowTab } from "@/client/atoms/window";

import { PermissionAsksFoot } from "./permission-asks";
import { selectedTabIn } from "./window/tab-model";
import { seedWindowTabsAtom, windowTabsAtom } from "./window/window-tabs";

const chatId = ChatIdSchema.parse("test-chat");

const device = DeviceIdSchema.parse("dev_MAC00000");

function showAsks(
  asks: {
    /** Set for a card another computer raised, which this one shows. */
    elsewhere?: {
      answerable: boolean;
      answered?: { by: string; decision: "allowed"; taken: boolean };
    };
    kind?: "app" | "folder";
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
      screen.getByRole("button", { name: "Don’t allow any" }),
    ).toBeDefined();
  });

  it("offers no answer to all for one ask alone", async () => {
    showAsks([{ target: "/Users/sam/Desktop" }]);

    await screen.findByLabelText("sam › Desktop");
    expect(screen.queryByText(/ of /)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Don’t allow any" }),
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
            decision: "always",
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
        "Error applying your answer on Studio Mac. Please try again.",
      ),
    ).toBeDefined();
    expect(buttons()).toContain("Allow in this chat");
  });

  it("asks again for an answer given while this computer was away", async () => {
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
          away: { by: "Sam’s iPhone", decision: "allowed" },
          computer: "Studio Mac",
          device,
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
        "This computer wasn’t available when you answered on Sam’s iPhone. Please answer again.",
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
        "an answer that computer has not picked up yet",
        {
          answerable: false,
          answered: {
            by: "Alex's iPhone",
            decision: "allowed",
            taken: false,
          },
        },
        "folder",
        "open",
        "You answered from Alex's iPhone. Studio Mac needs to be on for it to take effect.",
      ],
      [
        "a yes that macOS there is still asking about",
        {
          answerable: false,
          answered: {
            by: "Alex's iPhone",
            decision: "allowed",
            taken: true,
          },
        },
        "folder",
        "macos-asking",
        "You answered from Alex's iPhone, and Studio Mac needs you to finish it there.",
      ],
    ] as const)(
      "points at that computer for %s, with only a way to let it go here",
      async (_name, elsewhere, kind, status, line) => {
        showAsks([{ elsewhere, kind, status, target: "/Users/sam/Pantry" }]);

        expect(await screen.findByText(line)).toBeDefined();
        expect(buttons()).toEqual(["Show in Finder: Pantry", "Dismiss"]);
      },
    );

    it("draws a card this computer can answer ahead of an older one waiting there", async () => {
      showAsks([
        {
          elsewhere: {
            answerable: false,
            answered: { by: "Studio Mac", decision: "allowed", taken: false },
          },
          target: "/Users/sam/Pantry",
        },
        { status: "macos-asking", target: "/Users/sam/Downloads" },
      ]);

      expect(
        await screen.findByText("Your Mac is asking about “Downloads”"),
      ).toBeDefined();
      expect(screen.getByText("1 of 2")).toBeDefined();
      expect(screen.queryByLabelText("sam › Pantry")).toBeNull();
    });
  });
});

describe("the page wait card, clicked", () => {
  /** A group of the chat's: the chat up, and the tab the wait names by `agentId` behind it, with `hosted` tabs no strip lists. */
  function waitOn(
    named: WindowTab,
    hosted: WindowTab[] = [],
  ): ReturnType<typeof renderWithProviders>["store"] {
    const { queryClient, store } = renderWithProviders(
      <PermissionAsksFoot chatId={chatId} />,
    );
    store.set(seedWindowTabsAtom, {
      activeByGroup: { g: "chat" },
      groups: {},
      tabs: [
        { group: "g", href: "/chat/test-chat", id: "chat", kind: "screen" },
        named,
        ...hosted,
      ],
    });
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
          here: true,
          id: "ask-0",
          kind: "page",
          page: { title: "Sign in", url: "https://shop.example/" },
          status: "open",
          target: "tab_agent",
        },
      ],
    );
    return store;
  }

  it.each([
    [
      "a page tab reopened under a new id",
      { agentId: "tab_agent", group: "g", id: "tab_reopened", kind: "page" },
      [],
    ],
    [
      "a page that took over from a file's tab",
      { agentId: "tab_agent", group: "g", id: "tab_page", kind: "page" },
      [],
    ],
    [
      "a file's tab that was a page",
      {
        agentId: "tab_agent",
        group: "g",
        href: "/files?path=%2Fw%2Freport.html",
        id: "tab_file",
        kind: "screen",
      },
      [{ group: "page:tab_file", id: "tab_agent", kind: "page" }],
    ],
  ] satisfies [string, WindowTab, WindowTab[]][])(
    "brings up %s, by the id the agent names it by",
    async (_case, named, hosted) => {
      const store = waitOn(named, hosted);

      fireEvent.click(await screen.findByText(/Waiting for you on/));

      expect(selectedTabIn(store.get(windowTabsAtom), "g")?.id).toBe(named.id);
    },
  );
});
