import { getAppCatalog } from "./catalog";
import { type AppManifest } from "./manifest";

/**
 * The site an app is drawn as: the service's own domain, for its icon and
 * its page. The directory knows it for the services it lists; for the rest
 * it is the endpoint's host with the machine-facing prefix taken off, since
 * `mcp.notion.com` and `api.github.com` carry no icon and `notion.com` and
 * `github.com` do. A loopback endpoint has no site.
 */
export function appSiteFor(
  slug: string,
  manifest: AppManifest,
): string | undefined {
  const entry = getAppCatalog().find((candidate) => candidate.slug === slug);
  if (entry) {
    return `https://${entry.domain}`;
  }
  const endpoint = manifest.type === "api" ? manifest.baseUrl : manifest.url;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") {
    return undefined;
  }
  const host = url.hostname.replace(/^(?:api|mcp|www)\./, "");
  return `https://${host}`;
}
