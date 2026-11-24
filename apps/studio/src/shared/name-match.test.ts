import { describe, expect, it } from "vitest";

import {
  compareMatches,
  foldName,
  foldText,
  foldWords,
  matchName,
  matchRank,
  NO_MATCH,
  rankNames,
  stepOf,
} from "./name-match";

/**
 * A match as one readable string: its step, then the name as written with
 * what the match says to draw as matched in brackets. "none" for no match.
 */
function found(typed: string, name: string, wrongLetter = false): string {
  const match = matchName(name, foldWords(typed), wrongLetter);
  if (!match) {
    return "none";
  }
  let marked = "";
  let at = 0;
  for (let index = 0; index < match.ranges.length; index += 2) {
    const start = match.ranges[index] ?? 0;
    const end = match.ranges[index + 1] ?? 0;
    marked += `${name.slice(at, start)}[${name.slice(start, end)}]`;
    at = end;
  }
  return `${match.step} ${marked}${name.slice(at)}`;
}

const DECOMPOSED_RESUME = "re\u0301sume\u0301.pdf";

describe("the steps", () => {
  it.each([
    // 0: the name is exactly the words.
    ["wireframes", "wireframes", "0 [wireframes]"],
    ["WIREFRAMES", "Wireframes", "0 [Wireframes]"],
    ["tab groups", "Tab Groups", "0 [Tab Groups]"],
    ["tab groups", "tab-groups", "0 [tab-groups]"],
    ["tab groups", "TabGroups", "0 [TabGroups]"],
    ["  tab   groups ", "Tab Groups", "0 [Tab Groups]"],
    ["bora bora", "Bora Bora", "0 [Bora Bora]"],
    // 1: the words start the name.
    ["wire", "wireframes", "1 [wire]frames"],
    ["w", "wireframes", "1 [w]ireframes"],
    ["wireframes", "wireframes.html", "1 [wireframes].html"],
    ["tab gr", "tab-groups-home.html", "1 [tab-gr]oups-home.html"],
    ["tab-gr", "tab-groups-home.html", "1 [tab-gr]oups-home.html"],
    ["git", ".gitignore", "1 .[git]ignore"],
    [".git", ".gitignore", "1 [.git]ignore"],
    ["gitignore", ".gitignore", "1 .[gitignore]"],
    // 2: each typed word starts a word of the name, in any order.
    ["home tab", "tab-groups-home.html", "2 [tab]-groups-[home].html"],
    ["groups", "tab-groups-home.html", "2 tab-[groups]-home.html"],
    ["html", "tab-groups-home.html", "2 tab-groups-home.[html]"],
    ["tab home", "tab-groups-home.html", "2 [tab]-groups-[home].html"],
    ["tab", "table-tab", "1 [tab]le-tab"],
    ["tab groups", "table-groups", "2 [tab]le-[groups]"],
    ["menu", "src/client/command_menu.tsx", "2 src/client/command_[menu].tsx"],
    ["menu", "C:\\apps\\menu", "2 C:\\apps\\[menu]"],
    ["notes", "(draft) notes", "2 (draft) [notes]"],
    ["match", "fuzzyMatch", "2 fuzzy[Match]"],
    ["parser", "HTMLParser", "2 HTML[Parser]"],
    ["html", "parseHTMLFile", "2 parse[HTML]File"],
    ["2", "chapter2", "2 chapter[2]"],
    ["final", "v2final", "2 v2[final]"],
    ["4", "mp4", "2 mp[4]"],
    ["t", "don't", "4 don'[t]"],
    ["s", "Dana's notes", "4 Dana'[s] notes"],
    ["quoted", "'quoted'", "1 '[quoted]'"],
    // 3: the leading letters of two or more words, in order.
    ["tg", "Tab Groups", "3 [T]ab [G]roups"],
    ["tabgr", "Tab Groups", "3 [Tab] [Gr]oups"],
    ["gc", "Google Chrome", "3 [G]oogle [C]hrome"],
    ["tgh", "tab-groups-hub", "3 [t]ab-[g]roups-[h]ub"],
    ["th", "tab-groups-hub", "3 [t]ab-groups-[h]ub"],
    ["gh", "tab-groups-hub", "3 tab-[g]roups-[h]ub"],
    ["fm", "fuzzyMatch.ts", "3 [f]uzzy[M]atch.ts"],
    ["t g", "Tab Groups", "2 [T]ab [G]roups"],
    ["tg home", "tab-groups-home", "3 [t]ab-[g]roups-[home]"],
    ["tgr", "tg-groups", "3 [t]g-[gr]oups"],
    ["tabgroups", "tab-groups", "3 [tab]-[groups]"],
    ["v2", "version 2 notes", "3 [v]ersion [2] notes"],
    // The first word used is the earliest that works.
    ["ab", "b-a-b-a-b", "3 b-[a]-[b]-a-b"],
    // 4: every typed word is inside the name in one piece.
    ["duck", "Cyberduck", "4 Cyber[duck]"],
    ["frames", "wireframes", "4 wire[frames]"],
    ["tab duck", "Cyberduck tab", "4 Cyber[duck] [tab]"],
    ["roup", "tab-groups", "4 tab-g[roup]s"],
    ["tg", "outgoing", "4 ou[tg]oing"],
    ["tg", "outgoing-tab-groups", "3 outgoing-[t]ab-[g]roups"],
    ["tab groups", "tabgroups", "4 [tabgroups]"],
    // No match.
    ["tabgrp", "Tab Groups", "none"],
    ["tabgrp", "tab-groups-home.html", "none"],
    ["wfs", "wireframes", "none"],
    ["cbd", "Cyberduck", "none"],
    ["tgs", "Tab Groups", "none"],
    ["gt", "Tab Groups", "none"],
    ["ag", "Tab Groups", "none"],
    ["tb", "Tab Groups", "none"],
    ["home tab", "tab-groups.html", "none"],
    ["wireframse", "wireframes", "none"],
    ["", "wireframes", "none"],
    ["   ", "wireframes", "none"],
    ["a", "", "none"],
  ])("%j in %j is %j", (typed, name, expected) => {
    expect(found(typed, name)).toBe(expected);
  });
});

