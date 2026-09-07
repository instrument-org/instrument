import { type OrchestratorRecent } from "@/client/atoms/orchestrator";
import { Favicon } from "@/client/components/favicon";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { useState } from "react";

import { screenPresentation } from "./screen-presentation";

/** What stands for a recent screen: the Finder's own folder and file icons, the globe, the mark. */
export function RecentIcon({ recent }: { recent: OrchestratorRecent }) {
  if (recent.kind === "browser") {
    return <SiteIcon favicon={recent.favicon} url={recent.href} />;
  }
  // The same icon the strip gives the screen's tab, read off the address.
  return screenPresentation(recent.href, {
    appsBySlug: new Map(),
    childTitles: new Map(),
  }).icon;
}

/**
 * A site's icon: the one its page announced when a tab has one, else the
 * one the favicon proxy serves for the address, else the globe.
 */
export function SiteIcon({
  favicon,
  url,
}: {
  favicon?: string | undefined;
  url?: string | undefined;
}) {
  // An announced icon that does not load (a site with none, a stale address)
  // gives way to the proxy's, then the globe, rather than a broken image.
  const [failed, setFailed] = useState<string | undefined>();
  if (favicon && failed !== favicon) {
    return (
      <img
        alt=""
        className="size-4 shrink-0 rounded-xs"
        draggable={false}
        onError={() => {
          setFailed(favicon);
        }}
        src={favicon}
      />
    );
  }
  if (url) {
    return <Favicon className="size-4 shrink-0 rounded-xs" url={url} />;
  }
  return <GlobeIcon className="size-4 shrink-0" />;
}
