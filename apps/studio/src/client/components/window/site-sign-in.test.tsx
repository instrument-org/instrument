import { renderWithProviders } from "@/tests/render";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SiteSignInBar,
  siteSignInsAtom,
  useSiteSignInsEnd,
} from "./site-sign-in";

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

function renderBars() {
  const rendered = renderWithProviders(<Bars />);
  act(() => {
    rendered.store.set(
      siteSignInsAtom,
      new Map([["notes", { chatId: CHAT, from: 1, tab: "tab-1" }]]),
    );
  });
  return rendered;
}

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
    expect(store.get(siteSignInsAtom).size).toBe(0);
    expect(screen.getByTestId("opened").textContent).toBe("");
    vi.useRealTimers();
  });

  it("goes at once when the app is skipped after its site opened", async () => {
    mocks.apps.mockResolvedValue(notes("declined", 2));
    const { store } = renderBars();

    await waitFor(() => {
      expect(store.get(siteSignInsAtom).size).toBe(0);
    });
  });

  it("stays for a skipped app whose site was opened to sign in after all", async () => {
    mocks.apps.mockResolvedValue(notes("declined", 1));
    renderBars();

    expect(await screen.findByRole("button", { name: "Done" })).toBeTruthy();
  });
});
