import { type Cookie } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cookieSnapshot,
  dropSignInCookies,
  finishSignInCookies,
  isSignInTab,
  noteSignInCommit,
  noteSignInPage,
  noteSignInOpened,
  signInCookieSites,
  startSignInCookies,
} from "./sign-in-cookies";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn<() => Promise<Cookie[]>>(),
}));

vi.mock("@instrument-org/workspace/electron", () => ({
  getBrowserSessionDir: vi.fn(),
}));
vi.mock("./guest-session", () => ({
  configureGuestSession: () => ({ cookies: { get: mocks.cookies } }),
}));

function cookie(
  domain: string,
  name: string,
  value: string,
  path = "/",
): Cookie {
  return { domain, name, path, sameSite: "lax", value };
}

/** Grok's own addresses: its site, and the sign-in page the directory names. */
const GROK = ["https://grok.com", "https://grok.com/sign-in"];

/** Grok's sign-in page as the window loads it, which the server sends on to xAI's. */
const FIRST_LOAD = [
  "https://grok.com/sign-in",
  "https://accounts.x.ai/check-login?redirect=grok-com",
];

/** What the browser held as the sign-in started: a search earlier, and the agent's look at grok.com. */
const BEFORE = [
  cookie(".google.com", "NID", "511=a1"),
  cookie(".google.com", "AEC", "AVh1"),
  cookie(".grok.com", "__cf_bm", "cf1"),
  cookie("grok.com", "i18nextLng", "en"),
];

/** Grok's sign-in through X's authorize page and back, as the tab's main frame went. */
const THROUGH_X = [
  ...FIRST_LOAD,
  "https://x.com/i/oauth2/authorize?response_type=code&client_id=Z3J",
  "https://x.com/i/flow/login?redirect_after_login=%2Fi%2Foauth2%2Fauthorize",
  "https://accounts.x.ai/oauth2/callback?code=c0de&state=5tate",
  "https://grok.com/",
];

/** What signing in to X leaves on x.com. */
const X_SIGNED_IN = [
  cookie(".x.com", "guest_id", "v1%3A1"),
  cookie(".x.com", "personalization_id", "v1_p1"),
  cookie(".x.com", "kdt", "kdt1"),
  cookie(".x.com", "auth_token", "token1"),
  cookie(".x.com", "ct0", "ct1"),
  cookie(".x.com", "twid", "u%3D1"),
  cookie("x.com", "lang", "en"),
];

/** What Grok's own sign-in leaves on its sites. */
const GROK_SIGNED_IN = [
  cookie(".grok.com", "__cf_bm", "cf2"),
  cookie("grok.com", "i18nextLng", "en"),
  cookie(".grok.com", "sso", "jwt1"),
  cookie(".grok.com", "sso-rw", "jwt1"),
  cookie(".x.ai", "sso", "jwt1"),
];

/** What ad and analytics frames on those pages leave, and a search cookie rotated meanwhile. */
const FROM_FRAMES = [
  cookie(".doubleclick.net", "IDE", "AHWqT1"),
  cookie(".doubleclick.net", "test_cookie", "CheckForPermission"),
  cookie(".google-analytics.com", "_gid", "GA1.2.1"),
  cookie(".google.com", "NID", "511=a2"),
  cookie(".google.com", "AEC", "AVh1"),
];

const hash = (value: string) => `#${value}`;

function sites({
  after,
  before,
  firstLoad = FIRST_LOAD,
  pages,
}: {
  after: Cookie[];
  before: Cookie[];
  firstLoad?: string[];
  pages: string[];
}) {
  return signInCookieSites({
    after: cookieSnapshot(after, hash),
    appAddresses: GROK,
    before: cookieSnapshot(before, hash),
    firstLoad,
    pages,
  });
}

