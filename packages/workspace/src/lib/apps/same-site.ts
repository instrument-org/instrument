/**
 * The part of a host a site is registered under: its last two labels, or
 * three where the last two are a country's own second level (`shop.co.uk`).
 * A guess at the public suffix list, enough to tell a site from its
 * neighbors without carrying the list.
 */
function siteOf(host: string): string {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  const [second = "", top = ""] = labels.slice(-2);
  const keep = top.length === 2 && second.length <= 3 ? 3 : 2;
  return labels.slice(-keep).join(".");
}

/**
 * Whether a host is on the site an address is: the same registered domain,
 * so a site's sign-in on a neighboring host counts for it
 * (`accounts.shopify.com` for `admin.shopify.com`, `www.amazon.com` for
 * `amazon.com`), since a site that is signed out sends its front page there.
 * Kept free of imports, since the window reads it too.
 */
export function onSameSite(host: string, url: string): boolean {
  let other: string;
  try {
    other = new URL(url).hostname;
  } catch {
    return false;
  }
  if (host === "" || other === "") {
    return false;
  }
  return siteOf(host) === siteOf(other);
}
