import { type Session } from "electron";
import { z } from "zod";

/** The engine's answer: the words asked about, then what it would finish them as. */
const SuggestionsSchema = z.tuple(
  [z.string(), z.array(z.string())],
  z.unknown(),
);

/** How long the engine has to answer before the field goes without. */
const TIMEOUT_MS = 3000;

/**
 * Makes the browser's first contact with the search engine ahead of the first
 * search. Google serves a results page asked for over HTTP/3 and answers one
 * asked for over HTTP/2 with its bot check, and Chromium learns that a host
 * speaks HTTP/3 from an earlier answer. Asks for an empty answer, with no
 * cookies and no words. See `docs/findings/google-refuses-a-search-over-http-2.md`.
 */
export async function contactSearchEngine(
  browserSession: Pick<Session, "fetch">,
): Promise<void> {
  try {
    await browserSession.fetch("https://www.google.com/generate_204", {
      credentials: "omit",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Offline or refused: the search still goes out, over whatever it can.
  }
}

/**
 * What the search engine would finish words typed into the address field as.
 * Asked through the browser's own session, whose headers it carries, without
 * the cookies that would name a signed-in account. A slow or failed answer is
 * no suggestions: the field still searches for what was typed.
 */
export async function suggestSearches(
  browserSession: Pick<Session, "fetch">,
  {
    locale,
    query,
    signal,
  }: { locale: string; query: string; signal?: AbortSignal | undefined },
): Promise<string[]> {
  const url = new URL("https://www.google.com/complete/search");
  // The answer's format, the OpenSearch one; `chrome` answers in another.
  url.searchParams.set("client", "firefox");
  url.searchParams.set("hl", locale);
  url.searchParams.set("oe", "utf-8");
  url.searchParams.set("q", query);
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const response = await browserSession.fetch(url.href, {
      credentials: "omit",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      return [];
    }
    const body = SuggestionsSchema.safeParse(await response.json());
    return body.success ? body.data[1] : [];
  } catch {
    return [];
  }
}
