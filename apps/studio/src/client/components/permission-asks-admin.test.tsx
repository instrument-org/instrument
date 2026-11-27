import { renderWithProviders } from "@/tests/render";
import {
  ChatIdSchema,
  DeviceIdSchema,
  StoreId,
} from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installWindowStubs } from "../../tests/window-stubs";
import { commandByHand, PermissionAsksFoot } from "./permission-asks";

const { answer, asks } = vi.hoisted(() => ({
  answer: vi.fn(),
  asks: [] as Record<string, unknown>[],
}));

/** The calls the card makes, with the answer recorded rather than sent. */
vi.mock("@/client/rpc/client", () => {
  const mutation = (mutationFn: (input: unknown) => unknown) => ({
    mutationOptions: (options: object) => ({ ...options, mutationFn }),
  });
  return {
    rpcClient: {
      workspace: {
        chats: {
          live: {
            asks: {
              experimental_liveOptions: () => ({
                queryFn: () => asks,
                queryKey: ["asks"],
              }),
            },
          },
        },
        permissions: {
          answer: mutation((input) => {
            answer(input);
            return Promise.resolve();
          }),
          declineAll: mutation(() => Promise.resolve()),
          dismiss: mutation(() => Promise.resolve()),
          retry: mutation(() => Promise.resolve()),
        },
      },
    },
  };
});

const chatId = ChatIdSchema.parse("test-chat");
const command = "systemsetup -settimezone America/New_York";

function showAdminCard({ here = true } = {}) {
  asks.length = 0;
  asks.push({
    answerable: true,
    askedAt: new Date(0),
    askers: [{ at: new Date(0), sessionId: StoreId.newSessionId() }],
    computer: "Studio Mac",
    device: DeviceIdSchema.parse("dev_MAC00000"),
    here,
    id: "ask-0",
    kind: "admin",
    status: "open",
    target: command,
  });
  renderWithProviders(<PermissionAsksFoot chatId={chatId} />);
}

beforeEach(() => {
  answer.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

afterEach(installWindowStubs);

describe("an admin card's other answers", () => {
  it("answers Try without administrator, from any computer", async () => {
    showAdminCard({ here: false });
    fireEvent.click(
      await screen.findByRole("button", { name: "Try without administrator" }),
    );
    await vi.waitFor(() => {
      expect(answer).toHaveBeenCalledWith({
        askId: "ask-0",
        decision: "without-admin",
        id: chatId,
      });
    });
  });

  it("answers Done once the person ran it by hand, and Back answers nothing", async () => {
    showAdminCard();
    fireEvent.click(
      await screen.findByRole("button", { name: "I’ll run it myself" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Back" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "I’ll run it myself" }),
    );
    expect(answer).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    await vi.waitFor(() => {
      expect(answer).toHaveBeenCalledWith({
        askId: "ask-0",
        decision: "ran-by-hand",
        id: chatId,
      });
    });
  });

  it("copies the command as it is for an administrator's PowerShell on Windows", async () => {
    Object.defineProperty(window, "electron", {
      configurable: true,
      value: { process: { platform: "win32" } },
    });
    showAdminCard();
    fireEvent.click(
      await screen.findByRole("button", { name: "I’ll run it myself" }),
    );
    expect(
      await screen.findByText(
        "Command copied. Paste it in PowerShell as administrator, then choose Done.",
      ),
    ).toBeDefined();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(command);
  });
});

describe("commandByHand", () => {
  it.each([
    [command, `sudo ${command}`],
    [
      `systemsetup -settimezone America/New_York; echo "it's set"`,
      `sudo /bin/bash -c 'systemsetup -settimezone America/New_York; echo "it'\\''s set"'`,
    ],
    [
      "launchctl list | grep ssh",
      `sudo /bin/bash -c 'launchctl list | grep ssh'`,
    ],
  ])("runs %s after sudo as %s", (given, copied) => {
    expect(commandByHand(given)).toBe(copied);
  });
});
