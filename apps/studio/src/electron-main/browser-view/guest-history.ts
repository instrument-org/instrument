import { isPageEditAddress } from "@instrument-org/shared";

/**
 * A guest's whole history as another guest comes back on it, with what
 * Chromium keeps of each page, without the blank page every guest starts on.
 * None for a guest that has been nowhere.
 */
export function wholeHistory<Entry extends { url: string }>(
  entries: readonly Entry[],
  index: number,
): { entries: Entry[]; index: number; url: string } | null {
  const url = entries[index]?.url;
  if (url === undefined || url === "about:blank") {
    return null;
  }
  const isPage = (entry: Entry) => entry.url !== "about:blank";
  return {
    entries: entries.filter(isPage),
    index: entries.slice(0, index).filter(isPage).length,
    url,
  };
}

/**
 * A guest's history as another guest can be given it whole, standing on the
 * last entry of `url`'s document at or behind `index`, with what Chromium
 * keeps of each page (where it was scrolled, what its fields had). The pages
 * ahead of that entry are left out. None where the guest has not been there.
 */
export function historyStandingOn<Entry extends { url: string }>(
  entries: readonly Entry[],
  index: number,
  url: string,
): { entries: Entry[]; index: number } | null {
  const at = entries
    .slice(0, index + 1)
    .findLastIndex((entry) => documentOf(entry.url) === documentOf(url));
  if (at === -1 || isPageEditAddress(entries[at]?.url ?? "")) {
    return null;
  }
  const kept = entries
    .slice(0, at + 1)
    .filter(
      (entry) => entry.url !== "about:blank" && !isPageEditAddress(entry.url),
    );
  return kept.length === 0 ? null : { entries: kept, index: kept.length - 1 };
}

/** What tells one document from another: the address without its fragment, or a file however its path was escaped. */
function documentOf(url: string): string {
  const parsed = URL.parse(url);
  if (parsed?.protocol !== "file:") {
    return url.replace(/#.*$/, "");
  }
  try {
    return `file://${parsed.host}${decodeURIComponent(parsed.pathname)}`;
  } catch {
    return `file://${parsed.host}${parsed.pathname}`;
  }
}
