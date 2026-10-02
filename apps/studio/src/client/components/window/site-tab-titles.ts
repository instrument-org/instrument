/**
 * Where a site's name is joined to the page's in a title, in the order a
 * title's own words would be read.
 */
const SEPARATORS = [": ", " - ", " – ", " — ", " | ", " · ", " • "];

/**
 * Site tabs' titles with what two or more tabs of one site share dropped:
 * `Amazon.com: Splenda` and `Amazon.com: Stevia` read `Splenda` and
 * `Stevia`, and `Cat - Wikipedia` and `Dog - Wikipedia` read `Cat` and
 * `Dog`, the site said once by the favicon beside each. Only whole parts
 * go, cut at a separator; a tab alone on its site, or one whose title would
 * be left empty, keeps its title. Keyed as the tabs are.
 */
export function siteTabTitles(
  tabs: readonly { key: string; title: string; url?: string | undefined }[],
): Map<string, string> {
  const bySite = new Map<
    string,
    { key: string; title: string; url?: string | undefined }[]
  >();
  for (const tab of tabs) {
    const site = siteOf(tab.url);
    if (site === undefined) {
      continue;
    }
    bySite.set(site, [...(bySite.get(site) ?? []), tab]);
  }
  const titles = new Map<string, string>();
  for (const sameSite of bySite.values()) {
    // What the site's tabs share is read from the pages that have said what
    // they are. A tab still loading stands under its address, or under
    // nothing, and counting it would have the shared part vanish from every
    // tab of the site for the moment a new one takes to load.
    const loaded = new Set(
      sameSite.filter((tab) => !isAddress(tab)).map((tab) => tab.title),
    );
    if (loaded.size < 2) {
      continue;
    }
    const all = [...loaded];
    const prefix = sharedPart(all, "start");
    const suffix = sharedPart(all, "end");
    for (const tab of sameSite) {
      const start = prefix !== "" && tab.title.startsWith(prefix) ? prefix : "";
      const end = suffix !== "" && tab.title.endsWith(suffix) ? suffix : "";
      const shortened = tab.title
        .slice(start.length, tab.title.length - end.length)
        .trim();
      if (shortened !== "" && shortened !== tab.title) {
        titles.set(tab.key, shortened);
      }
    }
  }
  return titles;
}

/** Whether a tab's title is only its address, the way a page is named before it says. */
function isAddress(tab: { title: string; url?: string | undefined }) {
  const title = tab.title.trim();
  if (title === "" || tab.url === undefined) {
    return true;
  }
  const bare = tab.url.replace(/^[a-z]+:\/\//i, "").replace(/\/$/, "");
  return title === tab.url || bare.startsWith(title.replace(/\/$/, ""));
}

/** The host a page is on, without the `www.` most sites answer to either way. */
function siteOf(url: string | undefined): string | undefined {
  if (url === undefined) {
    return;
  }
  try {
    const { host, protocol } = new URL(url);
    return /^https?:$/.test(protocol) ? host.replace(/^www\./, "") : undefined;
  } catch {
    return;
  }
}

/**
 * The longest run every title starts (or ends) with that stops at a
 * separator, separator included, and leaves something of every title.
 */
function sharedPart(titles: string[], from: "end" | "start"): string {
  const [first = "", ...rest] = titles;
  let length = 0;
  const at = (title: string, index: number) =>
    from === "start" ? title[index] : title[title.length - 1 - index];
  while (
    length < first.length &&
    rest.every((title) => at(title, length) === at(first, length))
  ) {
    length += 1;
  }
  const common =
    from === "start"
      ? first.slice(0, length)
      : first.slice(first.length - length);
  // Cut back to the last whole separator inside the shared run.
  let best = "";
  for (const separator of SEPARATORS) {
    const index =
      from === "start"
        ? common.lastIndexOf(separator)
        : common.indexOf(separator);
    if (index === -1) {
      continue;
    }
    const part =
      from === "start"
        ? common.slice(0, index + separator.length)
        : common.slice(index);
    if (part.length > best.length) {
      best = part;
    }
  }
  const shortest = Math.min(...titles.map((title) => title.length));
  return best.length < shortest ? best : "";
}
