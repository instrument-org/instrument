import { z } from "zod";

/** Where a site keeps data in the in-app browser besides its cookies. */
const SITE_DATA_KINDS = ["IndexedDB", "Local Storage"] as const;

/**
 * A site the in-app browser has cookies, site data or visits for, as the app
 * reads its browser profile and history (`readBrowserSites` on the
 * workspace's config). A site is a registrable domain (`google.com` for
 * `mail.google.com`), so a cookie set for one host and a page on another
 * are the same site.
 */
export const BrowserSiteSchema = z.object({
  /** How many cookies the site has set. */
  cookies: z.number().int(),
  /** The hosts of the site that were visited or keep site data. */
  hosts: z.array(z.string()),
  /** The workspace's own apps whose address is on the site, by id. */
  setUpAs: z.array(z.string()),
  site: z.string(),
  /** Where the site keeps data besides cookies. */
  siteData: z.array(z.enum(SITE_DATA_KINDS)),
  /** When the user last visited a page on the site, epoch ms; none where they never did. */
  usedAt: z.number().optional(),
  /** Pages visited on the site, by the user and by agents. */
  visits: z.object({ agent: z.number().int(), user: z.number().int() }),
});

export type BrowserSite = z.output<typeof BrowserSiteSchema>;
