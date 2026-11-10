import { describe, expect, it } from "vitest";

import {
  chatAddressOf,
  chatIdNamedBy,
  filePathOfInstrumentLink,
  instrumentLinkOf,
  instrumentUrlOf,
  OUTSIDE_FILES_MAX,
  OUTSIDE_WORDS_MAX,
  outsideLinkOf,
  projectOfLink,
} from "./instrument-link";

describe("instrumentLinkOf", () => {
  it.each([
    [
      "instrument://task/ses_01J9TASK",
      {
        href: "/tasks/ses_01J9TASK",
        kind: "task",
        name: "ses_01J9TASK",
      },
    ],
    [
      "instrument://chat/ses_01J9",
      {
        href: "/chats/ses_01J9",
        kind: "chat",
        name: "ses_01J9",
      },
    ],
    [
      "instrument://memory/no-stevia",
      {
        href: "/memory/no-stevia",
        kind: "memory",
        name: "no-stevia",
      },
    ],
    [
      "instrument://app/linear",
      { href: "/apps/linear", kind: "app", name: "linear" },
    ],
    [
      "instrument://skill/create-page",
      {
        href: "/skills/create-page",
        kind: "skill",
        name: "create-page",
      },
    ],
    [
      "instrument://skill/instrument:create-page",
      {
        href: "/skills/instrument:create-page",
        kind: "skill",
        name: "instrument:create-page",
      },
    ],
    [
      "instrument://settings/zoom",
      { href: "/settings/zoom", kind: "settings", name: "zoom" },
    ],
    [
      "instrument://settings/provider:openai-1",
      {
        href: "/settings/provider:openai-1",
        kind: "settings",
        name: "provider:openai-1",
      },
    ],
    [
      "instrument://screen/shortcuts",
      { href: "/screen/shortcuts", kind: "screen", name: "shortcuts" },
    ],
    [
      "instrument://project/prj_01JDAILY",
      { href: "/projects/prj_01JDAILY", kind: "project", name: "prj_01JDAILY" },
    ],
    [
      "INSTRUMENT://Task/ses_01J9TASK",
      {
        href: "/tasks/ses_01J9TASK",
        kind: "task",
        name: "ses_01J9TASK",
      },
    ],
  ])("reads %s", (url, expected) => {
    expect(instrumentLinkOf(url)).toEqual(expected);
  });

  it.each([
    ["a task with no id", "instrument://task"],
    ["a name with a path under it", "instrument://task/ses_01J9TASK/files"],
    ["a name with characters no name has", "instrument://memory/no%20stevia"],
    ["a noun the app has no screen for", "instrument://topic/general"],
    ["a chat by its old name", "instrument://thread/ses_01J9"],
    ["a name every object has", "instrument://constructor/x"],
    ["the file channel", "instrument://computer-abc123/Users/me/notes.md"],
    ["a web address", "https://instrument.page/task/ses_01J9TASK"],
    ["a path", "work/report.md"],
    ["nothing", ""],
  ])("names nothing for %s", (_case, url) => {
    expect(instrumentLinkOf(url)).toBeUndefined();
  });
});

describe("instrumentUrlOf", () => {
  it.each([
    ["/tasks/ses_01J9TASK", "instrument://task/ses_01J9TASK"],
    ["/chats/ses_01J9", "instrument://chat/ses_01J9"],
    ["/memory/no-stevia", "instrument://memory/no-stevia"],
    ["/apps/linear", "instrument://app/linear"],
    ["/skills/create-page", "instrument://skill/create-page"],
    ["/projects/prj_01JDAILY", "instrument://project/prj_01JDAILY"],
    [
      "/skills/instrument%3Acreate-page",
      "instrument://skill/instrument:create-page",
    ],
    ["/chats/ses_01J9?tab=1", "instrument://chat/ses_01J9"],
  ])("writes %s as %s", (href, url) => {
    expect(instrumentUrlOf(href)).toBe(url);
  });

  it.each([
    ["the tasks as a whole", "/tasks"],
    ["the apps as a whole", "/apps"],
    ["a screen with no noun", "/activity"],
    ["the new tab", "/new-tab"],
    ["a thing under a thing", "/tasks/ses_01J9TASK/files"],
  ])("writes nothing for %s", (_case, href) => {
    expect(instrumentUrlOf(href)).toBeUndefined();
  });

  it("reads back what it wrote", () => {
    const href = "/skills/create-page";
    expect(instrumentLinkOf(instrumentUrlOf(href) ?? "")?.href).toBe(href);
  });
});

