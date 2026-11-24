import { type BrowserTabsHandle } from "@/client/components/window/browser-tabs";
import {
  WindowContext,
  type WindowContextValue,
} from "@/client/components/window/context";
import { SiteSignInBar } from "@/client/components/window/site-sign-in";
import {
  seedWindowTabsAtom,
  windowTabsAtom,
} from "@/client/components/window/window-tabs";
import { renderInBrowser } from "@/tests/render-browser";
import { createStore, useSetAtom } from "jotai";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { ConnectAppCard } from "./tool-connect-app-card";

// Where a button stands when the one before it is pressed is the point of
// this card: a second press of a double-click must land on nothing that
// undoes or finishes the sign-in. Only a real layout can say where they stand.

const { mocks, mutation, query } = vi.hoisted(() => ({
  mocks: {
    markWebSignedIn: vi.fn<(input: object) => Promise<unknown>>(),
  },
  mutation: (mutationFn: (input: never) => Promise<unknown>) => ({
    mutationOptions: (options: object) => ({ ...options, mutationFn }),
  }),
  query: (key: string, queryFn: () => Promise<unknown>) => ({
    experimental_liveOptions: () => ({ queryFn, queryKey: [key] }),
  }),
}));

const APPS = [
  ["notes", "Notes", "web"],
  ["mail", "Mail", "mcp"],
] as const;

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    apps: {
      allow: mutation(() => Promise.resolve()),
      cancelOAuth: mutation(() => Promise.resolve()),
      dismiss: mutation(() => Promise.resolve()),
      live: {
        catalogMarks: query("catalogMarks", () => Promise.resolve([])),
        list: query("apps", () =>
          Promise.resolve({
            apps: APPS.map(([slug, name, type]) => ({
              authKind: "oauth",
              connection: { status: "needs-sign-in", updatedAt: 1 },
              credentialOrigin: `https://${slug}.example.com`,
              hasCredential: false,
              keys: [{ isSaved: false }],
              name,
              ...(type === "web"
                ? { signIn: `https://${slug}.example.com/login` }
                : {}),
              site: `https://${slug}.example.com`,
              slug,
              status: "needs-sign-in",
              type,
            })),
          }),
        ),
      },
      markWebSignedIn: mutation(mocks.markWebSignedIn),
      setCredential: mutation(() => Promise.resolve()),
      signInOnWeb: mutation(() => Promise.resolve()),
      startOAuth: mutation(() =>
        Promise.resolve({ status: "started", url: "https://login.example" }),
      ),
    },
    utils: {
      browserOpenTarget: {
        queryOptions: (options: object) => ({
          ...options,
          queryFn: () => Promise.resolve({ appName: "Safari" }),
          queryKey: ["browser"],
        }),
      },
      openExternalLink: mutation(() => Promise.resolve()),
    },
  },
}));

async function showCard(width: number, slugs: readonly string[]) {
  const appWindow = {
    ask: vi.fn(),
    // Only whether there is one is read here.
    browser: {} as BrowserTabsHandle,
    openPage: () => "tab-1",
    openPath: vi.fn(),
    openScreen: vi.fn(),
    showTab: () => true,
  } satisfies WindowContextValue;
  const store = createStore();
  // The tab the window's open answers, which the sign-in is marked on.
  function Tab() {
    const seed = useSetAtom(seedWindowTabsAtom);
    useEffect(() => {
      seed({
        activeByGroup: { g: "tab-1" },
        groups: {},
        tabs: [{ group: "g", id: "tab-1", kind: "page", openedAt: 1 }],
      });
    }, [seed]);
    return null;
  }
  await renderInBrowser(
    <WindowContext.Provider value={appWindow}>
      <Tab />
      <div className="@container/transcript" style={{ width }}>
        <ConnectAppCard
          reason="So I can read your notes and mail."
          rows={APPS.filter(([slug]) => slugs.includes(slug)).map(
            ([slug, name]) => ({
              kind: "sign-in",
              name,
              slug,
              state: "asked",
            }),
          )}
        />
        {/* Under the card here, so it coming up moves nothing measured. */}
        <SiteSignInBar tabId="tab-1" />
      </div>
    </WindowContext.Provider>,
    { store },
  );
  return store;
}

const button = (name: string) =>
  page.getByRole("button", { exact: true, name });
const boxOf = (name: string) => button(name).element().getBoundingClientRect();
/** The button a press at the middle of this box would land on now. */
const pressedAt = (box: DOMRect) =>
  document
    .elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    ?.closest("button");
describe.each([720, 380])("a web app's row in a %spx chat", (width) => {
  it("shows the page from where Sign in was pressed, and has Done on the bar", async () => {
    const store = await showCard(width, ["notes", "mail"]);
    await expect.element(button("Sign in")).toBeVisible();
    const signIn = boxOf("Sign in");

    await button("Sign in").click();
    await expect.element(button("Show page")).toBeVisible();
    expect(pressedAt(signIn)?.textContent).toBe("Show page");
    expect(
      store.get(windowTabsAtom).tabs.find((tab) => tab.id === "tab-1")?.signIn,
    ).toEqual({ from: 1, slug: "notes" });

    await button("Done").click();
    expect(mocks.markWebSignedIn.mock.lastCall?.[0]).toEqual({ slug: "notes" });
  });
});

describe.each([720, 380])("a sign-in's row in a %spx chat", (width) => {
  it.each([
    ["Sign in with Safari", "Sign in here"],
    ["Sign in here", "Sign in with Safari"],
  ])(
    "keeps %s where it was pressed, off, and puts Cancel in the other's place",
    async (pressed, other) => {
      await showCard(width, ["mail"]);
      await expect.element(button(pressed)).toBeVisible();
      const at = boxOf(pressed);
      const otherAt = boxOf(other);

      await button(pressed).click();
      await expect
        .element(page.getByRole("button", { name: "Cancel" }))
        .toBeVisible();
      expect(pressedAt(at)).toBeDisabled();
      expect(pressedAt(otherAt)?.textContent).toContain("Cancel");
    },
  );
});
