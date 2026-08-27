/**
 * A favicon for any URL, served by a third party that has already fetched it.
 *
 * Which means the hostname reaches that service whenever one of these is drawn,
 * so where a favicon is shown is also a decision about what leaves the machine.
 */
export function getFaviconUrl(url: string): string {
  return `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(url)}&size=64`;
}
