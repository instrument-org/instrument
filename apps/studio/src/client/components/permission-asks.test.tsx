import { rpcClient } from "@/client/rpc/client";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../../tests/render";
import { installWindowStubs } from "../../tests/window-stubs";
import { PermissionAsksForPart } from "./permission-asks";

const chatId = ChatIdSchema.parse("test-chat");
const partId = StoreId.newPartId();

function showAsk(target: string) {
  const { queryClient } = renderWithProviders(
    <PermissionAsksForPart
      chatId={chatId}
      explanation={undefined}
      partId={partId}
    />,
  );
  queryClient.setQueryData(
    rpcClient.workspace.chats.live.asks.experimental_liveOptions({
      input: { id: chatId },
    }).queryKey,
    [
      {
        askedAt: new Date(0),
        askers: [{ partId, sessionId: StoreId.newSessionId() }],
        id: "ask-1",
        kind: "folder",
        target,
      },
    ],
  );
}

afterEach(installWindowStubs);

describe("PermissionAsksForPart", () => {
  // The home folder is /Users/sam (`tests/window-stubs.ts`).
  it.each([
    ["/Users/sam/Documents/Clients", "Documents › Clients"],
    ["/Users/sam", "sam"],
    // A backslash is a character a name can hold on a Mac or Linux.
    ["/Users/sam/Documents/a\\b", "Documents › a\\b"],
    ["D:\\Projects\\Clients", "D: › Projects › Clients"],
  ])("says where %s is as %s", async (target, where) => {
    showAsk(target);

    expect(await screen.findByText(where)).toBeDefined();
  });

  it.each([
    ["/Users/sam/Documents/a\\b", "a\\b"],
    ["D:\\Projects\\Clients", "Clients"],
  ])("asks about %s by its name, %s", async (target, name) => {
    showAsk(target);

    expect(
      await screen.findByText(`Let Instrument use “${name}”?`),
    ).toBeDefined();
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
      showAsk(target);

      await screen.findByText(/^Let Instrument use/);
      expect(
        screen.queryByText("This folder has your sign-in to GitHub.") !== null,
      ).toBe(holds);
    },
  );
});
