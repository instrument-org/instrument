import { useSetAtom } from "jotai";
import { renderWithProviders } from "@/tests/render";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SiteSignInBar, useSiteSignInsEnd } from "./site-sign-in";
import { seedWindowTabsAtom, windowTabsAtom } from "./window-tabs";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    apps: vi.fn<() => Promise<unknown>>(),
    markWebSignedIn: vi.fn<(input: object) => Promise<unknown>>(),
  },
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    apps: {
      live: {
        list: {
          experimental_liveOptions: () => ({
            queryFn: mocks.apps,
            queryKey: ["apps"],
          }),
        },
      },
      markWebSignedIn: {
        mutationOptions: (options: object) => ({
          ...options,
          mutationFn: mocks.markWebSignedIn,
        }),
      },
    },
  },
}));

const CHAT = ChatIdSchema.parse("chat-1");

function notes(status: string, updatedAt = 1) {
  return {
    apps: [
      {
        connection: { status, updatedAt },
        name: "Notes",
        signIn: "https://notes.example.com/login",
        slug: "notes",
        status,
        type: "web",
      },
    ],
  };
}

function Bars() {
  useSiteSignInsEnd();
  return (
    <>
      <div data-testid="opened">
        <SiteSignInBar tabId="tab-1" />
      </div>
      <div data-testid="other">
        <SiteSignInBar tabId="tab-2" />
      </div>
    </>
  );
}

/** The window with the site's page open in a tab marked as Notes' sign-in, and another tab. */
function Tabs() {
  const seed = useSetAtom(seedWindowTabsAtom);
  useEffect(() => {
    seed({
      activeByGroup: { g: "tab-1" },
      groups: {},
      tabs: [
        {
          group: "g",
          id: "tab-1",
          kind: "page",
          openedAt: 1,
          signIn: { chatId: CHAT, from: 1, slug: "notes" },
        },
        { group: "g", id: "tab-2", kind: "page", openedAt: 2 },
      ],
    });
  }, [seed]);
  return <Bars />;
}

function renderBars() {
  return renderWithProviders(<Tabs />);
}

const marked = (store: ReturnType<typeof renderBars>["store"]) =>
  store.get(windowTabsAtom).tabs.filter((tab) => tab.signIn !== undefined);

beforeEach(() => {
  mocks.apps.mockReset();
  mocks.markWebSignedIn.mockReset();
  mocks.markWebSignedIn.mockResolvedValue(undefined);
});

describe("the bar over a sign-in page", () => {
  it("is only over the tab the sign-in opened, and Done answers for the chat that asked", async () => {
    mocks.apps.mockResolvedValue(notes("needs-sign-in"));
    renderBars();

    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    expect(screen.getByTestId("opened").textContent).toBe(
      "When you’re signed in to Notes, press Done.Done",
    );
    expect(screen.getByTestId("other").textContent).toBe("");
    await waitFor(() => {
      expect(mocks.markWebSignedIn.mock.calls[0]?.[0]).toEqual({
        chatId: "chat-1",
        slug: "notes",
      });
    });
  });

  it("says the app connected, then goes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.apps.mockResolvedValue(notes("connected", 2));
    const { store } = renderBars();

    expect(await screen.findByText("Notes is connected.")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(marked(store)).toEqual([]);
    expect(screen.getByTestId("opened").textContent).toBe("");
    // The tab stays, an ordinary one.
    expect(store.get(windowTabsAtom).tabs).toHaveLength(2);
    vi.useRealTimers();
  });

  it("goes at once when the app is skipped after its site opened", async () => {
    mocks.apps.mockResolvedValue(notes("declined", 2));
    const { store } = renderBars();

    await waitFor(() => {
      expect(marked(store)).toEqual([]);
    });
  });

  it("stays for a skipped app whose site was opened to sign in after all", async () => {
    mocks.apps.mockResolvedValue(notes("declined", 1));
    renderBars();

    expect(await screen.findByRole("button", { name: "Done" })).toBeTruthy();
  });
});
