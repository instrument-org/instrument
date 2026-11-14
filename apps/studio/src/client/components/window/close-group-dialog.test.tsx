import { renderWithProviders } from "@/tests/render";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type Chat } from "./chats";
import { CloseGroupDialog } from "./close-group-dialog";

// Every query stays pending.
vi.mock("@/client/rpc/client", () => {
  const pending = () => new Promise(() => undefined);
  const procedure = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      apply: pending,
      get(_target, key) {
        if (key === "queryOptions" || key === "experimental_liveOptions") {
          return () => ({ queryFn: pending, queryKey: path });
        }
        if (key === "mutationOptions") {
          return (options: object) => ({ mutationFn: pending, ...options });
        }
        return typeof key === "string" ? procedure([...path, key]) : undefined;
      },
    });
  return { rpcClient: procedure([]) };
});

function chat(id: string, title: string): Chat {
  return {
    archived: false,
    firstAsk: title,
    holds: { apps: [], files: [], sites: [] },
    id: ChatIdSchema.parse(id),
    lastUserMessageAt: 0,
    sessionId: StoreId.newSessionId(),
    starred: false,
    status: "working",
    title,
    titleByApp: true,
    unread: false,
    unreadByUser: false,
    working: true,
  };
}

describe("asking before a tab group with working chats closes", () => {
  it("names every chat at work in the group", async () => {
    renderWithProviders(
      <CloseGroupDialog
        groupCount={1}
        onCancel={() => {}}
        onConfirm={() => {}}
        working={[
          {
            chat: chat("2026-11-14-first", "Trip budget"),
            group: "group:trip",
          },
          {
            chat: chat("2026-11-14-second", "Hotel shortlist"),
            group: "group:trip",
          },
        ]}
      />,
    );

    const dialog = await screen.findByRole("alertdialog", {
      name: "Stop and close this tab group?",
    });
    expect(dialog.textContent).toMatch(/Trip budget.*Hotel shortlist/);
  });
});
