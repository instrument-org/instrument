import { type BrowserTabsHandle } from "@/client/components/window/browser-tabs";
import {
  WindowContext,
  type WindowContextValue,
} from "@/client/components/window/context";
import { renderWithProviders } from "@/tests/render";
import { StoreId } from "@instrument-org/workspace/client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToolConnectApp } from "./tool-connect-app";

const { mocks, mutation, query } = vi.hoisted(() => ({
  mocks: {
    apps: vi.fn<() => Promise<unknown>>(),
    signInOnWeb: vi.fn<(input: { slug: string }) => Promise<unknown>>(),
  },
  mutation: (mutationFn = () => Promise.resolve()) => ({
    mutationOptions: (options: object) => ({ ...options, mutationFn }),
  }),
  query: (key: string, queryFn: () => Promise<unknown>) => ({
    experimental_liveOptions: () => ({ queryFn, queryKey: [key] }),
  }),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    apps: {
      allow: mutation(),
      cancelOAuth: mutation(),
      dismiss: mutation(),
      live: {
        catalog: query("catalog", () => Promise.resolve([])),
        list: query("apps", mocks.apps),
      },
      markWebSignedIn: mutation(),
      setCredential: mutation(),
      signInOnWeb: {
        mutationOptions: (options: object) => ({
          ...options,
          mutationFn: mocks.signInOnWeb,
        }),
      },
      startOAuth: mutation(),
    },
    utils: {
      openExternalLink: mutation(),
      browserOpenTarget: {
        queryOptions: (options: object) => ({
          ...options,
          queryFn: () => Promise.resolve({ appName: "Safari" }),
          queryKey: ["browser"],
        }),
      },
    },
  },
}));

const openPage = vi.fn();

/** Outlook as the Apps list draws it, its sign-in having ended this way. */
function outlook(
  connection: {
    ended?: "canceled" | "expired" | "refused";
    error?: string;
    status: "failed" | "needs-sign-in";
  },
  type: "mcp" | "web" = "mcp",
) {
  return {
    apps: [
      {
        authKind: "oauth",
        connection: { ...connection, updatedAt: 1 },
        credentialOrigin: "https://graph.microsoft.com",
        dir: "/apps/Outlook",
        endpoint: "https://graph.microsoft.com/v1.0",
        hasCredential: false,
        name: "Outlook",
        ...(type === "web"
          ? { signIn: "https://outlook.office.com", type }
          : { type }),
        slug: "outlook",
        standing: connection.status,
      },
    ],
  };
}

function renderCard() {
  const window = {
    ask: vi.fn(),
    // Only whether there is one is read here.
    browser: {} as BrowserTabsHandle,
    focusComposer: vi.fn(),
    openPage,
    openPath: vi.fn(),
    openScreen: vi.fn(),
  } satisfies WindowContextValue;
  return renderWithProviders(
    <WindowContext.Provider value={window}>
      <ToolConnectApp
        part={{
          input: { reason: "So I can read your mail.", slug: "outlook" },
          metadata: {
            createdAt: new Date(1),
            endedAt: new Date(2),
            id: StoreId.newPartId(),
            messageId: StoreId.newMessageId(),
            sessionId: StoreId.newSessionId(),
          },
          output: {
            kind: "sign-in",
            name: "Outlook",
            slug: "outlook",
            state: "asked",
          },
          state: "output-available",
          toolCallId: "call-1",
          type: "tool-connect_app",
        }}
      />
    </WindowContext.Provider>,
  );
}

/** The card's words and buttons, in the order they read. */
async function cardReads(): Promise<string[]> {
  await screen.findByRole("button", { name: "Sign in on the web" });
  return [
    ...screen
      .getAllByText(/./, { selector: "p" })
      .map((line) => line.textContent ?? ""),
    ...screen
      .getAllByRole("button")
      .map((button) => `[${button.textContent ?? ""}]`),
  ];
}

beforeEach(() => {
  mocks.apps.mockReset();
  mocks.signInOnWeb.mockReset();
  openPage.mockReset();
});

describe("the connect card after a sign-in that did not connect", () => {
  it("offers signing in on the web first, however the sign-in ended", async () => {
    const read: Record<string, string[]> = {};
    for (const [ended, error] of [
      ["refused", "access_denied: AADSTS65001: not consented"],
      ["canceled", "The sign-in was stopped before it finished."],
      ["expired", "The sign-in lapsed."],
      [undefined, "HTTP 500: registration failed"],
    ] as const) {
      mocks.apps.mockResolvedValue(
        outlook({ ...(ended ? { ended } : {}), error, status: "failed" }),
      );
      const { unmount } = renderCard();
      read[ended ?? "failed"] = await cardReads();
      unmount();
    }
    expect(read).toMatchInlineSnapshot(`
      {
        "canceled": [
          "Sign in to Outlook",
          "So I can read your mail.",
          "Signing in to Outlook stopped before it finished. You can sign in on the web instead, or try again.",
          "[Sign in on the web]",
          "[Try again]",
          "[Not now]",
        ],
        "expired": [
          "Sign in to Outlook",
          "So I can read your mail.",
          "The sign-in to Outlook timed out. You can sign in on the web instead, or try again.",
          "[Sign in on the web]",
          "[Try again]",
          "[Not now]",
        ],
        "failed": [
          "Sign in to Outlook",
          "So I can read your mail.",
          "Instrument couldn’t connect to Outlook. You can sign in on the web instead, or try again.",
          "[Sign in on the web]",
          "[Try again]",
          "[Not now]",
          "[Details]",
        ],
        "refused": [
          "Sign in to Outlook",
          "So I can read your mail.",
          "Outlook won’t let this account connect directly. You can sign in to Outlook on the web instead.",
          "[Sign in on the web]",
          "[Try again]",
          "[Not now]",
          "[Details]",
        ],
      }
    `);
  });

  it("keeps what the service said behind Details until it is opened", async () => {
    mocks.apps.mockResolvedValue(
      outlook({
        ended: "refused",
        error: "access_denied: AADSTS65001: not consented",
        status: "failed",
      }),
    );
    renderCard();

    const details = await screen.findByRole("button", { name: "Details" });
    expect(screen.queryByText(/AADSTS65001/)).toBeNull();
    fireEvent.click(details);
    expect(
      await screen.findByText("access_denied: AADSTS65001: not consented"),
    ).toBeTruthy();
  });

  it("moves the app to the web and opens its sign-in in the window's browser", async () => {
    mocks.apps.mockResolvedValue(
      outlook({ ended: "refused", error: "access_denied", status: "failed" }),
    );
    mocks.signInOnWeb.mockImplementation(() => {
      mocks.apps.mockResolvedValue(outlook({ status: "needs-sign-in" }, "web"));
      return Promise.resolve({ signIn: "https://outlook.office.com" });
    });
    const { queryClient } = renderCard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Sign in on the web" }),
    );
    await waitFor(() => {
      expect(openPage).toHaveBeenCalledWith("https://outlook.office.com");
    });
    expect(mocks.signInOnWeb.mock.calls[0]?.[0]).toEqual({ slug: "outlook" });
    await queryClient.invalidateQueries();

    expect(
      await screen.findByRole("button", { name: "Done signing in" }),
    ).toBeTruthy();
    expect(screen.getByText("Sign in to Outlook on the web")).toBeTruthy();
  });
});