describe("projectOfLink", () => {
  const projects = [
    { id: "prj_01JDAILY", name: "Daily" },
    { id: "prj_01JTRIPS", name: "Trips", retired: true },
    // A name that is another project's id loses to the id.
    { id: "prj_01JODD", name: "prj_01JDAILY" },
  ];

  it.each([
    ["an id", "prj_01JDAILY", "prj_01JDAILY"],
    ["a name", "Daily", "prj_01JDAILY"],
    ["a name in another case", "daily", "prj_01JDAILY"],
    ["a retired project", "prj_01JTRIPS", undefined],
    ["a retired project by name", "Trips", undefined],
    ["no project", "Weekly", undefined],
  ])("reads %s", (_case, name, id) => {
    expect(projectOfLink(projects, name)?.id).toBe(id);
  });
});

describe("filePathOfInstrumentLink", () => {
  it.each([
    [
      "instrument://file//Users/sam/Journal/2026-09-23.md",
      "/Users/sam/Journal/2026-09-23.md",
    ],
    [
      "instrument://file/Users/sam/Journal/2026-09-23.md",
      "/Users/sam/Journal/2026-09-23.md",
    ],
    ["instrument://File/Users/sam/My%20Notes/a.md", "/Users/sam/My Notes/a.md"],
    ["instrument://file/", undefined],
    ["instrument://chat/ses_01", undefined],
    ["https://file/Users/sam/a.md", undefined],
  ])("%s", (url, path) => {
    expect(filePathOfInstrumentLink(url)).toBe(path);
  });
});

