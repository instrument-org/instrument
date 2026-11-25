import { rpcClient } from "@/client/rpc/client";
import { useConnectedPlans } from "@/client/hooks/use-connected-plans";
import { planOfApp } from "@/client/lib/ai-apps";
import { useQuery } from "@tanstack/react-query";

import { type SiteApp } from "./app-visits";
import { useAppsBySlug } from "./apps-by-slug";

/**
 * The apps a person set up or started to, as rows and chips name them: what
 * the workspace lists, less what they said no to, and an AI whose plan is
 * connected. One that runs on this computer has no site of its own.
 */
export function useOwnApps() {
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const catalog = useQuery(
    rpcClient.apps.live.catalogMarks.experimental_liveOptions(),
  );
  const bySlug = useAppsBySlug();
  const plans = useConnectedPlans();
  const listed = (apps.data?.apps ?? []).filter(
    (app) => app.status !== "declined",
  );
  const plansOnly = (catalog.data ?? []).filter((entry) => {
    const plan = planOfApp(entry);
    return (
      plan !== undefined &&
      plans?.[plan] === true &&
      !listed.some((app) => (app.service ?? app.slug) === entry.slug)
    );
  });
  const own = (slug: string, isLocal: boolean): SiteApp => {
    const drawn = bySlug.get(slug);
    return {
      icon: drawn?.icon,
      name: drawn?.title ?? drawn?.name ?? slug,
      site: drawn?.site,
      sites: isLocal
        ? []
        : [drawn?.site, drawn?.home].filter((site) => site !== undefined),
      slug,
    };
  };
  return [
    ...listed.map((app) => ({
      ...own(app.slug, app.type === "mcp-local"),
      /** Where picking it goes when it is worked on its own site and signed in there. */
      opensAt:
        app.type === "web" && app.status === "connected"
          ? (app.home ?? bySlug.get(app.slug)?.home)
          : undefined,
    })),
    ...plansOnly.map((entry) => ({
      ...own(entry.slug, false),
      opensAt: undefined,
    })),
  ];
}
