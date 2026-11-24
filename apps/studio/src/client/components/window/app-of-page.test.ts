import { describe, expect, it } from "vitest";

import { appOfPage, type SiteApp } from "./app-visits";

const app = (slug: string, ...sites: string[]): SiteApp => ({
  name: slug,
  site: sites[0],
  sites,
  slug,
});

const APPS = [
  app("google", "https://google.com"),
  app("drive", "https://drive.google.com"),
  app("gmail", "https://gmail.com", "https://mail.google.com"),
  app("notion", "https://www.notion.so"),
  app("notes"),
];

describe("the app a page is on the site of", () => {
  it.each([
    ["https://drive.google.com/drive/my-drive", "drive"],
    ["https://mail.google.com/mail/u/0", "gmail"],
    ["https://docs.google.com/document", "google"],
    ["https://notion.so/page", "notion"],
    ["https://notnotion.so", undefined],
    ["about:blank", undefined],
  ])("%s is %s", (url, slug) => {
    expect(appOfPage(url, APPS)?.slug).toBe(slug);
  });
});
