import { type BrowserTabsHandle } from "@/client/components/window/browser-tabs";
import {
  WindowContext,
  type WindowContextValue,
} from "@/client/components/window/context";
import { renderWithProviders } from "@/tests/render";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToolConnectApp } from "./tool-connect-app";

const { mocks, mutation, query } = vi.hoisted(() => ({
  mocks: {
    apps: vi.fn<() => Promise<unknown>>(),
    dismiss: vi.fn<(input: { slug: string }) => Promise<unknown>>(),
    signInOnWeb: vi.fn<(input: { slug: string }) => Promise<unknown>>(),
    startOAuth:
      vi.fn<(input: { chatId?: string; opensIn: string }) => Promise<unknown>>(),
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
      dismiss: {
        mutationOptions: (options: object) => ({
          ...options,
          mutationFn: mocks.dismiss,
        }),
      },
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
      startOAuth: {
        mutationOptions: (options: object) => ({
          ...options,
          mutationFn: mocks.startOAuth,
        }),
      },
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
          input: { reason: "So I can read your mail.", slugs: ["outlook"] },
          metadata: {
            createdAt: new Date(1),
            endedAt: new Date(2),
            id: StoreId.newPartId(),
            messageId: StoreId.newMessageId(),
            sessionId: StoreId.newSessionId(),
          },
          // Stored bare, as a call before cards with several apps did.
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
  mocks.dismiss.mockReset();
  mocks.signInOnWeb.mockReset();
  mocks.startOAuth.mockReset();
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
          "[Sign in with Safari]",
          "[Not now]",
        ],
        "expired": [
          "Sign in to Outlook",
          "So I can read your mail.",
          "The sign-in to Outlook timed out. You can sign in on the web instead, or try again.",
          "[Sign in on the web]",
          "[Try again]",
          "[Sign in with Safari]",
          "[Not now]",
        ],
        "failed": [
          "Sign in to Outlook",
          "So I can read your mail.",
          "Instrument couldn’t connect to Outlook. You can sign in on the web instead, or try again.",
          "[Sign in on the web]",
          "[Try again]",
          "[Sign in with Safari]",
          "[Not now]",
          "[Details]",
        ],
        "refused": [
          "Sign in to Outlook",
          "So I can read your mail.",
          "Outlook won’t let this account connect directly. You can sign in to Outlook on the web instead.",
          "[Sign in on the web]",
          "[Try again]",
          "[Sign in with Safari]",
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

  it("sends another try to the user's own browser when they pick it", async () => {
    mocks.apps.mockResolvedValue(
      outlook({ ended: "expired", status: "failed" }),
    );
    mocks.startOAuth.mockResolvedValue({
      status: "started",
      url: "https://login.example",
    });
    renderCard();

    // Looked up again at the click: the row can draw again after the button
    // first appears, leaving an earlier lookup detached.
    await screen.findByRole("button", { name: "Sign in with Safari" });
    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with Safari" }),
    );
    await waitFor(() => {
      expect(mocks.startOAuth).toHaveBeenCalled();
    });
    expect(mocks.startOAuth.mock.calls[0]?.[0]).toMatchObject({
      opensIn: "external",
    });
    expect(openPage).not.toHaveBeenCalled();
  });
});

const GOOGLE = [
  ["drive", "Google Drive"],
  ["docs", "Google Docs"],
  ["gmail", "Gmail"],
] as const;

/** The Google apps as the Apps list draws them, each standing as given. */
function google(standings: Record<string, string>) {
  return {
    apps: GOOGLE.map(([slug, name]) => {
      const standing = standings[slug] ?? "needs-sign-in";
      return {
        authKind: "oauth",
        connection: {
          ...(standing === "connected" ? { account: "you@example.com" } : {}),
          status: standing,
          updatedAt: 1,
        },
        credentialOrigin: `https://${slug}.example.com`,
        dir: `/apps/${name}`,
        endpoint: `https://${slug}.example.com/mcp`,
        hasCredential: false,
        name,
        slug,
        standing,
        type: "mcp",
      };
    }),
  };
}

function renderGroupCard() {
  const window = {
    ask: vi.fn(),
    browser: {} as BrowserTabsHandle,
    chatId: ChatIdSchema.parse("2026-10-27-google"),
    focusComposer: vi.fn(),
    openPage,
    openPath: vi.fn(),
    openScreen: vi.fn(),
  } satisfies WindowContextValue;
  return renderWithProviders(
    <WindowContext.Provider value={window}>
      <ToolConnectApp
        part={{
          input: {
            reason: "So I can read your files and email.",
            slugs: GOOGLE.map(([slug]) => slug),
          },
          metadata: {
            createdAt: new Date(1),
            endedAt: new Date(2),
            id: StoreId.newPartId(),
            messageId: StoreId.newMessageId(),
            sessionId: StoreId.newSessionId(),
          },
          output: {
            apps: GOOGLE.map(([slug, name]) => ({
              kind: "sign-in" as const,
              name,
              slug,
              state: "asked" as const,
            })),
          },
          state: "output-available",
          toolCallId: "call-2",
          type: "tool-connect_app",
        }}
      />
    </WindowContext.Provider>,
  );
}

/** The card's lines and buttons, in the order they read. */
function groupReads(): string[] {
  return [
    ...screen
      .getAllByText(/./, { selector: "p, span.truncate, span.text-xs" })
      .map((line) => line.textContent ?? ""),
    ...screen
      .getAllByRole("button")
      .map((button) => `[${button.textContent ?? ""}]`),
  ];
}

describe("the card asking for several apps", () => {
  it("counts what is connected, lights the next sign-in, and offers to skip the rest", async () => {
    mocks.apps.mockResolvedValue(google({ drive: "connected" }));
    renderGroupCard();

    await screen.findByText("1 of 3 connected");
    expect(groupReads()).toMatchInlineSnapshot(`
      [
        "Connect 3 apps",
        "So I can read your files and email.",
        "1 of 3 connected",
        "Google Drive",
        "Connected as you@example.com",
        "Google Docs",
        "Gmail",
        "Waiting on 2 more.",
        "[Sign in]",
        "[Skip]",
        "[Sign in]",
        "[Skip]",
        "[Skip the rest]",
      ]
    `);
  });

  it("skips every app still open with Skip the rest", async () => {
    mocks.apps.mockResolvedValue(google({ drive: "connected" }));
    mocks.dismiss.mockResolvedValue(undefined);
    renderGroupCard();

    await screen.findByText("1 of 3 connected");
    fireEvent.click(screen.getByRole("button", { name: "Skip the rest" }));
    await waitFor(() => {
      expect(mocks.dismiss).toHaveBeenCalledTimes(2);
    });
    expect(mocks.dismiss.mock.calls.map(([input]) => input.slug)).toEqual([
      "docs",
      "gmail",
    ]);
  });

  it("folds to one line once every app is answered, keeping a way to sign in to the skipped one", async () => {
    mocks.apps.mockResolvedValue(
      google({ docs: "declined", drive: "connected", gmail: "connected" }),
    );
    renderGroupCard();

    await screen.findByText("2 apps connected");
    expect(groupReads()).toMatchInlineSnapshot(`
      [
        "2 apps connected",
        "You skipped Google Docs.",
        "Google Docs",
        "[Sign in]",
      ]
    `);
  });

  it("signs in to a skipped app from the folded card on behalf of its chat, so the chat hears it", async () => {
    mocks.apps.mockResolvedValue(
      google({ docs: "declined", drive: "connected", gmail: "connected" }),
    );
    mocks.startOAuth.mockResolvedValue({ status: "started", url: "https://login.example" });
    renderGroupCard();

    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(mocks.startOAuth).toHaveBeenCalled();
    });
    expect(mocks.startOAuth.mock.calls[0]?.[0]).toMatchObject({
      chatId: "2026-10-27-google",
      slug: "docs",
    });
  });
});
