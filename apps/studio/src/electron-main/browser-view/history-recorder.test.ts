import { describe, expect, it, vi } from "vitest";

vi.mock("@/electron-main/lib/get-workspace-folder", () => ({
  getWorkspaceFolder: () => "/unused",
}));

import {
  classifyCommit,
  createTabRecorder,
  type NavigationSnapshot,
} from "./history-recorder";
import { createHistoryStore, type HistoryActor } from "./history-store";

/**
 * A tab as Chromium keeps it, driven the way pages and people drive one, and
 * reporting to a recorder the events Electron would: start, server redirects,
 * commit with the list as it stands, then the list as it settles.
 */
function tab({
  actor = "user",
  signIn,
}: {
  actor?: HistoryActor;
  signIn?: { pending: () => boolean; slug: string; url: string };
} = {}) {
  let now = 1_000_000;
  const store = createHistoryStore(":memory:");
  const typed = new Set<string>();
  const restored = new Set<string>();
  const take = (marks: Set<string>) => (urls: readonly string[]) => {
    const hit = urls.find((url) => marks.has(url));
    if (hit !== undefined) {
      marks.delete(hit);
    }
    return hit !== undefined;
  };
  let who = actor;
  const recorder = createTabRecorder({
    actorSince: () => who,
    now: () => now,
    signInAt: (url) => (signIn && url === signIn.url ? signIn.slug : undefined),
    signInPending: () => signIn?.pending() ?? false,
    sink: store,
    takeRestored: take(restored),
    takeTyped: take(typed),
  });
  let urls: string[] = ["about:blank"];
  let index = 0;
  const list = (): NavigationSnapshot => ({
    index,
    length: urls.length,
    urls: [...urls],
  });
  recorder.settle(list());
  const commit = (url: string, status?: number) => {
    recorder.commit({ after: list(), status, url });
    recorder.settle(list());
  };
  const crossDocument = (
    url: string,
    {
      redirects = [],
      replace = false,
      status = 200,
    }: { redirects?: string[]; replace?: boolean; status?: number } = {},
  ) => {
    const final = redirects.at(-1) ?? url;
    recorder.start(url);
    for (const hop of redirects) {
      recorder.redirect(hop);
    }
    if (replace) {
      urls[index] = final;
    } else {
      urls = [...urls.slice(0, index + 1), final];
      index += 1;
    }
    commit(final, status);
  };
  const sameDocument = (url: string, replace: boolean) => {
    if (replace) {
      urls[index] = url;
    } else {
      urls = [...urls.slice(0, index + 1), url];
      index += 1;
    }
    recorder.commitSameDocument({ after: list(), url });
    recorder.settle(list());
  };
  return {
    advance(ms: number) {
      now += ms;
    },
    as(next: HistoryActor) {
      who = next;
    },
    back() {
      index -= 1;
      const url = urls[index] ?? "";
      recorder.start(url);
      commit(url);
    },
    /** A link, a form, or `location.href`: a new entry. */
    go: (url: string, options?: { redirects?: string[]; status?: number }) => {
      crossDocument(url, options);
    },
    loaded() {
      now += 300;
      recorder.stoppedLoading();
    },
    pushState: (url: string) => {
      sameDocument(url, false);
    },
    recent: () =>
      store.recent(50).map((page) => ({
        title: page.title,
        url: page.url,
        visits: page.visitCount,
      })),
    reload() {
      const url = urls[index] ?? "";
      recorder.start(url);
      commit(url);
    },
    /** `location.replace` or a `<meta refresh>`: a new document in the same entry. */
    replace: (url: string) => {
      crossDocument(url, { replace: true });
    },
    replaceState: (url: string) => {
      sameDocument(url, true);
    },
    restore(url: string) {
      restored.add(url);
      crossDocument(url);
    },
    store,
    title(title: string) {
      recorder.title(title, true);
    },
    typed(url: string, options?: { redirects?: string[] }) {
      typed.add(url);
      crossDocument(url, options);
    },
  };
}

describe("classifyCommit", () => {
  const at = (index: number, ...urls: string[]): NavigationSnapshot => ({
    index,
    length: urls.length,
    urls,
  });
  it.each([
    ["a new entry", at(0, "a"), at(1, "a", "b"), "b", "new"],
    [
      "a new entry over pruned forward entries",
      at(0, "a", "b"),
      at(1, "a", "c"),
      "c",
      "new",
    ],
    ["a replacement", at(0, "a"), at(0, "b"), "b", "replace"],
    ["a reload", at(0, "a"), at(0, "a"), "a", "reload"],
    ["a step back", at(1, "a", "b"), at(0, "a", "b"), "a", "history-step"],
    ["a step forward", at(0, "a", "b"), at(1, "a", "b"), "b", "history-step"],
  ] as const)("reads %s", (_name, before, after, url, kind) => {
    expect(classifyCommit(before, after, url)).toBe(kind);
  });
});