describe("one wrong letter, when asked for", () => {
  it.each([
    // One letter for another.
    ["wirefrimes", "wireframes", "5 [wireframes]"],
    ["wirex", "wireframes", "5 [wiref]rames"],
    ["xireframes", "wireframes", "5 [wireframes]"],
    // Two neighbors swapped.
    ["wireframse", "wireframes", "5 [wireframes]"],
    ["iwreframes", "wireframes", "5 [wireframes]"],
    // One letter too many.
    ["wireeframes", "wireframes", "5 [wireframes]"],
    ["wireframesx", "wireframes", "5 [wireframes]"],
    // One left out.
    ["wirframes", "wireframes", "5 [wireframes]"],
    // Against a word start, not only the name's.
    ["grxups", "tab-groups-home", "5 tab-[groups]-home"],
    ["home grxups", "tab-groups-home", "5 tab-[groups]-[home]"],
    ["cyber grxups", "Cyberduck groups", "5 [Cyber]duck [groups]"],
    // A better step is still what comes back.
    ["wireframes", "wireframes", "0 [wireframes]"],
    ["duck", "Cyberduck", "4 Cyber[duck]"],
    ["wireframes", "wire-frames", "3 [wire]-[frames]"],
    // Under five letters, two wrong letters, two wrong words, the middle of
    // a word.
    ["wirx", "wireframes", "none"],
    ["wurefrimes", "wireframes", "none"],
    ["hmoe grxups", "tab-groups-home", "none"],
    ["framse", "wireframes", "none"],
    ["tabgrp", "Tab Groups", "none"],
    ["wfrms", "wireframes", "none"],
  ])("%j in %j is %j", (typed, name, expected) => {
    expect(found(typed, name, true)).toBe(expected);
  });
});

