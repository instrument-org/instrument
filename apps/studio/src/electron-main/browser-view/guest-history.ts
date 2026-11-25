import { isPageEditAddress } from "@instrument-org/shared";

/**
 * What a guest's history comes back as in another window: the page it stood
 * on and the pages behind it, without the blank page every guest starts on.
 * A new guest can only be given its stack before its first load, and that load
 * lands on top of the stack and takes the place of any pages ahead, so those
 * are not kept. None for a guest that has been nowhere.
 */
export function historyToRestore<Entry extends { url: string }>(
  entries: readonly Entry[],
  index: number,
): { behind: Entry[]; url: string } | null {
  const url = entries[index]?.url;
  if (url === undefined || url === "about:blank") {
    return null;
  }
  return {
    behind: entries
      .slice(0, index)
      .filter((entry) => entry.url !== "about:blank"),
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
