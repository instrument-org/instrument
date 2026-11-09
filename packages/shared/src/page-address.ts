/**
 * A page's address without its query or fragment, where a sign-in or reset
 * link carries its token: the address as it leaves this computer, in what
 * the agent reads and in a report. Any other kind of address is kept whole.
 */
export function pageAddress(url: string): string {
  const parsed = URL.parse(url);
  return parsed && (parsed.protocol === "http:" || parsed.protocol === "https:")
    ? `${parsed.origin}${parsed.pathname}`
    : url;
}
