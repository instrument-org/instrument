import { describe, expect, it, vi } from "vitest";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

import { CHATS_PLACE_GROUP, fileOfTabGroup } from "@/shared/kept-state";
import { ChatIdSchema } from "@instrument-org/workspace/client";

import { groupOfHref } from "./app-tabs";
import {
  CHATS_PLACE_HREF,
  firstChatHref,
  isChatsPlaceHref,
  placeArrivalHref,
} from "./chats-place";
import { CHATS_INDEX_HREF, chatHref, groupHref } from "./window-href";

const LISBON = ChatIdSchema.parse("2026-11-10-lisbon");
const PARIS = ChatIdSchema.parse("2026-11-10-paris");
const ROME = ChatIdSchema.parse("2026-11-10-rome");

const chat = (
  id: typeof LISBON,
  lastUserMessageAt: number,
  archived = false,
) => ({ archived, id, lastUserMessageAt });

const CHATS = [chat(LISBON, 1), chat(PARIS, 3), chat(ROME, 2)];

describe("the Chats place's address", () => {
  it("stands on no group, so no group is up while the place is", () => {
    expect(isChatsPlaceHref(CHATS_PLACE_HREF)).toBe(true);
    expect(groupOfHref(CHATS_PLACE_HREF)).toBeUndefined();
  });

  it("is not a group's address", () => {
    expect(isChatsPlaceHref(groupHref("group:a"))).toBe(false);
    expect(groupOfHref(groupHref("group:a"))).toBe("group:a");
  });

  it("keeps its group in the window's own file", () => {
    expect(fileOfTabGroup(CHATS_PLACE_GROUP)).toBe("window");
    expect(fileOfTabGroup("group:a")).toBe("groups");
  });
});

describe("the chat the place shows", () => {
  it.each([
    ["the newest in the inbox", CHATS, undefined, chatHref(PARIS)],
    ["the next newest past one going", CHATS, PARIS, chatHref(ROME)],
    [
      "none archived",
      [chat(PARIS, 3, true), chat(LISBON, 1)],
      undefined,
      chatHref(LISBON),
    ],
    ["the Chats page with no chat", [], undefined, CHATS_INDEX_HREF],
    [
      "the Chats page with only the one going",
      [chat(PARIS, 3)],
      PARIS,
      CHATS_INDEX_HREF,
    ],
  ] satisfies [
    string,
    ReturnType<typeof chat>[],
    typeof LISBON | undefined,
    string,
  ][])("takes %s", (_case, chats, except, href) => {
    expect(firstChatHref(chats, except)).toBe(href);
  });

  it.each([
    ["the chat last viewed", chatHref(ROME), chatHref(ROME)],
    ["the first chat on a first visit", undefined, chatHref(PARIS)],
    [
      "the first chat once the last one viewed is gone",
      chatHref(ChatIdSchema.parse("2026-11-10-oslo")),
      chatHref(PARIS),
    ],
    ["the first chat from the Chats page", CHATS_INDEX_HREF, chatHref(PARIS)],
  ])("arrives at %s", (_case, shown, href) => {
    expect(placeArrivalHref(shown, CHATS)).toBe(href);
  });
});
