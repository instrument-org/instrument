import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { readWebSearchResults } from "./web-search-results";

/**
 * The messages a request sends, with each `web_search` excerpt that an earlier
 * search in them showed byte for byte marked `sameAs` that search, so it is
 * sent as a pointer rather than a second copy (`WebSearch.toModelOutput`).
 *
 * Searches on one topic rank the same pages again, and the backend returns the
 * same excerpt each time: over 18 recorded sessions with searches, 33 of
 * 34 repeated URLs came back with identical text. Only identical text is
 * marked, so a page excerpted differently for another query is shown whole.
 *
 * A search is marked only from the searches before it, so its rendering is
 * fixed once it is sent and the history stays append-only for the provider's
 * cache. What is "before it" is what this request sends: `messages` is the
 * window after any rollover, and searches in messages up to `clearedThrough`
 * neither count as shown nor are marked, since their results go as cleared
 * placeholders (`tool-result-clearing.ts`). Moving either boundary already
 * rewrites the request from that point, so a pointer that turns back into its
 * excerpt then costs nothing more.
 *
 * Copies, never mutates: the stored parts are what the transcript reads.
 */
export function markRepeatSearchSources(
  messages: readonly SessionMessage.WithParts[],
  clearedThrough: StoreId.Message | undefined,
): SessionMessage.WithParts[] {
  const shown = new Map<string, { position: number; query: string }>();
  return messages.map((message) => {
    if (
      message.role === "session-context" ||
      (clearedThrough !== undefined && message.id <= clearedThrough)
    ) {
      return message;
    }
    let changed = false;
    const parts = message.parts.map((part) => {
      if (
        part.type !== "tool-web_search" ||
        part.state !== "output-available" ||
        part.output.state !== "success"
      ) {
        return part;
      }
      const results = readWebSearchResults(part.output);
      if (results?.kind !== "excerpts") {
        return part;
      }
      const query = part.input.query;
      let marked = false;
      const sources = results.sources.map((source, index) => {
        const key = `${source.url}\n${source.text}`;
        const earlier = shown.get(key);
        if (earlier === undefined) {
          shown.set(key, { position: index + 1, query });
          return source;
        }
        marked = true;
        return { ...source, sameAs: earlier };
      });
      if (!marked) {
        return part;
      }
      changed = true;
      return {
        ...part,
        output: { ...part.output, results: { ...results, sources } },
      };
    });
    return changed ? { ...message, parts } : message;
  });
}
