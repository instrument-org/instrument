import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { useCloseOnWindowBlur } from "@/client/hooks/use-close-on-window-blur";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type AdBlockingReport } from "@/shared/browser";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";
import { ShieldSlashIcon } from "@phosphor-icons/react/ShieldSlash";
import { useMutation, useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";

// Loaded when the shield first opens, so it stays out of startup.
const AdBlockingPanel = lazy(() =>
  import("./ad-blocking-panel").then((module) => ({
    default: module.AdBlockingPanel,
  })),
);

/** What ad blocking did on each tab's page, kept current. */
function useAdBlockingReport(): AdBlockingReport {
  const { data } = useQuery(
    rpcClient.browser.live.adBlocking.experimental_liveOptions(),
  );
  return data ?? { listsUpdatedAt: null, pages: [] };
}

/**
 * Ad blocking's state as the person chose it, the way the shield and the
 * Extensions page read it, and the choices that change it.
 */
export function useAdBlocking() {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const report = useAdBlockingReport();
  const onError = (error: Error) => {
    toast.error("Couldn't change ad blocking", { cause: error });
  };
  const setBlockAds = useMutation(
    rpcClient.preferences.setBlockAds.mutationOptions({ onError }),
  );
  const setOnSite = useMutation(
    rpcClient.preferences.setBlockAdsOnSite.mutationOptions({ onError }),
  );
  const setPinned = useMutation(
    rpcClient.preferences.setAdBlockingPinned.mutationOptions({ onError }),
  );
  const turnOnInTab = useMutation(
    rpcClient.browser.turnOnAdBlocking.mutationOptions({ onError }),
  );
  return {
    listsUpdatedAt: report.listsUpdatedAt,
    offSites: preferences?.adBlockOffSites ?? [],
    on: preferences?.blockAds ?? true,
    pageOf: (targetId: BrowserTargetId | undefined) =>
      report.pages.find((page) => page.targetId === targetId),
    pinned: preferences?.adBlockingPinned ?? true,
    setOn: (enabled: boolean, then?: () => void) => {
      setBlockAds.mutate({ enabled }, then ? { onSuccess: then } : {});
    },
    setOnSite: (site: string, enabled: boolean, then?: () => void) => {
      setOnSite.mutate({ enabled, site }, then ? { onSuccess: then } : {});
    },
    setPinned: (pinned: boolean) => {
      setPinned.mutate({ pinned });
    },
    turnOnInTab: (targetId: BrowserTargetId, then?: () => void) => {
      turnOnInTab.mutate({ targetId }, then ? { onSuccess: then } : {});
    },
  };
}

/**
 * Ad blocking's shield in the extensions' group: crossed out wherever ads
 * load on the tab's page, and on a press, the switch for the page's site,
 * the hosts refused on the page, and the way to its row on the Extensions
 * page. Drawn while pinned, while ad blocking is off for every site, so it
 * is not left off unseen, and while open from the puzzle piece's menu when
 * neither, the way Chrome shows an unpinned extension with its popup up.
 */
export function AdBlockingButton({
  className,
  compact,
  onOpenChange,
  open,
  targetId,
}: {
  className?: string;
  compact: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  targetId: BrowserTargetId | undefined;
}) {
  const blocking = useAdBlocking();
  useCloseOnWindowBlur(open, () => {
    onOpenChange(false);
  });
  const page = blocking.pageOf(targetId);
  const siteOn = !page || !blocking.offSites.includes(page.site);
  const isBlocking = blocking.on && siteOn && !page?.agentOff;
  if (!blocking.pinned && blocking.on && !open) {
    return null;
  }
  const Icon = isBlocking ? ShieldCheckIcon : ShieldSlashIcon;
  return (
    <Popover modal={false} onOpenChange={onOpenChange} open={open}>
      <ToolbarTooltip label="Ad blocking">
        <PopoverTrigger asChild>
          <button
            aria-label="Ad blocking"
            className={cn(
              "relative grid shrink-0 place-items-center text-foreground/60 hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground",
              compact
                ? "size-7 rounded-[calc(var(--radius-xl)-2px)]"
                : "size-8 rounded-xl",
              className,
            )}
            type="button"
          >
            <Icon className="size-4" />
            {page?.agentOff && (
              <span className="absolute top-1 right-1 size-1.5 rounded-full bg-brand-500 ring-[1.5px] ring-card" />
            )}
          </button>
        </PopoverTrigger>
      </ToolbarTooltip>
      <PopoverContent align="end" className="w-80 p-0">
        <Suspense fallback={null}>
          <AdBlockingPanel
            onClose={() => {
              onOpenChange(false);
            }}
            targetId={targetId}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
