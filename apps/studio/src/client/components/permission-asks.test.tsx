import { rpcClient } from "@/client/rpc/client";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../tests/render";
import { PermissionAsksForPart } from "./permission-asks";

const chatId = ChatIdSchema.parse("test-chat");
const partId = StoreId.newPartId();

describe("PermissionAsksForPart", () => {
  // The home folder is /Users/sam (`tests/window-stubs.ts`).
  it.each([
    ["/Users/sam/Documents/Clients", "Documents › Clients"],
    ["/Users/sam", "sam"],
    // A backslash is a character a name can hold on a Mac or Linux.
    ["/Users/sam/Documents/a\\b", "Documents › a\\b"],
    ["D:\\Projects\\Clients", "D: › Projects › Clients"],
  ])("says where %s is as %s", async (target, where) => {
    const { queryClient } = renderWithProviders(
      <PermissionAsksForPart
        chatId={chatId}
        explanation={undefined}
        partId={partId}
      />,
    );
    queryClient.setQueryData(
      rpcClient.workspace.permissions.liveAsks.experimental_liveOptions({
        input: { id: chatId },
      }).queryKey,
      [
        {
          askedAt: new Date(0),
          id: "ask-1",
          kind: "folder",
          partId,
          sessionId: StoreId.newSessionId(),
          target,
        },
      ],
    );

    expect(await screen.findByText(where)).toBeDefined();
  });
});
