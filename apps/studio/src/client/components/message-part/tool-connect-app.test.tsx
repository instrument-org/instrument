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
    signIn: vi.fn<() => Promise<unknown>>(),
    declineSignIn:
      vi.fn<(input: { askId: string; id: string }) => Promise<unknown>>(),
    dismiss: vi.fn<(input: { slug: string }) => Promise<unknown>>(),
    signInOnWeb: vi.fn<(input: { slug: string }) => Promise<unknown>>(),
    startOAuth:
      vi.fn<
        (input: { chatId?: string; opensIn: string }) => Promise<unknown>
      >(),
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
    workspace: {
      chats: {
        declineSignIn: {
          mutationOptions: (options: object) => ({
            ...options,
            mutationFn: mocks.declineSignIn,
          }),
        },
        live: { signIn: query("signIn", mocks.signIn) },
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
    status: "failed" | "needs-key" | "needs-sign-in";
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
        site: "https://outlook.office.com",
        ...(type === "web"
          ? { signIn: "https://outlook.office.com", type }
          : { type }),
        slug: "outlook",
        standing: connection.status,
      },
    ],
  };
}

function renderCard(
  chatId?: string,
  output?: Extract<
    Parameters<typeof ToolConnectApp>[0]["part"],
    { state: "output-available" }
  >["output"],
) {
  const window = {
    ...(chatId === undefined ? {} : { chatId: ChatIdSchema.parse(chatId) }),
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
            id: PART_ID,
            messageId: StoreId.newMessageId(),
            sessionId: StoreId.newSessionId(),
          },
          // Stored bare, as a call before cards with several apps did.
          output: output ?? {
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

const PART_ID = StoreId.newPartId();

/** The card's lines and buttons, lines first. */
function reads(): string[] {
  return [
    ...screen
      .getAllByText(/./, { selector: "p, span.truncate, span.text-xs" })
      .map((line) => line.textContent ?? ""),
    ...screen
      .getAllByRole("button")
      .map((button) => `[${button.textContent ?? ""}]`),
  ];
}

beforeEach(() => {
  mocks.signIn.mockReset();
  mocks.signIn.mockResolvedValue(null);
  mocks.declineSignIn.mockReset();
  mocks.apps.mockReset();
  mocks.dismiss.mockReset();
  mocks.signInOnWeb.mockReset();
  mocks.startOAuth.mockReset();
  openPage.mockReset();
});

describe("the card for one app", () => {
  it("is the same card with one row, leading with the person's own browser", async () => {
    mocks.apps.mockResolvedValue(outlook({ status: "needs-sign-in" }));
    renderCard();

    const own = await screen.findByRole("button", {
      name: "Sign in with Safari",
    });
    expect(own.getAttribute("data-variant")).toBe("brand");
    expect(reads()).toMatchInlineSnapshot(`
      [
        "Connect Outlook",
        "So I can read your mail.",
        "Outlook",
        "[Not now]",
        "[Sign in with Safari]",
        "[Sign in here]",
      ]
    `);
  });

  it("opens a key's field by itself, with no press to get to it", async () => {
    mocks.apps.mockResolvedValue(outlook({ status: "needs-key" }));
    renderCard(undefined, {
      kind: "key",
      name: "Outlook",
      slug: "outlook",
      state: "asked",
    });

    expect(
      await screen.findByPlaceholderText("Paste the Outlook key"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add key" })).toBeNull();
    expect(await screen.findByText(/The key goes only to/)).toBeTruthy();
  });

  it("says an app with no sign-in is being tested, and offers nothing to press", async () => {
    mocks.apps.mockResolvedValue(outlook({ status: "needs-sign-in" }));
    renderCard(undefined, {
      kind: "none",
      name: "Outlook",
      slug: "outlook",
      state: "asked",
    });

    expect(await screen.findByText(/doesn’t need a sign-in/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sign in/ })).toBeNull();
  });

  it("folds to the account once connected", async () => {
    mocks.apps.mockResolvedValue({
      apps: [
        {
          ...outlook({ status: "needs-sign-in" }).apps[0],
          connection: {
            account: "you@example.com",
            status: "connected",
            updatedAt: 1,
          },
          standing: "connected",
        },
      ],
    });
    renderCard();

    expect(await screen.findByText("Outlook connected")).toBeTruthy();
    expect(screen.getByText("Connected as you@example.com")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("how a sign-in ended", () => {
  const START = ["[Not now]", "[Sign in with Safari]", "[Sign in here]"];
  const HEAD = ["Connect Outlook", "So I can read your mail.", "Outlook"];
  it.each([
    ["stopped, back to the start", { status: "needs-sign-in" }, [], START],
    [
      "timed out, back to the start with a line",
      { ended: "expired", error: "lapsed", status: "needs-sign-in" },
      ["That sign-in timed out."],
      START,
    ],
    [
      "failed, another try or the app's site",
      { error: "HTTP 500: registration failed", status: "failed" },
      ["Instrument couldn’t connect to Outlook."],
      ["[Not now]", "[Try again with Safari]", "[Sign in here]"],
    ],
    [
      "refused, only the app's site",
      { ended: "refused", error: "access_denied", status: "failed" },
      ["Outlook won’t let this account connect directly."],
      ["[Not now]", "[Sign in here]"],
    ],
  ] as const)("%s", async (_, connection, line, buttons) => {
    mocks.apps.mockResolvedValue(outlook(connection));
    renderCard();

    await waitFor(
      () => {
        expect(reads()).toEqual([...HEAD, ...line, ...buttons]);
      },
      { interval: 1 },
    );
  });

  it("offers the same sign-in again when an app has no site to go to", async () => {
    const withoutSite = (connection: Parameters<typeof outlook>[0]) => ({
      apps: outlook(connection).apps.map((app) => ({
        ...app,
        site: undefined,
      })),
    });
    mocks.apps.mockResolvedValue(
      withoutSite({ error: "HTTP 500", status: "failed" }),
    );
    const { unmount } = renderCard();
    await screen.findByText("Instrument couldn’t connect to Outlook.");
    await screen.findByRole("button", { name: "Try again with Safari" });
    expect(screen.getByRole("button", { name: "Sign in here" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in here" }));
    await waitFor(
      () => {
        expect(mocks.startOAuth.mock.calls[0]?.[0]).toMatchObject({
          opensIn: "app",
        });
      },
      { interval: 1 },
    );
    expect(mocks.signInOnWeb).not.toHaveBeenCalled();
    unmount();

    mocks.apps.mockResolvedValue(
      withoutSite({
        ended: "refused",
        error: "access_denied",
        status: "failed",
      }),
    );
    renderCard();
    await screen.findByText("Outlook won’t let this account connect directly.");
    expect(
      screen.queryByRole("button", { name: /Sign in here|Try again/ }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
  });

  it("never shows the service's own words, which go to the agent", async () => {
    mocks.apps.mockResolvedValue(
      outlook({
        ended: "refused",
        error: "access_denied: AADSTS65001: not consented",
        status: "failed",
      }),
    );
    renderCard();

    await screen.findByText("Outlook won’t let this account connect directly.");
    expect(screen.queryByText(/AADSTS65001/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  });

  it("moves a refused app to its site, then asks for the word that the sign-in is done", async () => {
    mocks.apps.mockResolvedValue(
      outlook({ ended: "refused", error: "access_denied", status: "failed" }),
    );
    mocks.signInOnWeb.mockImplementation(() => {
      mocks.apps.mockResolvedValue(outlook({ status: "needs-sign-in" }, "web"));
      return Promise.resolve({ signIn: "https://outlook.office.com" });
    });
    const { queryClient } = renderCard();

    await screen.findByText("Outlook won’t let this account connect directly.");
    fireEvent.click(screen.getByRole("button", { name: "Sign in here" }));
    await waitFor(
      () => {
        expect(openPage).toHaveBeenCalledWith("https://outlook.office.com");
      },
      { interval: 1 },
    );
    expect(mocks.signInOnWeb.mock.calls[0]?.[0]).toEqual({ slug: "outlook" });
    await queryClient.invalidateQueries();

    expect(
      await screen.findByRole("button", { name: "Done signing in" }),
    ).toBeTruthy();
  });

  it("sends another try after a failure to the user's own browser", async () => {
    mocks.apps.mockResolvedValue(
      outlook({ error: "HTTP 500", status: "failed" }),
    );
    mocks.startOAuth.mockResolvedValue({
      status: "started",
      url: "https://login.example",
    });
    renderCard();

    // Looked up again at the click: the row can draw again after the button
    // first appears, leaving an earlier lookup detached.
    await screen.findByRole("button", { name: "Try again with Safari" });
    fireEvent.click(
      screen.getByRole("button", { name: "Try again with Safari" }),
    );
    await waitFor(
      () => {
        expect(mocks.startOAuth).toHaveBeenCalled();
      },
      { interval: 1 },
    );
    expect(mocks.startOAuth.mock.calls[0]?.[0]).toMatchObject({
      opensIn: "external",
    });
    expect(openPage).not.toHaveBeenCalled();
    // The failure stays until it is answered, but the row is waiting now.
    expect(
      await screen.findByText("Finish signing in in Safari."),
    ).toBeTruthy();
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
            id: PART_ID,
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

describe("the card asking for several apps", () => {
  it("marks what is connected, lights the next sign-in, and offers to skip the rest", async () => {
    mocks.apps.mockResolvedValue(google({ drive: "connected" }));
    renderGroupCard();

    await screen.findByText("Connected as you@example.com");
    expect(reads()).toMatchInlineSnapshot(`
      [
        "Connect 3 apps",
        "So I can read your files and email.",
        "Google Drive",
        "Connected as you@example.com",
        "Google Docs",
        "Gmail",
        "[Skip the rest]",
        "[Sign in with Safari]",
        "[Sign in here]",
        "[Sign in with Safari]",
        "[Sign in here]",
      ]
    `);
  });

  it("offers Not now until something is answered", async () => {
    mocks.apps.mockResolvedValue(google({}));
    renderGroupCard();

    await screen.findByRole("button", { name: "Not now" });
    expect(reads()).toMatchInlineSnapshot(`
      [
        "Connect 3 apps",
        "So I can read your files and email.",
        "Google Drive",
        "Google Docs",
        "Gmail",
        "[Not now]",
        "[Sign in with Safari]",
        "[Sign in here]",
        "[Sign in with Safari]",
        "[Sign in here]",
        "[Sign in with Safari]",
        "[Sign in here]",
      ]
    `);
  });

  it("skips every app still open with Skip the rest", async () => {
    mocks.apps.mockResolvedValue(google({ drive: "connected" }));
    mocks.dismiss.mockResolvedValue(undefined);
    renderGroupCard();

    await screen.findByText("Connected as you@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Skip the rest" }));
    await waitFor(
      () => {
        expect(mocks.dismiss).toHaveBeenCalledTimes(2);
      },
      { interval: 1 },
    );
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
    expect(reads()).toMatchInlineSnapshot(`
      [
        "2 apps connected",
        "You skipped Google Docs.",
        "Google Docs",
        "[Sign in with Safari]",
        "[Sign in here]",
      ]
    `);
  });

  it("signs in to a skipped app from the folded card on behalf of its chat, so the chat hears it", async () => {
    mocks.apps.mockResolvedValue(
      google({ docs: "declined", drive: "connected", gmail: "connected" }),
    );
    mocks.startOAuth.mockResolvedValue({
      status: "started",
      url: "https://login.example",
    });
    renderGroupCard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Sign in with Safari" }),
    );
    await waitFor(
      () => {
        expect(mocks.startOAuth).toHaveBeenCalled();
      },
      { interval: 1 },
    );
    expect(mocks.startOAuth.mock.calls[0]?.[0]).toMatchObject({
      chatId: "2026-10-27-google",
      slug: "docs",
    });
  });

  it.each([
    ["Sign in with Safari", "external", "Finish signing in in Safari."],
    ["Sign in here", "app", "Finish signing in on the page that opened."],
  ])(
    "%s opens there and says where the wait is",
    async (name, opensIn, line) => {
      mocks.apps.mockResolvedValue(
        google({ docs: "connected", drive: "connected" }),
      );
      mocks.startOAuth.mockResolvedValue({
        status: "started",
        url: "https://login.example",
      });
      renderGroupCard();

      fireEvent.click(await screen.findByRole("button", { name }));
      expect(await screen.findByText(line)).toBeDefined();
      expect(mocks.startOAuth.mock.calls[0]?.[0]).toMatchObject({
        opensIn,
        slug: "gmail",
      });
    },
  );
});

describe("a sign-in card another computer put up", () => {
  /** The call's sign-in as the asking computer, "Studio Mac", last wrote it. */
  const asked = (extra: object = {}) => ({
    answerable: true,
    apps: [{ name: "Outlook", slug: "outlook", standing: "waiting" }],
    askedAt: new Date(1),
    askers: [],
    computer: "Studio Mac",
    device: "dev_0WNER000",
    here: false,
    id: "ask-1",
    kind: "sign-in",
    live: true,
    messageId: StoreId.newMessageId(),
    partId: PART_ID,
    ...extra,
  });

  it("draws its rows as that computer wrote them, and says Not now from here", async () => {
    mocks.apps.mockResolvedValue(outlook({ status: "needs-sign-in" }));
    mocks.signIn.mockResolvedValue(asked());
    mocks.declineSignIn.mockResolvedValue(undefined);
    renderCard("2026-10-31-mail");

    expect(
      await screen.findByText("You can sign in on Studio Mac."),
    ).toBeDefined();
    // Titled as the computer that asked titles it.
    expect(screen.getByText("Sign in to Outlook")).toBeDefined();
    expect(screen.getByText("Not signed in yet")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(
      () => {
        expect(mocks.declineSignIn).toHaveBeenCalledWith(
          { askId: "ask-1", id: "2026-10-31-mail" },
          expect.anything(),
        );
      },
      { interval: 1 },
    );
  });

  // Written past, or settled with an app skipped: still that computer's
  // card, so this one never offers to sign in, which would keep the
  // credentials here and wake nobody.
  it("never offers this computer's sign-in once it no longer waits", async () => {
    mocks.apps.mockResolvedValue(outlook({ status: "needs-sign-in" }));
    mocks.signIn.mockResolvedValue(
      asked({
        answerable: false,
        apps: [{ name: "Outlook", slug: "outlook", standing: "declined" }],
        live: false,
      }),
    );
    renderCard("2026-10-31-mail");

    expect(await screen.findByText("Skipped")).toBeDefined();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  // The card was trimmed to the one app the person had not answered, which
  // needs a key, while the call asked a sign-in of its first.
  it("titles a card trimmed to one app by what the call asked of that app", async () => {
    mocks.apps.mockResolvedValue(outlook({ status: "needs-sign-in" }));
    mocks.signIn.mockResolvedValue(
      asked({
        apps: [{ name: "OpenAI", slug: "openai", standing: "waiting" }],
      }),
    );
    renderCard("2026-10-31-mail", {
      apps: [
        { kind: "sign-in", name: "Outlook", slug: "outlook", state: "asked" },
        { kind: "key", name: "OpenAI", slug: "openai", state: "asked" },
      ],
    });

    expect(await screen.findByText("OpenAI needs a key")).toBeDefined();
  });

  it("titles an app moved to the web as signing in there", async () => {
    mocks.apps.mockResolvedValue(outlook({ status: "needs-sign-in" }, "web"));
    mocks.signIn.mockResolvedValue(asked());
    renderCard("2026-10-31-mail");

    expect(
      await screen.findByText("Sign in to Outlook on the web"),
    ).toBeDefined();
  });

  it("draws nothing while it is not known which computer asked", async () => {
    mocks.apps.mockResolvedValue(outlook({ status: "needs-sign-in" }));
    mocks.signIn.mockReturnValue(new Promise(() => {}));
    const { container } = renderCard("2026-10-31-mail");

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.textContent).toBe("");
  });

  it("offers this computer's own sign-in on a call it asked", async () => {
    mocks.apps.mockResolvedValue(outlook({ status: "needs-sign-in" }));
    mocks.signIn.mockResolvedValue(asked({ here: true }));
    renderCard("2026-10-31-mail");

    expect(
      await screen.findAllByRole("button", { name: /sign in/i }),
    ).not.toEqual([]);
  });
});
