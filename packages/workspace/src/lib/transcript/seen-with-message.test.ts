import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { StoreId } from "../../schemas/store-id";
import { seenChipOf } from "./seen-with-message";
import {
  type TranscriptMessage,
  transcriptMessage,
} from "./transcript-message";
import { turnsOf, type TurnsCache } from "./turns-of";

type View = SessionMessageDataPart.ViewContextDataPart;

const pageAt = (url: string, title = "A page"): View => ({
  page: { title, url },
  screen: "browser",
  url,
});

describe("seenChipOf", () => {
  it.each<[string, View, string | undefined]>([
    ["a page", pageAt("https://a.test/", "A"), "page A https://a.test/"],
    [
      "a page with no words read",
      { screen: "browser", url: "https://a.test/x" },
      "page a.test https://a.test/x",
    ],
    ["an empty browser", { screen: "browser", url: "about:blank" }, undefined],
    [
      "a file",
      { file: { name: "a.md", path: "/w/a.md" }, screen: "file" },
      "file:/w/a.md",
    ],
    [
      "a folder",
      { folder: { display: "~/Work", selected: [] }, screen: "computer" },
      "folder:~/Work",
    ],
    [
      "a selection",
      {
        folder: { display: "~/Work", selected: ["a.md", "Old/"] },
        screen: "computer",
      },
      "file:~/Work/a.md folder:~/Work/Old",
    ],
    [
      "a selection on Windows",
      {
        folder: { display: "C:\\Work", selected: ["a.md"] },
        screen: "computer",
      },
      "file:C:\\Work\\a.md",
    ],
    [
      "the recents",
      { folder: { display: "Recents", selected: [] }, screen: "computer" },
      undefined,
    ],
    [
      "an app",
      {
        app: { name: "Gmail", slug: "gmail", standing: "connected" },
        screen: "apps",
        url: "/apps/gmail",
      },
      "screen Gmail /apps/gmail",
    ],
    ["the conversation", { screen: "conversation" }, undefined],
    ["a new tab", { screen: "home" }, undefined],
  ])("reads %s", (_name, view, expected) => {
    const chip = seenChipOf(view);
    const said =
      chip?.kind === "paths"
        ? chip.items.map(({ kind, path }) => `${kind}:${path}`).join(" ")
        : chip?.kind === "chat"
          ? chip.id
          : chip && `${chip.kind} ${chip.title} ${chip.url}`;
    expect(said).toBe(expected);
  });
});

describe("what was beside a message", () => {
  const sessionId = StoreId.newSessionId();
  const sent = (view?: View): TranscriptMessage => {
    const id = StoreId.newMessageId();
    const metadata = () => ({
      createdAt: new Date(),
      id: StoreId.newPartId(),
      messageId: id,
      sessionId,
    });
    const light = transcriptMessage({
      id,
      metadata: { createdAt: new Date(), sessionId },
      parts: [
        { metadata: metadata(), text: "do this", type: "text" },
        ...(view
          ? [
              {
                data: view,
                metadata: metadata(),
                type: "data-viewContext" as const,
              },
            ]
          : []),
      ],
      role: "user",
      // A stored message as the store hands it back; only the fields read here.
    } as unknown as SessionMessage.WithParts);
    if (!light) {
      throw new Error("Not a transcript message");
    }
    return light;
  };
  const seenIn = (messages: TranscriptMessage[], cache?: TurnsCache) =>
    turnsOf(messages, { isRunning: false, sessionId }, cache).map((turn) =>
      turn.opener?.seen?.kind === "page" ? turn.opener.seen.url : undefined,
    );
  const a = "https://a.test/";
  const b = "https://b.test/";

  it("is named when it changes, and not again after a message with nothing beside it", () => {
    expect(
      seenIn([
        sent(pageAt(a)),
        sent(pageAt(a, "Retitled")),
        sent({ screen: "conversation" }),
        sent(pageAt(a)),
        sent(pageAt(b)),
        sent(pageAt(a)),
      ]),
    ).toEqual([a, undefined, undefined, undefined, b, a]);
  });

  it("is not named again for a page of the same site and title", () => {
    expect(
      seenIn([
        sent(pageAt(`${a}cart`, "Returns")),
        sent(pageAt(`${a}contract`, "Returns")),
        sent(pageAt(`${a}orders`, "Orders")),
        sent(pageAt(`${b}cart`, "Orders")),
      ]),
    ).toEqual([`${a}cart`, undefined, `${a}orders`, `${b}cart`]);
  });

  it("is not named beside the same thing attached", () => {
    expect(
      seenIn([
        sent({
          ...pageAt(a),
          attached: [{ kind: "page", title: "A", url: a }],
        }),
      ]),
    ).toEqual([undefined]);
  });

  it("is worked out again when earlier messages arrive", () => {
    const cache: TurnsCache = new Map();
    const last = sent(pageAt(a));
    expect(seenIn([last], cache)).toEqual([a]);
    expect(seenIn([sent(pageAt(a)), last], cache)).toEqual([a, undefined]);
  });
});
