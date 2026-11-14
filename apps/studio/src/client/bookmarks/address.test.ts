import { fileHref, folderHref } from "@/shared/computer-href";
import { describe, expect, it } from "vitest";

import {
  addressOfHref,
  fileAddressOf,
  instrumentAddressOf,
  sameAddress,
  screenNameOfHref,
  targetOfAddress,
} from "./address";

const HOME = "/Users/mac-user";

describe("addressOfHref", () => {
  it.each([
    [
      "/chats/01JZ8Q0V3W6Y8A2B4C6D8E0F2G",
      "instrument://chat/01JZ8Q0V3W6Y8A2B4C6D8E0F2G",
    ],
    [
      folderHref("/Users/mac-user/Downloads"),
      "instrument://file/Users/mac-user/Downloads/",
    ],
    [
      "/files?path=Documents%2F&root=~",
      "instrument://file/Users/mac-user/Documents/",
    ],
    [
      fileHref("/Users/mac-user/Notes/plan #2.md"),
      "instrument://file/Users/mac-user/Notes/plan %232.md",
    ],
    ["/activity", "instrument://screen/activity"],
    ["/apps/", "instrument://screen/apps"],
    ["/apps/slack", "instrument://app/slack"],
    ["/new-tab", undefined],
    ["/chats/?draft=d1", undefined],
    ["/files?path=&root=recents%3A", undefined],
  ])("%s is %s", (href, address) => {
    expect(addressOfHref(href, HOME)).toBe(address);
  });
});

it("reads a page's address off its tab, and none for a blank one", () => {
  expect(
    instrumentAddressOf({ kind: "page", url: "https://example.com/a" }),
  ).toBe("https://example.com/a");
  expect(
    instrumentAddressOf({ kind: "page", url: "about:blank" }),
  ).toBeUndefined();
});

it("finds a built-in page by its href or a part under it", () => {
  expect(screenNameOfHref("/activity")).toBe("activity");
  expect(screenNameOfHref("/activity/requests")).toBe("activity");
  expect(screenNameOfHref("/nowhere")).toBeUndefined();
});

describe("targetOfAddress", () => {
  it.each([
    ["https://example.com/", { kind: "page", url: "https://example.com/" }],
    ["instrument://chat/abc", { href: "/chats/abc", kind: "screen" }],
    [
      "instrument://screen/activity",
      { href: "/screen/activity", kind: "screen" },
    ],
    [
      "instrument://file/Users/mac-user/Downloads/",
      { isFolder: true, kind: "path", path: "/Users/mac-user/Downloads" },
    ],
    [
      fileAddressOf("/Users/mac-user/Notes/plan #2.md"),
      {
        isFolder: false,
        kind: "path",
        path: "/Users/mac-user/Notes/plan #2.md",
      },
    ],
    ["instrument://nowhere/x", undefined],
  ])("%s", (address, target) => {
    expect(targetOfAddress(address)).toEqual(target);
  });
});

it("takes two spellings of the app's address as one", () => {
  expect(
    sameAddress(
      "instrument://file/Users/mac-user/My Notes/",
      "instrument://FILE/Users/mac-user/My%20Notes",
    ),
  ).toBe(true);
  expect(sameAddress("https://example.com", "https://example.com/")).toBe(true);
  expect(sameAddress("instrument://chat/a", "instrument://chat/b")).toBe(false);
});
