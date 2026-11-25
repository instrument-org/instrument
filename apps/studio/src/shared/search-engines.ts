import { z } from "zod";

export const SearchEngineIdSchema = z.enum([
  "google",
  "duckduckgo",
  "bing",
  "brave",
  "kagi",
]);

export type SearchEngineId = z.output<typeof SearchEngineIdSchema>;

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = "google";

/**
 * The engines words typed into the address field can be searched with, in the
 * order they are offered. `suggest` is where each says what it would finish
 * the words as, in the OpenSearch format: the words, then a list.
 */
export const SEARCH_ENGINES: Record<
  SearchEngineId,
  {
    name: string;
    results: string;
    suggest: (input: { locale: string; query: string }) => string;
  }
> = {
  google: {
    name: "Google",
    results: "https://www.google.com/search?q=",
    suggest: ({ locale, query }) =>
      // `firefox` is the OpenSearch format; `chrome` answers in another.
      `https://www.google.com/complete/search?${new URLSearchParams({ client: "firefox", hl: locale, oe: "utf-8", q: query }).toString()}`,
  },
  duckduckgo: {
    name: "DuckDuckGo",
    results: "https://duckduckgo.com/?q=",
    suggest: ({ locale, query }) =>
      `https://duckduckgo.com/ac/?${new URLSearchParams({ kl: duckDuckGoRegion(locale), q: query, type: "list" }).toString()}`,
  },
  bing: {
    name: "Bing",
    results: "https://www.bing.com/search?q=",
    suggest: ({ locale, query }) =>
      `https://api.bing.com/osjson.aspx?${new URLSearchParams({ query, language: locale }).toString()}`,
  },
  brave: {
    name: "Brave Search",
    results: "https://search.brave.com/search?q=",
    suggest: ({ query }) =>
      `https://search.brave.com/api/suggest?${new URLSearchParams({ q: query }).toString()}`,
  },
  kagi: {
    name: "Kagi",
    results: "https://kagi.com/search?q=",
    suggest: ({ query }) =>
      `https://kagisuggest.com/api/autosuggest?${new URLSearchParams({ q: query }).toString()}`,
  },
};

/**
 * The engine's region code for a locale, `en-US` as `us-en`; `wt-wt` (no
 * region) when the locale names no country.
 */
function duckDuckGoRegion(locale: string) {
  const [language, country] = locale.toLowerCase().split(/[-_]/);
  return language && country ? `${country}-${language}` : "wt-wt";
}
