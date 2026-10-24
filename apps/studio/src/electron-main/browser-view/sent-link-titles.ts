import { getHistoryStore } from "@/electron-main/browser-view/history-store";
import {
  fetchPageTitle,
  isPublicPage,
} from "@/electron-main/browser-view/page-title-fetch";
import { logger } from "@/electron-main/lib/electron-logger";
import { normalizeUserAgent } from "@/electron-main/lib/user-agent";
import { splitLinks } from "@/shared/link-text";
import { app } from "electron";
import { unique } from "radashi";

/** How many of one message's links are asked for their titles. */
const MAX_LINKS_PER_MESSAGE = 5;

const asking = new Set<string>();

/**
 * Looks up the title of each page a person's sent message links to by its
 * bare address, so the message draws the link as the page's name.
 *
 * Only for words the person sent: they chose these pages, and the agent
 * usually opens them next anyway. A link the agent or a file wrote is never
 * asked about, since a page the agent read can steer it into writing an
 * address that carries what it read, and asking that address for a title
 * would deliver it with no click. One request a page, from this computer,
 * with no cookies; a page a tab has opened already has its title.
 */
export function lookUpSentLinkTitles(text: string) {
  const store = getHistoryStore();
  const urls = unique(
    splitLinks(text).flatMap((segment) =>
      segment.type === "link" && segment.label === segment.href
        ? [segment.href]
        : [],
    ),
  )
    .filter(
      (url) => isPublicPage(url) && !asking.has(url) && !store.titleOf(url),
    )
    .slice(0, MAX_LINKS_PER_MESSAGE);
  const userAgent = normalizeUserAgent(app.userAgentFallback);
  for (const url of urls) {
    asking.add(url);
    void fetchPageTitle(url, userAgent)
      .then((title) => {
        if (title) {
          store.setFetchedTitle(url, title, Date.now());
        }
      })
      .catch((error: unknown) => {
        logger.info("[link-titles] no title for a sent link", {
          error: String(error),
          host: URL.parse(url)?.hostname,
        });
      })
      .finally(() => {
        asking.delete(url);
      });
  }
}
