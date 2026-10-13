import { catalogEntryForApp } from "./catalog";
import { type AppManifest } from "./manifest";

/**
 * Where the service's signed-in web app is: what a sign-in lands on when it
 * finishes in the window's browser, and what the app's page opens. A web
 * app's manifest names it; otherwise the directory does where the front page
 * is not it, and otherwise the site.
 */
export function appHomeFor(
  slug: string,
  manifest: AppManifest,
): string | undefined {
  if (manifest.type === "web") {
    return manifest.url;
  }
  const entry = catalogEntryForApp(slug, manifest);
  return entry?.home ?? appSiteFor(slug, manifest);
}

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
  const entry = catalogEntryForApp(slug, manifest);
  if (entry) {
    return `https://${entry.domain}`;
  }
  if (manifest.type === "mcp-local") {
    // A server that runs here has no address to draw; only the directory can
    // say what site the thing it reaches belongs to.
    return undefined;
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
