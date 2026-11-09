import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/electron-main/lib/get-workspace-folder", () => ({
  workspaceBrowserDir: () => "/unused",
}));

import {
  createHistoryStore,
  type HistoryActor,
  type HistoryTransition,
} from "./history-store";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 10, 8, 12).getTime();
const stores: ReturnType<typeof createHistoryStore>[] = [];
function setup() {
  const history = createHistoryStore(":memory:");
  stores.push(history);
  const visit = (
    url: string,
    at = NOW,
    transition: HistoryTransition = "link",
    actor: HistoryActor = "user",
  ) => history.addVisit({ actor, at, transition, url });
  return { history, visit };
}
afterEach(() => {
  for (const history of stores.splice(0)) history.close();
});

describe("browser start pages", () => {
  it("leaves empty and one-day history without invented frequent sites", () => {
    const { history, visit } = setup();
    expect(history.startPages([], NOW)).toEqual({ frequent: [], recent: [] });
    visit("https://a.test/one", NOW - 1000);
    visit("https://a.test/two", NOW);
    expect(history.startPages([], NOW).frequent).toEqual([]);
    expect(history.startPages([], NOW).recent).toHaveLength(2);
  });

  it("counts local calendar days even when visits are minutes apart", () => {
    const { history, visit } = setup();
    const afterMidnight = new Date(2026, 10, 8, 0, 1).getTime();
    visit("https://a.test/", afterMidnight - 2 * 60 * 1000);
    visit("https://a.test/", afterMidnight);
    expect(
      history.startPages([], afterMidnight).frequent.map((p) => p.url),
    ).toEqual(["https://a.test/"]);
  });
  it("backfills twelve recents past a crowded host without changing full history", () => {
    const { history, visit } = setup();
    for (let n = 0; n < 10; n++)
      visit(`https://site-${n}.test/`, NOW - 2000 - n);
    for (let n = 0; n < 1000; n++) visit(`https://crowded.test/${n}`, NOW - n);
    const result = history.startPages([], NOW);
    expect(result.recent.map((p) => p.url)).toEqual([
      "https://crowded.test/0",
      "https://crowded.test/1",
      ...Array.from({ length: 10 }, (_, n) => `https://site-${n}.test/`),
    ]);
    expect(
      history
        .recent(12)
        .every((p) => p.url.startsWith("https://crowded.test/")),
    ).toBe(true);
    expect(history.significant(12, NOW)).toEqual(history.recent(12));
  });

  it("folds www and schemes into one hostname but preserves other subdomains and links", () => {
    const { history, visit } = setup();
    const urls = [
      "https://www.example.test/docs?q=one#section",
      "http://example.test/other",
      "https://example.test/third",
      "https://app.example.test/dashboard",
      "https://app.example.test/settings",
    ];
    urls.forEach((url, n) => visit(url, NOW - n));
    expect(history.startPages([], NOW).recent.map((p) => p.url)).toEqual([
      urls[0],
      urls[1],
      urls[3],
      urls[4],
    ]);
  });

  it("excludes bookmarked destinations before applying limits or choosing a frequent page", () => {
    const { history, visit } = setup();
    for (const day of [1, 2, 3])
      visit("https://a.test/bookmarked", NOW - day * DAY);
    for (const day of [1, 2])
      visit("https://a.test/dashboard?team=one", NOW - day * DAY);
    visit("https://a.test/other", NOW);
    const pages = history.startPages(["https://a.test/bookmarked"], NOW);
    expect(pages.frequent.map((p) => p.url)).toEqual([
      "https://a.test/dashboard?team=one",
    ]);
    expect(pages.recent.map((p) => p.url)).toEqual([
      "https://a.test/other",
      "https://a.test/dashboard?team=one",
    ]);
    expect(
      history.startPages(
        ["https://a.test/dashboard?team=one", "https://a.test/bookmarked"],
        NOW,
      ).frequent,
    ).toEqual([]);
  });

  it("ranks return visits across days above a burst and counts a host's day once", () => {
    const { history, visit } = setup();
    for (const day of [1, 2, 3])
      visit("https://regular.test/dashboard", NOW - day * DAY);
    for (let n = 0; n < 40; n++) visit(`https://research.test/${n}`, NOW - n);
    visit("https://research.test/older", NOW - DAY);
    const result = history.startPages([], NOW);
    expect(result.frequent.map((p) => p.url)).toEqual([
      "https://regular.test/dashboard",
      "https://research.test/0",
    ]);
  });

  it("unions days across www and bare-host pages and keeps other subdomains separate", () => {
    const { history, visit } = setup();
    visit("https://www.a.test/one", NOW - DAY);
    visit("https://a.test/two", NOW);
    visit("https://app.a.test/", NOW);
    expect(history.startPages([], NOW).frequent.map((p) => p.url)).toEqual([
      "https://a.test/two",
    ]);
  });

  it("breaks site ties by explicit days, then recency, then hostname", () => {
    const { history, visit } = setup();
    for (const host of ["a", "b", "c", "d"]) {
      visit(`https://${host}.test/`, NOW - DAY);
      visit(`https://${host}.test/`, NOW - 100);
    }
    visit("https://d.test/", NOW - DAY, "typed");
    visit("https://c.test/", NOW);
    expect(history.startPages([], NOW).frequent.map((p) => p.url)).toEqual([
      "https://d.test/",
      "https://c.test/",
      "https://a.test/",
      "https://b.test/",
    ]);
  });

  it("chooses a repeatedly used deep link over the site's latest incidental page", () => {
    const { history, visit } = setup();
    for (const day of [1, 2, 3])
      visit("https://a.test/dashboard?team=one", NOW - day * DAY);
    for (const day of [1, 2, 3])
      visit("https://a.test/inbox", NOW - day * DAY, "typed");
    visit("https://a.test/new-article", NOW);
    const chosen = history.startPages([], NOW).frequent[0];
    expect(chosen?.url).toBe("https://a.test/inbox");
    expect(chosen?.at).toBe(NOW - DAY);
  });

  it("requires two days and at most six qualifying hosts", () => {
    const { history, visit } = setup();
    for (let n = 0; n < 8; n++) {
      visit(`https://site-${n}.test/`, NOW - DAY);
      visit(`https://site-${n}.test/`, NOW - n);
    }
    visit("https://once.test/", NOW);
    expect(history.startPages([], NOW).frequent.map((p) => p.url)).toEqual(
      Array.from({ length: 6 }, (_, n) => `https://site-${n}.test/`),
    );
  });

  it("ignores agents and hidden visits, including those sharing a visible URL", () => {
    const { history, visit } = setup();
    for (const day of [0, 1, 2]) {
      visit("https://agent.test/", NOW - day * DAY, "typed", "agent");
      visit("https://one-user-day.test/", NOW - day * DAY, "typed", "agent");
      for (const hiddenBy of ["redirect", "error", "sign-in"] as const) {
        const id = visit(`https://${hiddenBy}.test/`, NOW - day * DAY);
        history.hideVisit(id, hiddenBy);
      }
    }
    visit("https://one-user-day.test/", NOW);
    const result = history.startPages([], NOW);
    expect(result.frequent).toEqual([]);
    expect(result.recent.map((p) => p.url)).toEqual([
      "https://one-user-day.test/",
    ]);
  });

  it("ages frequent sites out of the rolling window and ignores future visits", () => {
    const { history, visit } = setup();
    visit("https://old.test/", NOW - 31 * DAY);
    visit("https://old.test/", NOW);
    visit("https://future.test/", NOW);
    visit("https://future.test/", NOW + DAY);
    visit("https://edge.test/", NOW - 30 * DAY);
    visit("https://edge.test/", NOW - 29 * DAY);
    expect(history.startPages([], NOW).frequent.map((p) => p.url)).toEqual([
      "https://edge.test/",
    ]);
    expect(
      history.startPages([], NOW + 2 * DAY).frequent.map((p) => p.url),
    ).toEqual(["https://future.test/"]);
  });

  it("updates both selections after hiding, removing, and clearing visits", () => {
    const { history, visit } = setup();
    visit("https://a.test/", NOW - DAY);
    const latest = visit("https://a.test/", NOW);
    history.setTitle([latest], "Dashboard");
    history.setFavicon("https://a.test/", "https://a.test/icon.png");
    expect(history.startPages([], NOW).frequent[0]).toMatchObject({
      title: "Dashboard",
      favicon: "https://a.test/icon.png",
      visitCount: 2,
    });
    history.hideVisit(latest, "redirect");
    expect(history.startPages([], NOW).frequent).toEqual([]);
    expect(history.startPages([], NOW).recent[0]?.at).toBe(NOW - DAY);
    history.remove("https://a.test/");
    expect(history.startPages([], NOW)).toEqual({ frequent: [], recent: [] });
    visit("https://b.test/", NOW - DAY);
    visit("https://b.test/", NOW);
    history.clear();
    expect(history.startPages([], NOW)).toEqual({ frequent: [], recent: [] });
  });

  it("takes a removed site off frequent only, until it is put back or history is cleared", () => {
    const { history, visit } = setup();
    for (const url of ["https://a.test/", "https://www.b.test/x"]) {
      visit(url, NOW - DAY);
      visit(url, NOW);
    }
    const frequent = () =>
      history.startPages([], NOW).frequent.map((p) => p.url);
    history.setFrequentHidden("https://b.test/other", true, NOW);
    expect(frequent()).toEqual(["https://a.test/"]);
    expect(history.startPages([], NOW).recent).toHaveLength(2);
    expect(history.recent(12)).toHaveLength(2);
    history.setFrequentHidden("https://b.test/", false, NOW);
    expect(frequent()).toHaveLength(2);
    history.setFrequentHidden("https://a.test/", true, NOW);
    history.clear(NOW);
    visit("https://a.test/", NOW);
    expect(frequent()).toContain("https://a.test/");
  });
});