describe("history recorder", () => {
  it("keeps only the page a Linear sign-in landed on, titled, when the app's sign-in flow opened the tab", () => {
    let pending = true;
    const linear = tab({
      signIn: {
        pending: () => pending,
        slug: "linear",
        url: "https://mcp.linear.app/authorize?client=1",
      },
    });
    // The authorization page sends the browser to Google's sign-in.
    linear.go("https://mcp.linear.app/authorize?client=1", {
      redirects: ["https://accounts.google.com/signin?continue=linear"],
    });
    linear.title("Sign in - Google Accounts");
    linear.loaded();
    linear.go("https://linear.app/oauth/authorize?client=1");
    linear.title("Linear");
    linear.loaded();
    // Approving sends the browser to the app's callback, which finishes the
    // sign-in while it answers.
    linear.go("http://127.0.0.1:4000/callback?code=1");
    pending = false;
    linear.loaded();
    linear.replace("https://linear.app/");
    linear.replace("https://linear.app/finalpoint");
    linear.title("Inbox › Linear");
    linear.loaded();
    expect(linear.recent()).toEqual([
      {
        title: "Inbox › Linear",
        url: "https://linear.app/finalpoint",
        visits: 1,
      },
    ]);
  });

  it("keeps a page a client redirect passed through when the person had visited it on its own", () => {
    const linear = tab();
    linear.typed("https://linear.app/");
    linear.title("Linear");
    linear.loaded();
    linear.advance(60_000);
    linear.go("https://linear.app/");
    linear.replace("https://linear.app/finalpoint");
    linear.title("Inbox › Linear");
    linear.loaded();
    expect(linear.recent()).toEqual([
      {
        title: "Inbox › Linear",
        url: "https://linear.app/finalpoint",
        visits: 1,
      },
      // The redirect's title is copied back along the chain, as Chromium does.
      { title: "Inbox › Linear", url: "https://linear.app/", visits: 1 },
    ]);
  });

  it("hides the hops of a Notion integration sign-in and keeps the page it ends on under its own title", () => {
    const notion = tab();
    notion.typed("https://www.notion.so/login");
    notion.title("Log in | Notion");
    notion.loaded();
    notion.go("https://www.notion.so/install-integration?id=1");
    notion.title("Add integration | Notion");
    notion.loaded();
    // The callback answers with a server redirect home, which never commits.
    notion.go("https://www.notion.so/oauth2callback?code=1", {
      redirects: ["https://www.notion.so/"],
    });
    notion.replace("https://www.notion.so/Page-1?pvs=3");
    notion.replaceState("https://www.notion.so/Page-1");
    notion.title("Page 1");
    notion.loaded();
    expect(notion.recent()).toEqual([
      { title: "Page 1", url: "https://www.notion.so/Page-1", visits: 1 },
      {
        title: "Add integration | Notion",
        url: "https://www.notion.so/install-integration?id=1",
        visits: 1,
      },
      {
        title: "Log in | Notion",
        url: "https://www.notion.so/login",
        visits: 1,
      },
    ]);
  });

  it("titles each page from its own document, never from the page before it", () => {
    const browser = tab();
    browser.go("https://a.test/");
    browser.title("A");
    browser.loaded();
    browser.go("https://b.test/");
    // Until B sets its own, A's row keeps A's title and B has none.
    expect(browser.recent()).toEqual([
      { title: "", url: "https://b.test/", visits: 1 },
      { title: "A", url: "https://a.test/", visits: 1 },
    ]);
    browser.title("B");
    browser.loaded();
    browser.back();
    browser.title("A again");
    expect(browser.recent()).toEqual([
      { title: "A again", url: "https://a.test/", visits: 2 },
      { title: "B", url: "https://b.test/", visits: 1 },
    ]);
  });

  it("takes titles only while loading or shortly after, and only so many", () => {
    const browser = tab();
    browser.go("https://a.test/");
    for (let change = 1; change <= 12; change += 1) {
      browser.title(`A ${change.toString()}`);
    }
    expect(browser.recent()[0]?.title).toBe("A 10");
    browser.reload();
    browser.title("Fresh");
    browser.loaded();
    browser.advance(6000);
    browser.title("Ticker 12:01");
    expect(browser.recent()[0]?.title).toBe("Fresh");
  });

  it("starts a pushState page with the document's title and lets it set its own", () => {
    const browser = tab();
    browser.go("https://app.test/inbox");
    browser.title("Inbox");
    browser.loaded();
    browser.pushState("https://app.test/thread/1");
    expect(browser.recent()[0]).toEqual({
      title: "Inbox",
      url: "https://app.test/thread/1",
      visits: 1,
    });
    browser.title("Thread 1");
    expect(browser.recent()[0]?.title).toBe("Thread 1");
  });

  it("adds no visit for a reload or a tab restored at launch", () => {
    const browser = tab();
    browser.restore("https://a.test/");
    browser.title("A");
    expect(browser.recent()).toEqual([]);
    browser.go("https://b.test/");
    browser.reload();
    browser.replaceState("https://b.test/");
    expect(browser.recent()).toEqual([
      { title: "", url: "https://b.test/", visits: 1 },
    ]);
  });

  it("keeps pages answered with an error out of history", () => {
    const browser = tab();
    browser.go("https://a.test/missing", { status: 404 });
    browser.go("https://a.test/");
    expect(browser.recent().map((page) => page.url)).toEqual([
      "https://a.test/",
    ]);
  });

  it("records the agent's pages for their titles and icons without surfacing them", () => {
    const browser = tab({ actor: "agent" });
    browser.go("https://agent.test/");
    browser.title("Found it");
    expect(browser.recent()).toEqual([]);
    browser.as("user");
    browser.go("https://agent.test/");
    expect(browser.recent()).toEqual([
      { title: "Found it", url: "https://agent.test/", visits: 1 },
    ]);
  });

  it("counts a typed address through its server redirects", () => {
    const browser = tab();
    browser.typed("http://example.test/", {
      redirects: ["https://example.test/"],
    });
    expect(browser.store.significant(10, Date.now())).toMatchObject([
      { typedCount: 1, url: "https://example.test/" },
    ]);
  });
});
