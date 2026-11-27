import { Button } from "@/client/components/ui/button";
import { Switch } from "@/client/components/ui/switch";
import { useRelativeTime } from "@/client/hooks/use-relative-time";
import { getGuest } from "@/client/lib/browser-pool";
import { APP_NAME } from "@instrument-org/shared";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";
import { ShieldSlashIcon } from "@phosphor-icons/react/ShieldSlash";
import { useId } from "react";

import { useAdBlocking } from "./ad-blocking";
import { useExtensionActions } from "./browser-extensions";

export function AdBlockingPanel({
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
      <ul className="max-h-48 overflow-y-auto scroll-fade-y">
        {hosts.map((host) => (
          <li className="truncate px-4 py-0.5 text-[13px]" key={host}>
            {host}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ListsUpdated({ at }: { at: number }) {
  return <span>Lists updated {useRelativeTime(new Date(at))}</span>;
}
