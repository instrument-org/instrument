import { renderWithProviders } from "@/tests/render";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hold, mocks } = vi.hoisted(() => {
  const held = () => {
    let resolve!: (value: unknown) => void;
    const promise = new Promise<unknown>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  return {
    hold: held,
    mocks: {
      cancelSignIn: vi.fn(),
      connect: vi.fn(),
      page: held(),
      signIn: vi.fn(),
      toast: vi.fn(),
    },
  };
});

vi.mock("@/client/lib/connect-toast", () => ({
  showConnectToast: mocks.toast,
}));

vi.mock("@/client/rpc/client", () => {
  const status = (key: string) => ({
    live: {
      status: {
        experimental_liveOptions: () => ({
          queryFn: () => ({ accounts: [] }),
          queryKey: [key],
        }),
      },
    },
  });
  return {
    rpcClient: {
      accountCheck: {
        cancel: { call: vi.fn() },
        connect: { call: mocks.connect },
      },
      chatgptAccount: {
        ...status("chatgpt"),
        cancelSignIn: { call: mocks.cancelSignIn },
        signIn: { call: mocks.signIn },
      },
      claudeAccount: status("claude"),
      grokAccount: status("grok"),
      planSignIn: {
        live: {
          page: {
            call: async () => {
              const { page } = mocks;
              return (async function* () {
                await Promise.resolve();
                yield await page.promise;
                await new Promise(() => undefined);
              })();
            },
          },
        },
      },
    },
  };
});

import { type WindowContextValue } from "./context";
import {
  PlanSignInBar,
  PlanSignInsWindow,
  usePlanSignIns,
} from "./plan-sign-in";
import {
  seedWindowTabsAtom,
  useWindowTabsChange,
  windowTabsAtom,
} from "./window-tabs";

const APP_TAB = {
  group: "g",
  href: "/apps/chatgpt",
  id: "app",
  kind: "screen" as const,
  openedAt: 1,
};
const PAGE_TAB = {
  group: "g",
  id: "page",
  kind: "page" as const,
  openedAt: 2,
};

function Surface({ where }: { where: "app" | "external" }) {
  const change = useWindowTabsChange();
  const { chatgpt } = usePlanSignIns();
  const seed = useSetAtom(seedWindowTabsAtom);
  useEffect(() => {
    seed({ activeByGroup: { g: "app" }, groups: {}, tabs: [APP_TAB] });
  }, [seed]);
  return (
    <>
      <button
        onClick={() => {
          chatgpt.start({
            accountId: undefined,
            openPage: () => {
              change("addPages", [
                { group: "g", id: PAGE_TAB.id, openedAt: 2 },
              ]);
              return PAGE_TAB.id;
            },
            slug: "chatgpt",
            where,
          });
        }}
        type="button"
      >
        Start
      </button>
      <button
        onClick={() => {
          change("closeTab", PAGE_TAB.id, {});
        }}
        type="button"
      >
        Close
      </button>
      <p data-testid="phase">{chatgpt.phase}</p>
      <p data-testid="answer">{chatgpt.outcome?.kind}</p>
      <div data-testid="bar">
        <PlanSignInBar tabId={PAGE_TAB.id} />
      </div>
    </>
  );
}

const showTab = vi.fn(() => true);

async function start(where: "app" | "external" = "app") {
  const signedIn = hold();
  const checked = hold();
  mocks.signIn.mockReturnValue(signedIn.promise);
  mocks.connect.mockReturnValue(checked.promise);
  const value = {
    ask: vi.fn(),
    browser: null,
    openPage: vi.fn(),
    openPath: vi.fn(),
    openScreen: vi.fn(),
    showTab,
  } satisfies WindowContextValue;
  const { store } = renderWithProviders(
    <PlanSignInsWindow value={value}>
      <Surface where={where} />
    </PlanSignInsWindow>,
  );
  fireEvent.click(screen.getByText("Start"));
  await act(async () => {
    mocks.page.resolve({ provider: "chatgpt", url: "https://example.com" });
    await Promise.resolve();
  });
  const tabs = () => store.get(windowTabsAtom).tabs.map((tab) => tab.id);
  if (where === "app") {
    await waitFor(() => {
      expect(tabs()).toEqual(["app", "page"]);
    });
  }
  return { checked, signedIn, tabs };
}

const bar = () => screen.getByTestId("bar").textContent;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.page = hold();
});

describe("a plan's sign-in in a tab", () => {
  it("has no bar while it waits, then says the plan connected until Done", async () => {
    const { checked, signedIn, tabs } = await start();
    expect(mocks.signIn.mock.calls[0]?.[0]).toMatchObject({ opensIn: "app" });
    expect(bar()).toBe("");

    await act(async () => {
      signedIn.resolve({ account: { id: "a" }, outcome: "signed-in" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(bar()).toBe("Checking your ChatGPT plan.");
    });

    await act(async () => {
      checked.resolve({ outcome: { kind: "ready" } });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(bar()).toBe("Your ChatGPT plan is connected.Done");
    });
    expect(mocks.toast).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Done"));
    expect(tabs()).toEqual(["app"]);
    expect(showTab).toHaveBeenCalledWith("app");
    expect(bar()).toBe("");
  });

  it("is canceled by closing its tab, with no words", async () => {
    await start();
    fireEvent.click(screen.getByText("Close"));
    await waitFor(() => {
      expect(screen.getByTestId("phase").textContent).toBe("idle");
    });
    expect(mocks.cancelSignIn).toHaveBeenCalledOnce();
    expect(screen.getByTestId("answer").textContent).toBe("");
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("closes its tab when it doesn't land", async () => {
    const { signedIn, tabs } = await start();
    await act(async () => {
      signedIn.resolve({ outcome: "declined" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(tabs()).toEqual(["app"]);
    });
    expect(screen.getByTestId("answer").textContent).toBe("declined");
  });
});

it("opens no tab for a sign-in sent to the person's own browser", async () => {
  const { tabs } = await start("external");
  expect(tabs()).toEqual(["app"]);
});
