import { type OrchestratorRecent, pinsAtom } from "@/client/atoms/orchestrator";
import { Favicon } from "@/client/components/favicon";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useState } from "react";

import { useOrchestrator } from "./context";
import { screenPresentation } from "./screen-presentation";
import { ScreenIcon } from "./window-tab-strip";

/**
 * The top of the sidebar: what the user pinned here, each a row that opens
 * its page or screen in a tab. Nothing of ours is listed; the places the
 * product used to list here live on the new tab page.
 */
export function OrchestratorPins({ className }: { className?: string }) {
  const [pins, setPins] = useAtom(pinsAtom);
  const { openPage, openScreen } = useOrchestrator();
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const appsBySlug = new Map(
    (apps.data?.apps ?? []).map((app) => [
      app.slug,
      { name: app.name, site: app.site },
    ]),
  );
  return (
    <div className={cn("flex flex-col px-3", className)}>
      <p className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground/60 uppercase">
        Pinned
      </p>
      {pins.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground/60">
          Right-click a tab to pin it here.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {pins.map((pin) => (
            <li className="group/pin flex items-center" key={pin.id}>
              <button
                className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-foreground/5"
                onClick={() => {
                  if (pin.kind === "page") {
                    openPage(pin.target);
                  } else {
                    openScreen(pin.target);
                  }
                }}
                type="button"
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {pin.kind === "page" ? (
                    <SiteIcon favicon={pin.favicon} url={pin.target} />
                  ) : (
                    <ScreenIcon appsBySlug={appsBySlug} href={pin.target} />
                  )}
                </span>
                <span className="truncate">{pin.title}</span>
              </button>
              <button
                aria-label={`Unpin ${pin.title}`}
                className="hidden rounded-sm p-0.5 text-muted-foreground group-hover/pin:block hover:bg-foreground/10"
                onClick={() => {
                  setPins((current) =>
                    current.filter((entry) => entry.id !== pin.id),
                  );
                }}
                type="button"
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
