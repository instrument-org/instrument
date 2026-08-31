/**
 * A favicon for any URL, served by a third party that has already fetched it.
 *
 * Which means what is asked for reaches that service whenever one of these is
 * drawn, with no click in between, so where a favicon is shown is also a
 * decision about what leaves the machine.
 *
 * Only the origin is asked for, never the URL as written. An icon belongs to a
 * site rather than to a page, so the path and query buy nothing and are the
 * half worth keeping: a link a model quoted or a person pasted carries document
 * ids, ticket numbers, search terms, and signed parameters, and every one of
 * those would otherwise be handed over to draw a twelve-pixel image. Asking per
 * origin also collapses every link to one host onto a single cached request.
 *
 * A source that is not a parseable URL is passed through as it was written, so
 * the caller's own handling of a malformed href is what decides.
 */
export function getFaviconUrl(url: string): string {
  const origin = URL.canParse(url) ? new URL(url).origin : url;
  return `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(origin)}&size=64`;
}
