import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";

/** What a screen needs to draw an app it only has the slug of. */
export type AppsBySlug = Map<
  string,
  { name: string; site: string | undefined }
>;

/**
 * Every app a screen can be at, by slug: the ones the workspace has, and the
 * directory's, since an app's page can be visited before it is set up. A
 * workspace app says its own name and site over the directory's.
 */
export function useAppsBySlug(): AppsBySlug {
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const catalog = useQuery(rpcClient.apps.catalog.queryOptions());
  return new Map([
    ...(catalog.data ?? []).map(
      (entry) =>
        [
          entry.slug,
          { name: entry.name, site: `https://${entry.domain}` },
        ] as const,
    ),
    ...(apps.data?.apps ?? []).map(
      (app) => [app.slug, { name: app.name, site: app.site }] as const,
    ),
  ]);
}
