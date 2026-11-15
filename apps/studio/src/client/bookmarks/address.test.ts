import { fileHref, folderHref } from "@/shared/computer-href";
import { describe, expect, it } from "vitest";

import {
  addressOfTab,
  fileAddressOf,
  sameAddress,
  targetOfAddress,
} from "./address";

const HOME = "/Users/mac-user";

describe("addressOfTab", () => {
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
    ["/chat-list?q=roof", "instrument://screen/chats"],
    ["/settings/providers", "instrument://settings/providers"],
    ["/settings", "instrument://settings/general"],
    ["/apps/", "instrument://screen/apps"],
    ["/apps/slack", "instrument://app/slack"],
    ["/new-tab", undefined],
    ["/chats/?draft=d1", undefined],
    ["/files?path=&root=recents%3A", undefined],
  ])("%s is %s", (href, address) => {
    expect(addressOfTab({ href, kind: "screen" }, HOME)).toBe(address);
  });
});

it("reads a page's address off its tab, and none for a blank one", () => {
  expect(addressOfTab({ kind: "page", url: "https://example.com/a" })).toBe(
    "https://example.com/a",
  );
  expect(addressOfTab({ kind: "page", url: "about:blank" })).toBeUndefined();
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
