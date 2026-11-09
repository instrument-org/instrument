import { fileHref, folderHref } from "@/shared/computer-href";
import { describe, expect, it } from "vitest";

import { asksMoreThan, isSameTabIdentity, tabIdentityOf } from "./tab-identity";

const HOME = "/Users/mac-user";
const NOTES = `${HOME}/notes.md`;

describe("isSameTabIdentity", () => {
  it.each([
    [
      "a file however far its tab walked",
      fileHref(NOTES),
      `/files?file=${encodeURIComponent(NOTES)}&path=&root=${encodeURIComponent(HOME)}&select=notes.md&tree=${encodeURIComponent(HOME)}&view=columns`,
    ],
    [
      "a folder with its layout and selection",
      folderHref(`${HOME}/Documents`),
      `/files?path=&root=${encodeURIComponent(`${HOME}/Documents`)}&select=a.txt&view=list`,
    ],
    [
      "a folder walked to from the home folder",
      folderHref(`${HOME}/Documents`),
      "/files?path=Documents%2F&root=~&view=icons",
    ],
    ["the home folder", folderHref(HOME), "/files?path=&root=~&view=list"],
    ["a chat", "/chats/2026-10-01-roofer", "/chats/2026-10-01-roofer?x=1"],
    ["a draft", "/chats?draft=d1", "/chats/?draft=d1"],
    ["a task", "/tasks/s1?chat=c1", "/tasks/s1"],
    ["the apps", "/apps", "/apps/"],
    ["an app", "/apps/github", "/apps/github/"],
    ["the release notes", "/release-notes", "/release-notes"],
    ["the extensions", "/extensions", "/extensions"],
  ])("%s", (_, a, b) => {
    expect(isSameTabIdentity(a, b, HOME)).toBe(true);
  });

  it.each([
    ["two files", fileHref(NOTES), fileHref(`${HOME}/other.md`)],
    ["a file and its folder", fileHref(NOTES), folderHref(HOME)],
    ["two folders", folderHref(HOME), folderHref(`${HOME}/Documents`)],
    ["two chats", "/chats/a", "/chats/b"],
    ["a chat and a draft", "/chats/a", "/chats?draft=a"],
    ["two apps", "/apps/github", "/apps/linear"],
    ["the apps and an app", "/apps", "/apps/github"],
  ])("tells apart %s", (_, a, b) => {
    expect(isSameTabIdentity(a, b, HOME)).toBe(false);
  });

  it.each([
    ["a site", "/sites/one"],
    ["the web's start", "/browser"],
    ["a new tab", "/new-tab"],
    ["the inbox", "/chats"],
  ])("gives %s no identity, so it is never one of a kind", (_, href) => {
    expect(tabIdentityOf(href, HOME)).toBeUndefined();
    expect(isSameTabIdentity(href, href, HOME)).toBe(false);
  });
});

describe("asksMoreThan", () => {
  const walkedFile = `/files?file=${encodeURIComponent(NOTES)}&path=&root=~&view=columns`;

  it.each([
    [
      "the notes since a version",
      "/release-notes?since=2.0.0",
      "/release-notes",
      true,
    ],
    [
      "the same notes again",
      "/release-notes?since=2.0.0",
      "/release-notes?since=2.0.0",
      false,
    ],
    [
      "a selection in a folder",
      folderHref(HOME, { select: "a.txt" }),
      "/files?path=&root=%2FUsers%2Fmac-user&view=list",
      true,
    ],
    ["a file's bare address", fileHref(NOTES), walkedFile, false],
    [
      "a file beside the folder it was opened from",
      fileHref(NOTES, { tree: HOME }),
      walkedFile,
      true,
    ],
    ["a draft by its id", "/chats?draft=d1", "/chats/?draft=d1", false],
    ["a task by its chat", "/tasks/s1?chat=c1", "/tasks/s1", false],
  ])("%s", (_, asked, shown, expected) => {
    expect(asksMoreThan(asked, shown)).toBe(expected);
  });
});
