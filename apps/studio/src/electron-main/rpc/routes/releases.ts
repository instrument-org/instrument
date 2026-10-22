import { logger } from "@/electron-main/lib/electron-logger";
import { platformApiBaseUrl } from "@/electron-main/platform-api/base-url";
import { getAnonymousPlatformApiHeaders } from "@/electron-main/platform-api/headers";
import { base } from "@/electron-main/rpc/base";
import { APP_NAME, APP_REPO_NAME, GITHUB_ORG } from "@instrument-org/shared";
import { app } from "electron";
import ms from "ms";
import semver from "semver";
import { z } from "zod";

import { cacheMiddleware } from "../middleware/cache";

const ReleaseSchema = z.object({
  body: z.string().nullable(),
  created_at: z.string(),
  draft: z.boolean(),
  html_url: z.string(),
  id: z.number(),
  name: z.string().nullable(),
  prerelease: z.boolean(),
  published_at: z.string().nullable(),
  tag_name: z.string(),
});

const ReleasesResponseSchema = z.object({
  hasMore: z.boolean(),
  releases: z.array(ReleaseSchema),
});

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
      message: "Failed to fetch releases from GitHub",
    },
    PARSE_ERROR: {
      message: "Failed to parse GitHub API response",
    },
  })
  .output(ReleasesResponseSchema)
  .handler(async ({ errors }) => {
    try {
      const apiUrl = `https://api.github.com/repos/${GITHUB_ORG}/${APP_REPO_NAME}/releases?per_page=30`;

      const response = await fetch(apiUrl, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": APP_NAME,
        },
      });

      if (!response.ok) {
        throw new Error(
          `GitHub API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as unknown;
      const linkHeader = response.headers.get("Link");

      const releases = z.array(ReleaseSchema).parse(data);
      const filteredReleases = releases.filter(
        (release) =>
          !release.draft && (showsPrereleases() || !release.prerelease),
      );

      const hasMore = linkHeader?.includes('rel="next"') ?? false;

      return {
        hasMore,
        releases: filteredReleases,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw errors.PARSE_ERROR({
          message: `Invalid GitHub API response format: ${error.message}`,
        });
      }

      // The cause carries the reason undici collapsed into `fetch failed`, and
      // is what tells the exception log an unreachable host is the user's
      // network rather than a bug. Dropping it makes every offline visit a
      // report.
      throw errors.FETCH_ERROR({
        cause: error,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

// Prerelease notes are the raw commit log for a build, which is the only
// changelog a beta gets and is meaningless to someone on a stable version. Show
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