describe("case, accents and other scripts", () => {
  it.each([
    ["resume", "Résumé.pdf", "1 [Résumé].pdf"],
    ["résumé", "resume.pdf", "1 [resume].pdf"],
    ["RÉSUMÉ", "résumé", "0 [résumé]"],
    // As a Mac's disk spells it: the letter, then its accent.
    ["resume", DECOMPOSED_RESUME, `1 [${DECOMPOSED_RESUME.slice(0, 8)}].pdf`],
    ["résumé", DECOMPOSED_RESUME, `1 [${DECOMPOSED_RESUME.slice(0, 8)}].pdf`],
    ["res", DECOMPOSED_RESUME, "1 [re\u0301s]ume\u0301.pdf"],
    ["sume", DECOMPOSED_RESUME, "4 re\u0301[sume\u0301].pdf"],
    ["uber", "Über uns", "1 [Über] uns"],
    ["ecole", "notes École", "2 notes [École]"],
    ["istanbul", "İstanbul", "0 [İstanbul]"],
    ["ёлка", "Елка", "0 [Елка]"],
    ["москва", "Поездка в Москва", "2 Поездка в [Москва]"],
    ["пм", "Поездка Москва", "3 [П]оездка [М]осква"],
    ["file", "ﬁle.txt", "1 [ﬁle].txt"],
    ["abc", "ＡＢＣ", "0 [ＡＢＣ]"],
    ["東京", "東京旅行", "1 [東京]旅行"],
    ["旅行", "東京旅行", "4 東京[旅行]"],
    ["旅行", "東京 旅行", "2 東京 [旅行]"],
    ["plan", "東京plan", "2 東京[plan]"],
    ["が", "か", "none"],
    ["한", "한국어", "1 [한]국어"],
    ["שלום", "שלום עולם", "1 [שלום] עולם"],
    ["עולם", "שלום עולם", "2 שלום [עולם]"],
    ["مرحبا", "مرحبا بالعالم", "1 [مرحبا] بالعالم"],
    ["party", "🎉party", "1 🎉[party]"],
    ["🎉", "🎉party", "1 [🎉]party"],
    ["x", "\ud83d", "none"],
  ])("%j in %j is %j", (typed, name, expected) => {
    expect(found(typed, name)).toBe(expected);
  });

  it.each([
    ["Résumé", "resume"],
    ["re\u0301sume\u0301", "resume"],
    ["ÅNGSTRÖM", "angstrom"],
    ["ﬁle", "file"],
    ["Plain", "plain"],
    ["が", "か\u3099"],
  ])("folds %j to %j", (text, folded) => {
    expect(foldText(text)).toBe(folded);
  });
});