describe("signInCookieSites", () => {
  it("names x.com after a sign-in to Grok through X", () => {
    expect(
      sites({
        after: [...X_SIGNED_IN, ...GROK_SIGNED_IN, ...BEFORE.slice(0, 2)],
        before: BEFORE,
        pages: THROUGH_X,
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "cookies": 7,
          "site": "x.com",
        },
      ]
    `);
  });

  it("leaves out ad and analytics sites that set cookies with no page of theirs loaded", () => {
    expect(
      sites({
        after: [...X_SIGNED_IN, ...GROK_SIGNED_IN, ...FROM_FRAMES],
        before: BEFORE,
        pages: THROUGH_X,
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "cookies": 7,
          "site": "x.com",
        },
      ]
    `);
  });

  it("names nothing for a sign-in on the app's own sites alone", () => {
    expect(
      sites({
        after: [...GROK_SIGNED_IN, ...FROM_FRAMES],
        before: BEFORE,
        pages: [...FIRST_LOAD, "https://grok.com/"],
      }),
    ).toEqual([]);
  });

  it("names xAI's site when the window's load never went there, as a page's own link took the tab", () => {
    expect(
      sites({
        after: [...X_SIGNED_IN, ...GROK_SIGNED_IN],
        before: BEFORE,
        firstLoad: ["https://grok.com/"],
        pages: ["https://grok.com/", ...THROUGH_X],
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "cookies": 7,
          "site": "x.com",
        },
        {
          "cookies": 1,
          "site": "x.ai",
        },
      ]
    `);
  });

  it("counts a changed value on a cookie x.com already had, and none of those that stayed", () => {
    const signedIn = [...BEFORE, ...X_SIGNED_IN];
    expect(
      sites({
        after: [
          ...GROK_SIGNED_IN,
          ...X_SIGNED_IN.map((each) =>
            each.name === "ct0" ? { ...each, value: "ct2" } : each,
          ),
        ],
        before: signedIn,
        pages: THROUGH_X,
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "cookies": 1,
          "site": "x.com",
        },
      ]
    `);
  });

  it("tells a cookie by its domain, path and name, and puts the site with most first", () => {
    expect(
      sites({
        after: [
          cookie("accounts.google.com", "ACCOUNT_CHOOSER", "a1"),
          cookie("accounts.google.com", "LSID", "l1", "/ServiceLogin"),
          cookie(".google.com", "SID", "s1"),
          cookie(".google.com", "SID", "s1", "/u"),
          cookie("x.com", "lang", "en"),
        ],
        before: [cookie(".google.com", "SID", "s1")],
        pages: [
          "https://accounts.google.com/o/oauth2/v2/auth?client_id=1",
          "https://x.com/",
        ],
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "cookies": 3,
          "site": "google.com",
        },
        {
          "cookies": 1,
          "site": "x.com",
        },
      ]
    `);
  });
});

describe("a sign-in's cookies, from its start to Done", () => {
  beforeEach(() => {
    mocks.cookies.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The window loads Grok's sign-in page in tab-1, and the server sends it on to xAI's. */
  function loadSignIn() {
    noteSignInPage("tab-1", "https://grok.com/sign-in");
    noteSignInPage("tab-1", FIRST_LOAD[1] ?? "");
    noteSignInCommit("tab-1", FIRST_LOAD[1] ?? "");
  }

  /** The page's own Sign in with X, through X's authorize page and back to Grok. */
  function signInWithX(tab: string) {
    for (const [start, ...redirects] of [
      THROUGH_X.slice(2, 4),
      THROUGH_X.slice(4),
    ]) {
      for (const url of [start ?? "", ...redirects]) {
        noteSignInPage(tab, url);
      }
      noteSignInCommit(tab, redirects.at(-1) ?? start ?? "");
    }
  }

  it("names x.com after Grok's sign-in through X, the site the window's load was sent to left out", async () => {
    mocks.cookies.mockResolvedValueOnce(BEFORE);
    startSignInCookies("grok", "tab-1", { loadsSignIn: true });
    loadSignIn();
    signInWithX("tab-1");

    mocks.cookies.mockResolvedValueOnce([...X_SIGNED_IN, ...GROK_SIGNED_IN]);
    expect(await finishSignInCookies("grok", GROK)).toMatchInlineSnapshot(`
      [
        {
          "cookies": 7,
          "site": "x.com",
        },
      ]
    `);
  });

  it("names xAI's site too for a sign-in in a tab already open, where every load was the page's", async () => {
    mocks.cookies.mockResolvedValueOnce(BEFORE);
    startSignInCookies("grok", "tab-1", { loadsSignIn: false });
    noteSignInPage("tab-1", "https://grok.com/sign-in");
    noteSignInPage("tab-1", FIRST_LOAD[1] ?? "");
    noteSignInCommit("tab-1", FIRST_LOAD[1] ?? "");
    signInWithX("tab-1");

    mocks.cookies.mockResolvedValueOnce([...X_SIGNED_IN, ...GROK_SIGNED_IN]);
    expect(await finishSignInCookies("grok", GROK)).toMatchInlineSnapshot(`
      [
        {
          "cookies": 7,
          "site": "x.com",
        },
        {
          "cookies": 1,
          "site": "x.ai",
        },
      ]
    `);
  });

  it("names the sites the sign-in's tab and its popups loaded, and no other tab's", async () => {
    mocks.cookies.mockResolvedValueOnce(BEFORE);
    startSignInCookies("grok", "tab-1", { loadsSignIn: true });
    expect(mocks.cookies).toHaveBeenCalledOnce();

    loadSignIn();
    noteSignInOpened(
      "tab-1",
      "tab-9",
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=1",
    );
    noteSignInPage("tab-9", "https://accounts.google.com/signin/oauth/consent");
    // Another tab, where an agent reads the news meanwhile.
    noteSignInPage("tab-2", "https://www.nytimes.com/");

    mocks.cookies.mockResolvedValueOnce([
      ...BEFORE,
      ...GROK_SIGNED_IN,
      cookie(".google.com", "SID", "s1"),
      cookie(".google.com", "HSID", "h1"),
      cookie(".nytimes.com", "nyt-a", "n1"),
    ]);
    expect(await finishSignInCookies("grok", GROK)).toMatchInlineSnapshot(`
      [
        {
          "cookies": 2,
          "site": "google.com",
        },
      ]
    `);
    // The snapshot went with the sign-in.
    expect(await finishSignInCookies("grok", GROK)).toEqual([]);
    expect(mocks.cookies).toHaveBeenCalledTimes(2);
  });

  it("names the sites a tab the sign-in's page opened loaded, as an X login opening in a tab of its own", async () => {
    mocks.cookies.mockResolvedValueOnce(BEFORE);
    startSignInCookies("grok", "tab-1", { loadsSignIn: true });
    loadSignIn();

    expect(isSignInTab("tab-1")).toBe(true);
    expect(isSignInTab("tab-2")).toBe(false);
    noteSignInOpened("tab-1", "tab-7", THROUGH_X[2] ?? "");
    expect(isSignInTab("tab-7")).toBe(true);
    noteSignInPage("tab-7", THROUGH_X[3] ?? "");
    noteSignInCommit("tab-7", THROUGH_X[3] ?? "");

    mocks.cookies.mockResolvedValueOnce([...X_SIGNED_IN, ...GROK_SIGNED_IN]);
    expect(await finishSignInCookies("grok", GROK)).toEqual([
      { cookies: 7, site: "x.com" },
    ]);
  });

  it("goes on with the cookies read first when the sign-in's tab is shown again", async () => {
    mocks.cookies.mockResolvedValueOnce(BEFORE);
    startSignInCookies("grok", "tab-1", { loadsSignIn: true });
    loadSignIn();
    signInWithX("tab-1");

    startSignInCookies("grok", "tab-1", { loadsSignIn: false });
    expect(mocks.cookies).toHaveBeenCalledOnce();
    mocks.cookies.mockResolvedValueOnce([...X_SIGNED_IN, ...GROK_SIGNED_IN]);
    expect(await finishSignInCookies("grok", GROK)).toEqual([
      { cookies: 7, site: "x.com" },
    ]);
  });

  it("starts over for a sign-in opened again in another tab", async () => {
    mocks.cookies.mockResolvedValueOnce(BEFORE);
    startSignInCookies("grok", "tab-1", { loadsSignIn: true });
    loadSignIn();
    signInWithX("tab-1");

    mocks.cookies.mockResolvedValueOnce([...BEFORE, ...X_SIGNED_IN]);
    startSignInCookies("grok", "tab-2", { loadsSignIn: true });
    expect(mocks.cookies).toHaveBeenCalledTimes(2);
    mocks.cookies.mockResolvedValueOnce([
      ...BEFORE,
      ...X_SIGNED_IN,
      ...GROK_SIGNED_IN,
    ]);
    expect(await finishSignInCookies("grok", GROK)).toEqual([]);
  });

  it("takes the window's word that the tab is loading the sign-in page when its bar asked first", async () => {
    mocks.cookies.mockResolvedValueOnce(BEFORE);
    startSignInCookies("grok", "tab-1", { loadsSignIn: false });
    startSignInCookies("grok", "tab-1", { loadsSignIn: true });
    loadSignIn();
    signInWithX("tab-1");

    mocks.cookies.mockResolvedValueOnce([...X_SIGNED_IN, ...GROK_SIGNED_IN]);
    expect(await finishSignInCookies("grok", GROK)).toEqual([
      { cookies: 7, site: "x.com" },
    ]);
  });

  it("names nothing for a sign-in that ended without connecting", async () => {
    mocks.cookies.mockResolvedValue(BEFORE);
    startSignInCookies("grok", "tab-1", { loadsSignIn: true });
    noteSignInPage("tab-1", THROUGH_X[1] ?? "");
    dropSignInCookies("grok");

    mocks.cookies.mockResolvedValue([...BEFORE, ...X_SIGNED_IN]);
    expect(await finishSignInCookies("grok", GROK)).toEqual([]);
  });

  it("names nothing once a sign-in has waited an hour", async () => {
    vi.useFakeTimers({ now: 0, toFake: ["Date"] });
    mocks.cookies.mockResolvedValue(BEFORE);
    startSignInCookies("grok", "tab-1", { loadsSignIn: true });
    noteSignInPage("tab-1", THROUGH_X[1] ?? "");

    vi.setSystemTime(60 * 60_000 + 1);
    mocks.cookies.mockResolvedValue([...BEFORE, ...X_SIGNED_IN]);
    expect(await finishSignInCookies("grok", GROK)).toEqual([]);
  });

  it("names nothing when the cookies could not be read", async () => {
    mocks.cookies.mockRejectedValueOnce(new Error("session gone"));
    startSignInCookies("grok", "tab-1", { loadsSignIn: true });
    noteSignInPage("tab-1", THROUGH_X[1] ?? "");

    mocks.cookies.mockResolvedValue([...BEFORE, ...X_SIGNED_IN]);
    expect(await finishSignInCookies("grok", GROK)).toEqual([]);
  });
});
