import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Switch } from "@/client/components/ui/switch";
import { useCloseOnWindowBlur } from "@/client/hooks/use-close-on-window-blur";
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";
import { useId, useState } from "react";

import { useAdBlocking } from "./ad-blocking";
import { ListsUpdated } from "./ad-blocking-panel";

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
        <ul className="max-h-64 overflow-y-auto scroll-fade-y pb-1.5">
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
