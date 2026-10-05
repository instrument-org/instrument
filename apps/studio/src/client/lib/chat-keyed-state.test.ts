import { ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  convertChatKeyedState,
  hasChatKeyedState,
  sessionsInChatKeyedState,
} from "./chat-keyed-state";

const CHAT_SESSION = "ses_01JAAAAAAAAAAAAAAAAAAAAAAA";
const GONE_SESSION = "ses_01JBBBBBBBBBBBBBBBBBBBBBBB";
const PAGE_SESSION = "ses_01JCCCCCCCCCCCCCCCCCCCCCCC";
const CHAT = ChatIdSchema.parse("2026-10-01-roofer");

function storageOf(entries: Record<string, unknown>) {
  const kept = new Map(
    Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)]),
  );
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    kept: () =>
      Object.fromEntries(
        [...kept].map(([key, value]): [string, unknown] => [
          key,
          JSON.parse(value),
        ]),
      ),
    removeItem: (key: string) => {
      kept.delete(key);
    },
    setItem: (key: string, value: string) => {
      kept.set(key, value);
    },
  };
}

describe("convertChatKeyedState", () => {
  it("names every chat by its id, in keys, addresses and floating windows, and leaves a page's session alone", () => {
    const storage = storageOf({
      "studio.app-tabs.v1": {
        selectedId: "a",
        tabs: [
          {
            history: {
              entries: ["/chats", `/chats/${CHAT_SESSION}`],
              index: 1,
            },
            id: "a",
            pathname: `/chats/${CHAT_SESSION}`,
          },
        ],
      },
      "studio.chat-group.v1": CHAT_SESSION,
      "studio.compose.v1": [
        { kind: "chat", placement: "docked", sessionId: CHAT_SESSION },
        { kind: "chat", placement: "bar", sessionId: GONE_SESSION },
        { draftId: "d1", kind: "draft", placement: "docked" },
      ],
      "studio.pane-open.v1": { [CHAT_SESSION]: false, "draft:d1": true },
      "studio.window-tabs.v8": {
        activeByGroup: { [CHAT_SESSION]: PAGE_SESSION },
        tabs: [
          {
            group: CHAT_SESSION,
            id: PAGE_SESSION,
            kind: "page",
            past: [
              {
                group: CHAT_SESSION,
                href: `/tasks?chat=${CHAT_SESSION}`,
                id: "screen-1",
                kind: "screen",
              },
            ],
            url: "https://example.com/",
          },
        ],
      },
    });

    expect(hasChatKeyedState(storage)).toBe(true);
    expect(sessionsInChatKeyedState(storage).toSorted()).toEqual([
      CHAT_SESSION,
      GONE_SESSION,
      PAGE_SESSION,
    ]);
    convertChatKeyedState(storage, new Map([[CHAT_SESSION, CHAT]]));

    expect(hasChatKeyedState(storage)).toBe(false);
    expect(storage.kept()).toMatchInlineSnapshot(`
      {
        "studio.app-tabs.v2": {
          "selectedId": "a",
          "tabs": [
            {
              "history": {
                "entries": [
                  "/chats",
                  "/chats/2026-10-01-roofer",
                ],
                "index": 1,
              },
              "id": "a",
              "pathname": "/chats/2026-10-01-roofer",
            },
          ],
        },
        "studio.chat-group.v2": "2026-10-01-roofer",
        "studio.compose.v2": [
          {
            "chatId": "2026-10-01-roofer",
            "kind": "chat",
            "placement": "docked",
          },
          {
            "draftId": "d1",
            "kind": "draft",
            "placement": "docked",
          },
        ],
        "studio.pane-open.v2": {
          "2026-10-01-roofer": false,
          "draft:d1": true,
        },
        "studio.window-tabs.v9": {
          "activeByGroup": {
            "2026-10-01-roofer": "ses_01JCCCCCCCCCCCCCCCCCCCCCCC",
          },
          "tabs": [
            {
              "group": "2026-10-01-roofer",
              "id": "ses_01JCCCCCCCCCCCCCCCCCCCCCCC",
              "kind": "page",
              "past": [
                {
                  "group": "2026-10-01-roofer",
                  "href": "/tasks?chat=2026-10-01-roofer",
                  "id": "screen-1",
                  "kind": "screen",
                },
              ],
              "url": "https://example.com/",
            },
          ],
        },
      }
    `);
  });

  it("leaves a value already kept under its new key, and drops the old one", () => {
    const storage = storageOf({
      "studio.chat-group.v1": CHAT_SESSION,
      "studio.chat-group.v2": "2026-10-02-trip",
    });
    convertChatKeyedState(storage, new Map([[CHAT_SESSION, CHAT]]));
    expect(storage.kept()).toEqual({
      "studio.chat-group.v2": "2026-10-02-trip",
    });
  });

  it("has nothing to do once nothing is kept under the old keys", () => {
    const storage = storageOf({ "studio.window-tabs.v9": { tabs: [] } });
    expect(hasChatKeyedState(storage)).toBe(false);
    expect(sessionsInChatKeyedState(storage)).toEqual([]);
  });
});
