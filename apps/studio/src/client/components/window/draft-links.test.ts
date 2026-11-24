import { ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { type DraftLink, withDraftLinks } from "./draft-links";

const CHAT = ChatIdSchema.parse("2026-10-19-what-s-my-latest-tweet");
const LINKS: DraftLink[] = [
  { kind: "link", url: "https://example.com/" },
  { kind: "link", url: "instrument://app/notion" },
  { chat: CHAT, kind: "chat" },
];
const OPTIONS = {
  chatTitle: () => "Tweets",
  screen: "conversation" as const,
};

describe("what a draft names by its address", () => {
  it("goes with the message, beside what was on screen", () => {
    expect(
      withDraftLinks(
        { chat: { id: "c", title: "Other" }, screen: "home" },
        LINKS,
        OPTIONS,
      ),
    ).toEqual({
      attached: [
        {
          kind: "page",
          title: "https://example.com/",
          url: "https://example.com/",
        },
        {
          kind: "screen",
          title: "instrument://app/notion",
          url: "instrument://app/notion",
        },
        { id: CHAT, kind: "chat", title: "Tweets" },
      ],
      chat: { id: "c", title: "Other" },
      links: [
        { url: "https://example.com/" },
        { url: "instrument://app/notion" },
        { title: "Tweets", url: `instrument://chat/${CHAT}` },
      ],
      screen: "home",
    });
  });

  it("goes where nothing was read of the screen", () => {
    expect(withDraftLinks(undefined, LINKS, OPTIONS)?.links).toHaveLength(3);
    expect(withDraftLinks(undefined, LINKS, OPTIONS)?.screen).toBe(
      "conversation",
    );
  });

  it("does not say a page opened as a tab is open nowhere", () => {
    const sent = withDraftLinks(undefined, LINKS, {
      ...OPTIONS,
      opened: ["https://example.com/"],
    });
    expect(sent?.links?.map((link) => link.url)).not.toContain(
      "https://example.com/",
    );
    expect(sent?.attached).toHaveLength(3);
  });

  it("leaves a message that names nothing as it was", () => {
    expect(withDraftLinks(undefined, [], OPTIONS)).toBeUndefined();
  });
});
