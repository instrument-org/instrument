import { describe, expect, it } from "vitest";

import { siteTabTitles } from "./site-tab-titles";

const shown = (tabs: { title: string; url?: string }[]) => {
  const keyed = tabs.map((tab, index) => ({
    key: String(index),
    title: tab.title,
    url: tab.url,
  }));
  const titles = siteTabTitles(keyed);
  return keyed.map((tab) => titles.get(tab.key) ?? tab.title);
};

describe("siteTabTitles", () => {
  it.each([
    {
      expected: ["Splenda Packets, 400 Count", "Stevia in the Raw"],
      name: "a shared prefix",
      tabs: [
        {
          title: "Amazon.com: Splenda Packets, 400 Count",
          url: "https://www.amazon.com/a",
        },
        {
          title: "Amazon.com: Stevia in the Raw",
          url: "https://amazon.com/b",
        },
      ],
    },
    {
      expected: ["Cat", "Dog"],
      name: "a shared suffix",
      tabs: [
        { title: "Cat - Wikipedia", url: "https://en.wikipedia.org/wiki/Cat" },
        { title: "Dog - Wikipedia", url: "https://en.wikipedia.org/wiki/Dog" },
      ],
    },
    {
      expected: ["Amazon.com: Splenda", "Cat - Wikipedia"],
      name: "nothing across different sites",
      tabs: [
        { title: "Amazon.com: Splenda", url: "https://amazon.com/a" },
        { title: "Cat - Wikipedia", url: "https://en.wikipedia.org/wiki/Cat" },
      ],
    },
    {
      expected: ["Amazon.com: Splenda"],
      name: "nothing for a tab alone on its site",
      tabs: [{ title: "Amazon.com: Splenda", url: "https://amazon.com/a" }],
    },
    {
      expected: ["Inbox (3)", "Inbox (4)"],
      name: "nothing short of a whole part",
      tabs: [
        { title: "Inbox (3)", url: "https://mail.example.com/a" },
        { title: "Inbox (4)", url: "https://mail.example.com/b" },
      ],
    },
    {
      expected: ["Docs: Setup", "Docs: Setup"],
      name: "nothing between tabs of the same page",
      tabs: [
        { title: "Docs: Setup", url: "https://example.com/a" },
        { title: "Docs: Setup", url: "https://example.com/a" },
      ],
    },
    {
      expected: ["Docs", "Docs: Setup"],
      name: "a title the cut would leave empty",
      tabs: [
        { title: "Docs", url: "https://example.com/a" },
        { title: "Docs: Setup", url: "https://example.com/b" },
      ],
    },
    {
      expected: ["Report.html", "Notes.html"],
      name: "nothing for local files",
      tabs: [
        { title: "Report.html", url: "file:///a/Report.html" },
        { title: "Notes.html", url: "file:///a/Notes.html" },
      ],
    },
  ])("drops $name", ({ expected, tabs }) => {
    expect(shown(tabs)).toEqual(expected);
  });
});
