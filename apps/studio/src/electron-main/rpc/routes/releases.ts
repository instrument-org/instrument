import { logger } from "@/electron-main/lib/electron-logger";
import { platformApiBaseUrl } from "@/electron-main/platform-api/base-url";
import { getAnonymousPlatformApiHeaders } from "@/electron-main/platform-api/headers";
import { base } from "@/electron-main/rpc/base";
import { app } from "electron";
import ms from "ms";
import semver from "semver";
import { z } from "zod";

import { cacheMiddleware } from "../middleware/cache";

const ReleasesSchema = z.object({
  releases: z.array(
    z.object({
      /** The notes as Markdown, without the compare link GitHub ends them with. */
      body: z.string(),
      prerelease: z.boolean(),
      publishedAt: z.string(),
      /** The notes' opening paragraph, or null for a tag cut with only its commit list. */
      summary: z.string().nullable(),
      url: z.string(),
      version: z.string(),
    }),
  ),
});

/**
 * The newest published releases, newest first, for the Release notes page.
 * Our API reads them from GitHub, so the app makes no request there, which
 * would count against the address's unauthenticated limit and tell GitHub
 * who is reading. Sent without the account token, as `notesFor` is.
 */
const list = base
  .use(async ({ next }) => {
    return next({
      context: {
        cacheTTL: ms("5 minutes"),
      },
    });
  })
  .use(cacheMiddleware)
  .errors({
    FETCH_ERROR: {
      message: "Failed to fetch release notes",
    },
    PARSE_ERROR: {
      message: "Failed to parse the release notes",
    },
  })
  .output(ReleasesSchema)
  .handler(async ({ errors }) => {
    const apiBase = platformApiBaseUrl();
    if (!apiBase) {
      throw errors.FETCH_ERROR({ message: "No API to ask for release notes" });
    }
    const url = new URL("/release-notes/list", apiBase);
    url.searchParams.set("prereleases", String(showsPrereleases()));
    let response: Response;
    try {
      response = await fetch(url, {
        headers: getAnonymousPlatformApiHeaders(),
        signal: AbortSignal.timeout(ms("10 seconds")),
      });
    } catch (error) {
      // The cause carries the reason undici collapsed into `fetch failed`, and
      // is what tells the exception log an unreachable host is the user's
      // network rather than a bug. Dropping it makes every offline visit a
      // report.
      throw errors.FETCH_ERROR({
        cause: error,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
    if (!response.ok) {
      throw errors.FETCH_ERROR({
        message: `Release notes answered ${String(response.status)}`,
      });
    }
    const parsed = ReleasesSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw errors.PARSE_ERROR({ message: parsed.error.message });
    }
    return parsed.data;
  });

// A beta's notes describe builds someone on a stable version never gets. Show
// them to the people running those builds: prerelease installs, and unpackaged
// dev runs, where the package.json version tracks whichever release was tagged
// last and so says nothing about which builds the developer cares about.
function showsPrereleases() {
  return !app.isPackaged || semver.prerelease(app.getVersion()) !== null;
}

const log = logger.scope("release-notes");

const NotesSchema = z.object({
  notes: z
    .object({
      highlights: z.array(z.string()),
      publishedAt: z.string(),
      summary: z.string(),
      url: z.string(),
      version: z.string(),
    })
    .nullable(),
});

/**
 * What a build waiting to be installed changes, cut down to its summary and a
 * few lead sentences by our API, which reads them from GitHub so the app makes
 * no request there. Null when the release has no notes yet, or when the API
 * cannot be reached, which the card says the same way. Sent without the
 * account token, so the fetch stays unlinked to the account.
 */
const notesFor = base
  .input(z.object({ version: z.string() }))
  .handler(async ({ input }) => {
    const apiBase = platformApiBaseUrl();
    if (!apiBase) {
      return null;
    }
    const url = new URL("/release-notes", apiBase);
    url.searchParams.set("version", input.version);
    try {
      const response = await fetch(url, {
        headers: getAnonymousPlatformApiHeaders(),
        signal: AbortSignal.timeout(ms("10 seconds")),
      });
      if (!response.ok) {
        log.warn(`release notes answered ${String(response.status)}`);
        return null;
      }
      return NotesSchema.parse(await response.json()).notes;
    } catch (error) {
      log.warn("release notes could not be fetched", error);
      return null;
    }
  });

export const releases = {
  list,
  notesFor,
};