describe("word starts", () => {
  it.each([
    ["tab-groups_home.html", "Tab Groups Home Html"],
    ["src/client\\lib", "Src Client Lib"],
    ["fuzzyMatch", "Fuzzy Match"],
    ["HTMLParser", "HTML Parser"],
    ["parseHTMLFile", "Parse HTML File"],
    ["v2final", "V 2 Final"],
    ["h264 video", "H 264 Video"],
    ["don't stop", "Don't Stop"],
    ["'quoted' text", "Quoted' Text"],
    ["  spaced  out ", "Spaced Out"],
    ["Über-uns", "Uber Uns"],
    ["東京plan", "東京 Plan"],
    ["", ""],
    ["---", ""],
  ])("%j has the words %j", (name, expected) => {
    const folded = foldName(name);
    const ends = [...folded.starts.slice(1), folded.text.length];
    const words = folded.starts.map((start, index) => {
      const word = folded.text.slice(start, ends[index]);
      const trimmed = word.replace(/[^\p{L}\p{N}']+$/u, "");
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    });
    expect(
      words
        .join(" ")
        .replace("Html Parser", "HTML Parser")
        .replace("Html File", "HTML File"),
    ).toBe(expected);
  });
});

describe("long names and long words", () => {
  const long = `${"lorem ipsum ".repeat(20_000)}zebra`;

  it("matches at the end of a very long name", () => {
    const name = foldName(long);
    const match = matchName(name, foldWords("zebra"));
    expect(match?.step).toBe(2);
    expect(match?.ranges).toEqual([long.length - 5, long.length]);
  });

  it("finds initials in a very long name and nothing for a near miss", () => {
    const name = foldName(long);
    expect(matchName(name, foldWords("liz"))?.ranges).toEqual([
      0,
      1,
      6,
      7,
      long.length - 5,
      long.length - 4,
    ]);
    expect(matchRank(name, foldWords("lizx"), true)).toBe(NO_MATCH);
    expect(matchRank(name, foldWords("zebrx zebry"), true)).toBe(NO_MATCH);
  });

  it("reads a run longer than step 3 takes as plain words", () => {
    const typed = "a".repeat(40);
    expect(found(typed, `${typed} b`)).toBe(`1 [${typed}] b`);
    expect(found(typed, "a ".repeat(40))).toBe("none");
  });

  it("stays quick on a name of one letter repeated", () => {
    const name = foldName("a ".repeat(5000));
    expect(
      stepOf(matchRank(name, foldWords("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))),
    ).toBe(3);
    expect(matchRank(name, foldWords("aaaaaaaaaaaaaaaaaaaaaaaaaaaaab"))).toBe(
      NO_MATCH,
    );
  });
});

describe("compareMatches", () => {
  const base = { name: "wireframes", position: 0, step: 1 };

  it.each([
    [
      "a remembered pick over a better step",
      { ...base, remembered: true, step: 4 },
      { ...base, step: 0 },
    ],
    [
      "a better step over a pin",
      { ...base, step: 1 },
      { ...base, pinned: true, step: 2 },
    ],
    ["a pin over more use", { ...base, pinned: true }, { ...base, use: 9 }],
    [
      "more use over an earlier match",
      { ...base, position: 6, use: 2 },
      { ...base, use: 1 },
    ],
    [
      "an earlier match over a shorter name",
      { ...base, position: 0 },
      { ...base, name: "wire", position: 3 },
    ],
    [
      "a shorter name over the alphabet",
      { ...base, name: "zed" },
      { ...base, name: "abcd" },
    ],
    ["the name last", { ...base, name: "abc" }, { ...base, name: "abx" }],
  ])("puts %s", (_, first, second) => {
    expect(compareMatches(first, second)).toBeLessThan(0);
    expect(compareMatches(second, first)).toBeGreaterThan(0);
  });

  it("says two alike matches are equal", () => {
    expect(compareMatches(base, { ...base })).toBe(0);
  });
});

describe("rankNames", () => {
  const entry = (
    id: string,
    name: string,
    more: { pinned?: boolean; use?: number } = {},
  ) => ({
    id,
    name: foldName(name),
    ...more,
  });
  const entries = [
    entry("chat", "Notes on the wireframes round", { use: 50 }),
    entry("folder", "wireframes", { pinned: true }),
    entry("page", "Wireframes for tab groups"),
    entry("file", "old-wireframes.html", { use: 3 }),
    entry("app", "Cyberduck"),
    entry("deep", "rewireframes"),
  ];
  const order = (typed: string, options?: Parameters<typeof rankNames>[2]) =>
    rankNames(entries, foldWords(typed), options).map(
      (match) => `${match.entry.id} ${match.step}`,
    );

  it("orders every kind by step, then pin, then use", () => {
    expect(order("wireframes")).toEqual([
      "folder 0",
      "page 1",
      "chat 2",
      "file 2",
      "deep 4",
    ]);
  });

  it("puts the remembered pick first when it matches", () => {
    expect(order("wire", { remembered: "file" })).toEqual([
      "file 2",
      "folder 1",
      "page 1",
      "chat 2",
      "deep 4",
    ]);
    expect(order("wire", { remembered: "app" })[0]).toBe("folder 1");
  });

  it("keeps the remembered pick when the limit cuts its step", () => {
    expect(order("wire", { limit: 2, remembered: "deep" })).toEqual([
      "deep 4",
      "folder 1",
    ]);
    expect(order("wire", { limit: 3 })).toEqual([
      "folder 1",
      "page 1",
      "chat 2",
    ]);
  });

  it("tries a wrong letter only when asked", () => {
    expect(order("wireframse")).toEqual([]);
    expect(order("wireframse", { wrongLetter: true })).toEqual([
      "folder 5",
      "chat 5",
      "file 5",
      "page 5",
    ]);
  });

  it("gives each match what to draw", () => {
    const [first] = rankNames(entries, foldWords("tg"));
    expect(first?.entry.id).toBe("page");
    expect(first?.ranges).toEqual([15, 16, 19, 20]);
  });

  it("finds nothing for nothing typed", () => {
    expect(order("")).toEqual([]);
  });
});
