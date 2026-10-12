import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";

/** What a screen needs to draw an app it only has the slug of. */
export type AppsBySlug = Map<string, AppOfSlug>;

type AppOfSlug = {
  /** Where the service's signed-in web app is, when the directory or the app says. */
  home?: string | undefined;
  icon?: string | undefined;
  /** Whether the app is a server that runs on this computer rather than a service on the web. */
  local?: boolean;
  name: string;
  site: string | undefined;
  /**
   * What a tab or a list of pages calls it: its name, with the account added
   * when another app of the same service is here, so two Gmails read apart.
   */
  title?: string;
};

/**
 * Every app a screen can be at, by slug: the ones the workspace has, and the
 * directory's, since an app's page can be visited before it is set up. A
 * workspace app says its own name and site over the directory's.
 */
export function useAppsBySlug(): AppsBySlug {
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const catalog = useQuery(rpcClient.apps.catalog.queryOptions());
  return new Map<string, AppOfSlug>([
    ...(catalog.data ?? []).map(
      (entry) =>
        [
          entry.slug,
          {
            home: entry.home,
            icon: entry.icon,
            name: entry.name,
            site: `https://${entry.domain}`,
          },
        ] as const,
    ),
    ...(apps.data?.apps ?? []).map((app, _, all) => {
      const shared =
        app.service !== undefined &&
        all.some(
          (other) => other.slug !== app.slug && other.service === app.service,
        );
      return [
        app.slug,
        {
          home: app.home,
          icon: app.icon,
          local: app.type === "mcp-local",
          name: app.name,
          site: app.site,
          title:
            shared && app.account ? `${app.name} · ${app.account}` : app.name,
        },
      ] as const;
    }),
  ]);
}
