import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { WebSearch } from "../tools/web-search";
import { markRepeatSearchSources } from "./repeat-search-sources";

const sessionId = StoreId.newSessionId();
const at = new Date("2026-10-31T10:00:00Z");

type Source = { text: string; title?: string; url: string };

type SearchResults = Extract<
  Parameters<typeof WebSearch.toModelOutput>[0]["output"],
  { state: "success" }
>["results"];

function search(
  query: string,
  sources: Source[],
  kind: "excerpts" | "summary" = "excerpts",
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  const results: SearchResults =
    kind === "excerpts"
      ? { kind, sources }
      : {
          kind,
          modelId: "search-model",
          provider: { displayName: "Test", id: "instrument", type: "openai" },
          sources: sources.map(({ title, url }) => ({ title, url })),
          text: "A summary.",
          usage: {},
        };
  return {
    id,
    metadata: {
      createdAt: at,
      finishReason: "tool-calls",
      finishedAt: at,
      modelId: "model",
      providerId: "provider",
      sessionId,
    },
    parts: [
      {
        input: { explanation: "Searching", query },
        metadata: {
          createdAt: at,
          endedAt: at,
          id: StoreId.newPartId(),
          messageId: id,
          sessionId,
        },
        output: {
          results,
          state: "success",
        },
        state: "output-available",
        toolCallId: StoreId.ToolCallSchema.parse(`call-${query}`),
        type: "tool-web_search",
      },
    ],
    role: "assistant",
  };
}

/** Each search's sources as `url: pointer` or `url`, in order. */
function marks(messages: SessionMessage.WithParts[]): string[][] {
  return messages.map((message) =>
    message.parts.flatMap((part) =>
      part.type === "tool-web_search" &&
      part.state === "output-available" &&
      part.output.state === "success"
        ? part.output.results.sources.map((source) =>
            "sameAs" in source && source.sameAs
              ? `${source.url} -> ${source.sameAs.position}@${source.sameAs.query}`
              : source.url,
          )
        : [],
    ),
  );
}

function rendered(message: SessionMessage.WithParts): string {
  const part = message.parts[0];
  if (part?.type !== "tool-web_search" || part.state !== "output-available") {
    throw new Error("not a finished search");
  }
  const output = WebSearch.toModelOutput({
    input: part.input,
    output: part.output,
    toolCallId: part.toolCallId,
  });
  return output.type === "text" ? output.value : "";
}

const a = { text: "Alpha page text.", title: "Alpha", url: "https://a.test" };
const b = { text: "Beta page text.", title: "Beta", url: "https://b.test" };
const c = { text: "Gamma page text.", title: "Gamma", url: "https://c.test" };

describe("markRepeatSearchSources", () => {
  it.each([
    {
      name: "no repeats",
      searches: [search("one", [a]), search("two", [b])],
      expected: [["https://a.test"], ["https://b.test"]],
    },
    {
      name: "a repeat across searches",
      searches: [search("one", [a, b]), search("two", [c, b])],
      expected: [
        ["https://a.test", "https://b.test"],
        ["https://c.test", "https://b.test -> 2@one"],
      ],
    },
    {
      name: "a repeat inside one search",
      searches: [search("one", [a, a])],
      expected: [["https://a.test", "https://a.test -> 1@one"]],
    },
    {
      name: "the same page excerpted differently",
      searches: [
        search("one", [a]),
        search("two", [{ ...a, text: "Another part of Alpha." }]),
      ],
      expected: [["https://a.test"], ["https://a.test"]],
    },
    {
      name: "a summary, which has no excerpt to repeat",
      searches: [search("one", [a], "summary"), search("two", [a])],
      expected: [["https://a.test"], ["https://a.test"]],
    },
  ])("marks $name", ({ expected, searches }) => {
    expect(marks(markRepeatSearchSources(searches, undefined))).toEqual(
      expected,
    );
  });

  it("counts nothing a recorded clearing sends as a placeholder", () => {
    const cleared = search("one", [a]);
    const kept = search("two", [a, b]);
    const later = search("three", [a, b]);
    expect(
      marks(markRepeatSearchSources([cleared, kept, later], cleared.id)),
    ).toEqual([
      ["https://a.test"],
      ["https://a.test", "https://b.test"],
      ["https://a.test -> 1@two", "https://b.test -> 2@two"],
    ]);
  });

  it("leaves the stored parts as they were, and every unchanged message the same object", () => {
    const first = search("one", [a]);
    const second = search("two", [a]);
    const before = structuredClone([first, second]);
    const marked = markRepeatSearchSources([first, second], undefined);
    expect([first, second]).toEqual(before);
    expect(marked[0]).toBe(first);
    expect(marked[1]).not.toBe(second);
  });

  it("renders a repeat as a pointer and keeps it in the ranking and sources", () => {
    const [, second] = markRepeatSearchSources(
      [search("cats", [a]), search("dogs", [b, a])],
      undefined,
    );
    if (second === undefined) {
      throw new Error("missing search");
    }
    const text = rendered(second);
    expect(text).toContain(
      '### 2. Alpha\n\n[Same excerpt as result 1 of the web_search for "cats".]',
    );
    expect(text).not.toContain(a.text);
    expect(text).toContain(b.text);
    expect(text).toContain(
      "Sources:\n- [Beta](https://b.test)\n- [Alpha](https://a.test)",
    );
  });

  it("shortens the shown excerpts of a long search as it would beside the repeat", () => {
    const long = (url: string, letter: string) => ({
      text: `${letter.repeat(40)}\n`.repeat(200),
      title: url,
      url,
    });
    const repeat = long("https://r.test", "r");
    const others = [long("https://x.test", "x"), long("https://y.test", "y")];
    const plain = search("two", [repeat, ...others]);
    const [, marked] = markRepeatSearchSources(
      [search("one", [repeat]), plain],
      undefined,
    );
    if (marked === undefined) {
      throw new Error("missing search");
    }
    const withPointer = rendered(marked);
    const without = rendered(plain);
    const shownPart = (text: string) => text.slice(text.indexOf("### 2."));
    expect(shownPart(withPointer)).toBe(shownPart(without));
    expect(withPointer.length).toBeLessThan(without.length - 3_000);
    expect(withPointer).toContain("[Shortened:");
  });
});