describe("outsideLinkOf", () => {
  it.each([
    ["instrument://chat/ses_01J9", { href: "/chats/ses_01J9", kind: "screen" }],
    [
      "instrument://file/Users/sam/My%20Notes/a.md",
      { kind: "file", path: "/Users/sam/My Notes/a.md" },
    ],
    [
      "instrument://file/C:/Users/sam/a.md",
      { kind: "file", path: "/C:/Users/sam/a.md" },
    ],
    [
      "instrument://new?text=Plan%20my%20week",
      { kind: "new", words: "Plan my week" },
    ],
    [
      "instrument://new/?text=Plan&project=01JPROJECT",
      { kind: "new", project: "01JPROJECT", words: "Plan" },
    ],
    [
      "instrument://new?text=Plan&project=not%20a%20name",
      { kind: "new", words: "Plan" },
    ],
    ["instrument://new", { kind: "new", words: "" }],
    [
      "instrument://NEW?text=%20%20spaced%20%20",
      { kind: "new", words: "spaced" },
    ],
    [
      // A zero-width space, a right-to-left override and a tag character.
      "instrument://new?text=a%E2%80%8Bb%E2%80%AEc%F3%A0%80%81d",
      { kind: "new", words: "abcd" },
    ],
    [
      // The astronaut keeps the joiner it is made with.
      "instrument://new?text=%F0%9F%91%A8%E2%80%8D%F0%9F%9A%80",
      { kind: "new", words: "👨‍🚀" },
    ],
    [
      `instrument://new?text=${"a".repeat(OUTSIDE_WORDS_MAX)}`,
      { kind: "new", words: "a".repeat(OUTSIDE_WORDS_MAX) },
    ],
  ])("reads %s", (url, expected) => {
    expect(outsideLinkOf(url)).toEqual(expected);
  });

  it.each([
    ["words past the limit", `instrument://new?text=${"a".repeat(2001)}`],
    ["a verb with a path under it", "instrument://new/more?text=Plan"],
    ["a web page", "instrument://browser?url=https://example.com"],
    ["another scheme", "https://new?text=Plan"],
    ["a noun with no name", "instrument://chat"],
  ])("opens nothing for %s", (_case, url) => {
    expect(outsideLinkOf(url)).toBeUndefined();
  });

  describe("page", () => {
    it.each([
      ["a slug", "weekly-plan-g6hgcknla553"],
      ["one character", "a"],
      ["digits", "2026"],
      ["sixty-three characters", "a".repeat(63)],
      ["a hyphen inside", "a-b"],
    ])("reads an id of %s", (_case, id) => {
      expect(outsideLinkOf(`instrument://page/${id}`)).toEqual({
        id,
        kind: "page",
      });
    });

    it("reads the noun in any case", () => {
      expect(outsideLinkOf("instrument://PAGE/weekly-plan")).toEqual({
        id: "weekly-plan",
        kind: "page",
      });
    });

    it.each([
      ["no id", "instrument://page"],
      ["no id but a slash", "instrument://page/"],
      ["a leading hyphen", "instrument://page/-weekly"],
      ["a trailing hyphen", "instrument://page/weekly-"],
      ["a capital letter", "instrument://page/Weekly"],
      ["a dot, which would name another host", "instrument://page/a.b"],
      ["an underscore", "instrument://page/a_b"],
      ["a space", "instrument://page/a%20b"],
      ["a percent sign", "instrument://page/a%25b"],
      ["sixty-four characters", `instrument://page/${"a".repeat(64)}`],
      ["a segment under the id", "instrument://page/weekly/index.html"],
      ["a query", "instrument://page/weekly?x=1"],
      ["a fragment", "instrument://page/weekly#top"],
      ["a web address", "https://weekly.instrument.page/"],
    ])("opens nothing for %s", (_case, url) => {
      expect(outsideLinkOf(url)).toBeUndefined();
    });
  });

  describe("files", () => {
    // Written by the website as `encodeURIComponent` writes each path.
    const filesLink = (...paths: string[]) =>
      `instrument://files?${paths.map((each) => `path=${encodeURIComponent(each)}`).join("&")}`;

    it.each([
      ["a space", "/Users/mac-user/My Notes/a.md"],
      ["a plus", "/Users/mac-user/C++/notes+ideas.md"],
      ["an ampersand and an equals sign", "/Users/mac-user/Q&A=1.md"],
      ["a percent sign", "/Users/mac-user/100% done.md"],
      ["unicode", "/Users/mac-user/Café/日本語 📝.md"],
      ["a Windows drive", "C:/Users/windows-user/report.pdf"],
    ])("reads a path with %s as it was written", (_case, written) => {
      expect(outsideLinkOf(filesLink(written))).toEqual({
        kind: "files",
        notOpened: 0,
        paths: [written],
      });
    });

    it("reads a plus written bare as the space it means in a query", () => {
      expect(
        outsideLinkOf("instrument://files/?path=/Users/mac-user/a+b.md"),
      ).toEqual({
        kind: "files",
        notOpened: 0,
        paths: ["/Users/mac-user/a b.md"],
      });
    });

    it("keeps the order written, each path once", () => {
      expect(
        outsideLinkOf(
          filesLink(
            "/Users/mac-user/b.md",
            "/Users/mac-user/a.md",
            "/Users/mac-user/b.md",
            "/Users/mac-user/Notes",
          ),
        ),
      ).toMatchInlineSnapshot(`
        {
          "kind": "files",
          "notOpened": 0,
          "paths": [
            "/Users/mac-user/b.md",
            "/Users/mac-user/a.md",
            "/Users/mac-user/Notes",
          ],
        }
      `);
    });

    it("leaves out web addresses and empty paths", () => {
      expect(
        outsideLinkOf(
          `${filesLink("https://example.com/a.html", "/Users/mac-user/a.md", "HTTP://example.com")}&path=`,
        ),
      ).toMatchInlineSnapshot(`
        {
          "kind": "files",
          "notOpened": 0,
          "paths": [
            "/Users/mac-user/a.md",
          ],
        }
      `);
    });

    it("opens the first paths up to the cap and counts the rest", () => {
      const paths = Array.from(
        { length: OUTSIDE_FILES_MAX + 3 },
        (_, at) => `/Users/mac-user/${at.toString()}.md`,
      );
      expect(outsideLinkOf(filesLink(...paths, paths[0] ?? ""))).toEqual({
        kind: "files",
        notOpened: 3,
        paths: paths.slice(0, OUTSIDE_FILES_MAX),
      });
    });

    it.each([
      ["no path", "instrument://files"],
      [
        "only web addresses",
        "instrument://files?path=https%3A%2F%2Fexample.com",
      ],
      ["a path under the verb", "instrument://files/Users?path=%2Fa.md"],
      ["another parameter", "instrument://files?file=%2FUsers%2Fa.md"],
    ])("opens nothing for %s", (_case, url) => {
      expect(outsideLinkOf(url)).toBeUndefined();
    });
  });
});

describe("chatIdNamedBy", () => {
  it.each([
    [
      "an address",
      chatAddressOf("2026-10-14-quiet-7k3q"),
      "2026-10-14-quiet-7k3q",
    ],
    ["a bare id", " 2026-10-14-quiet-7k3q ", "2026-10-14-quiet-7k3q"],
    ["another kind's address", "instrument://memory/no-stevia", undefined],
    ["nothing", "  ", undefined],
  ])("reads %s", (_name, value, id) => {
    expect(chatIdNamedBy(value)).toBe(id);
  });
});
