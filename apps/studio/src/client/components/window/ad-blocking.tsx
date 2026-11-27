import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Switch } from "@/client/components/ui/switch";
import { useCloseOnWindowBlur } from "@/client/hooks/use-close-on-window-blur";
import { useRelativeTime } from "@/client/hooks/use-relative-time";
import { getGuest } from "@/client/lib/browser-pool";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type AdBlockingReport } from "@/shared/browser";
import { APP_NAME } from "@instrument-org/shared";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";
import { ShieldSlashIcon } from "@phosphor-icons/react/ShieldSlash";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import { useExtensionActions } from "./browser-extensions";

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
        <AdBlockingPanel
          onClose={() => {
            onOpenChange(false);
          }}
          targetId={targetId}
        />
      </PopoverContent>
    </Popover>
  );
}

function AdBlockingPanel({
  onClose,
  targetId,
}: {
  onClose: () => void;
  targetId: BrowserTargetId | undefined;
}) {
  const blocking = useAdBlocking();
  const actions = useExtensionActions();
  const switchId = useId();
  const page = blocking.pageOf(targetId);
  const site = page?.site || undefined;
  const siteOn = site === undefined || !blocking.offSites.includes(site);
  const reload = () => {
    if (targetId) {
      getGuest(targetId)?.reload();
    }
  };
  // The switch is the site's on a page and the workspace's anywhere else.
  const checked = site ? blocking.on && siteOn : blocking.on;
  return (
    <div className="text-sm">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        {checked && !page?.agentOff ? (
          <ShieldCheckIcon className="size-5 shrink-0" />
        ) : (
          <ShieldSlashIcon className="size-5 shrink-0 text-muted-foreground" />
        )}
        <label className="min-w-0 flex-1" htmlFor={switchId}>
          <p className="text-[13px] font-medium">Block ads and trackers</p>
          <p className="truncate text-xs text-muted-foreground">
            {site ?? "Every site"}
          </p>
        </label>
        <Switch
          checked={checked}
          disabled={site !== undefined && !blocking.on}
          id={switchId}
          onCheckedChange={(enabled) => {
            if (site) {
              blocking.setOnSite(site, enabled, reload);
            } else {
              blocking.setOn(enabled, reload);
            }
          }}
        />
      </div>
      {site && !blocking.on ? (
        <div className="border-t px-4 py-3 text-[13px]">
          <p className="text-muted-foreground">
            Ad blocking is off for every site.
          </p>
          <Button
            className="mt-2"
            onClick={() => {
              blocking.setOn(true, reload);
            }}
            size="xs"
            variant="default"
          >
            Turn on
          </Button>
        </div>
      ) : page?.agentOff && siteOn ? (
        <div className="border-t px-4 py-3 text-[13px]">
          <p>{APP_NAME} turned off blocking in this tab.</p>
          <Button
            className="mt-2"
            onClick={() => {
              if (targetId) {
                blocking.turnOnInTab(targetId, reload);
              }
            }}
            size="xs"
            variant="default"
          >
            Turn back on
          </Button>
        </div>
      ) : page && siteOn ? (
        <BlockedHosts hosts={page.blocked} />
      ) : null}
      <div className="flex items-center justify-between gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
        {site && !siteOn && blocking.on ? (
          <span>Blocking is on for other sites</span>
        ) : blocking.listsUpdatedAt === null ? (
          <span />
        ) : (
          <ListsUpdated at={blocking.listsUpdatedAt} />
        )}
        <Button
          className="-mr-2"
          onClick={() => {
            onClose();
            actions.manage();
          }}
          size="xs"
          variant="ghost"
        >
          Settings
        </Button>
      </div>
    </div>
  );
}

/** The hosts refused on the page, in the order they were. */
function BlockedHosts({ hosts }: { hosts: string[] }) {
  if (hosts.length === 0) {
    return (
      <p className="border-t px-4 py-3 text-[13px] text-muted-foreground">
        Nothing blocked on this page.
      </p>
    );
  }
  return (
    <div className="border-t pt-2.5 pb-2">
      <p className="px-4 pb-1 text-xs text-muted-foreground">
        Blocked on this page
      </p>
      <ul className="max-h-48 overflow-y-auto">
        {hosts.map((host) => (
          <li className="truncate px-4 py-0.5 text-[13px]" key={host}>
            {host}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ListsUpdated({ at }: { at: number }) {
  return <span>Lists updated {useRelativeTime(new Date(at))}</span>;
}

/**
 * Ad blocking at the head of the Extensions page, as the built-in extension
 * it is: the switch for every site, the sites it is off on, how fresh its
 * lists are, and whether its shield is in the row. No Remove, since it ships
 * with the app.
 */
export function AdBlockingExtensionRow() {
  const blocking = useAdBlocking();
  const pinnedId = useId();
  const sites = blocking.offSites;
  const offOn =
    sites.length === 0
      ? null
      : sites.length === 1
        ? "Off on 1 site"
        : `Off on ${sites.length} sites`;
  const updatedAt = blocking.listsUpdatedAt;
  return (
    <div className="flex items-start gap-4 px-5 py-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-foreground/5">
        <ShieldCheckIcon className="size-6" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-medium">Ad blocking</span>
          <span className="shrink-0 rounded-md bg-foreground/6 px-1.5 py-0.5 text-[11px] text-muted-foreground">
            Built in
          </span>
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Blocks ads and trackers with EasyList, EasyPrivacy and uBlock Origin’s
          lists.
        </p>
        {(offOn !== null || updatedAt !== null) && (
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {offOn}
            {offOn !== null && updatedAt !== null && " · "}
            {updatedAt !== null && <ListsUpdated at={updatedAt} />}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {sites.length > 0 && <OffSites sites={sites} />}
          <span className="flex-1" />
          {blocking.on && (
            <label
              className="flex items-center gap-2 text-[13px] text-muted-foreground"
              htmlFor={pinnedId}
            >
              Show in the row
              <Switch
                checked={blocking.pinned}
                id={pinnedId}
                onCheckedChange={blocking.setPinned}
              />
            </label>
          )}
        </div>
      </div>
      <Switch
        aria-label={
          blocking.on ? "Turn off ad blocking" : "Turn on ad blocking"
        }
        checked={blocking.on}
        className="mt-1"
        onCheckedChange={(enabled) => {
          blocking.setOn(enabled);
        }}
      />
    </div>
  );
}

/** The sites ads load on, each with the way to block them there again. */
function OffSites({ sites }: { sites: string[] }) {
  const blocking = useAdBlocking();
  const [isOpen, setOpen] = useState(false);
  useCloseOnWindowBlur(isOpen, () => {
    setOpen(false);
  });
  return (
    <Popover onOpenChange={setOpen} open={isOpen}>
      <PopoverTrigger asChild>
        <Button size="xs" variant="ghost">
          Sites
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0 text-sm">
        <p className="px-3 pt-3 pb-1 text-xs text-muted-foreground">
          Ads and trackers load on these sites.
        </p>
        <ul className="max-h-64 overflow-y-auto pb-1.5">
          {sites.map((site) => (
            <li
              className="flex items-center justify-between gap-2 px-3 py-1"
              key={site}
            >
              <span className="truncate text-[13px]">{site}</span>
              <Button
                onClick={() => {
                  blocking.setOnSite(site, true);
                }}
                size="xs"
                variant="ghost"
              >
                Block
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
