import { parse } from "tldts";

/**
 * The task browser's address bar doubles as a search box. Input that resolves
 * to a host is navigated to; anything else is treated as a query and handed to
 * a web search, rather than being force-loaded as a (usually broken) https://
 * URL. This mirrors how a browser omnibox routes typed input.
 *
 * Returns the URL to navigate to, or `undefined` for empty input.
 */
export function resolveUrlOrSearch(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }
  // Explicit scheme (https://, file://, ...) or an about: page -> load as typed.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^about:/i.test(trimmed)) {
    return trimmed;
  }
  // Only the authority decides URL-vs-search; a path or query after a real host
  // doesn't turn the input into a search.
  const authority = trimmed.split(/[/?#]/, 1)[0] ?? trimmed;
  if (looksLikeHost(authority)) {
    // Loopback hosts don't serve https by default; everything else defaults to it.
    const scheme = isLoopbackHost(authority) ? "http" : "https";
    return `${scheme}://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function isLoopbackHost(authority: string): boolean {
  const host = authority.replace(/:\d+$/, "").toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "[::1]"
  );
}

function looksLikeHost(authority: string): boolean {
  if (!authority || /\s/.test(authority)) {
    return false;
  }
  if (isLoopbackHost(authority)) {
    return true;
  }
  const host = authority.replace(/:\d+$/, "");
  // A bare hostname with an explicit port -> a dev server or intranet host
  // (e.g. myserver:3000) with no public-suffix TLD to validate against.
  if (host !== authority && host.length > 0) {
    return true;
  }
  // An IP literal, or a hostname whose TLD is in the public suffix list
  // (openai.com, a.b.co.uk) -> navigate. Validating the suffix is what routes a
  // bare word or a phrase-with-a-period ("foo.zzzzz", "node.js tutorial") to
  // search instead of force-loading it as a broken URL.
  const { domain, isIcann, isIp, isPrivate } = parse(host, {
    allowPrivateDomains: true,
  });
  return isIp || (domain != null && (isIcann === true || isPrivate === true));
}
