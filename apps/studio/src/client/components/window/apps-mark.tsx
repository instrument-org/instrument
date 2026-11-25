import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { SCREENS } from "@/shared/instrument-screens";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { ShapesIcon } from "@phosphor-icons/react/Shapes";
import { type SyntheticEvent, useState } from "react";

import { AppIcon } from "./app-icon";
import { type OpenAddress, bookmarkClicks } from "./bookmark-menu";
import { useOwnApps } from "./use-own-apps";

type OwnApp = ReturnType<typeof useOwnApps>[number];

/**
 * Apps at the bookmarks bar's start: a press opens the Apps page, as a
 * bookmark opens (`bookmarkClicks`), and the caret beside it lists the
 * person's own apps by name, in one list. Only what they set up or started to is
 * there. A pick goes to the app's site where it is signed in, and to its page
 * in Instrument otherwise.
 */
export function AppsMark({
  open,
  openSite,
}: {
  /** Opens a screen of the app's own. */
  open: OpenAddress;
  /** Opens a site. */
  openSite: OpenAddress;
}) {
  const [isOpen, setOpen] = useState(false);
  const apps = useOwnApps().toSorted((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex h-6 shrink-0 items-center rounded-md text-xs text-foreground/80 has-data-[state=open]:bg-foreground/8 has-[button:hover]:bg-foreground/5">
      <button
        className="flex h-6 cursor-default items-center gap-1.5 rounded-l-md pr-1 pl-1.5 hover:bg-foreground/8 hover:text-foreground"
        {...bookmarkClicks(SCREENS.apps.href, open)}
        type="button"
      >
        <ShapesIcon className="size-3.5 shrink-0 text-foreground/70" />
        Apps
      </button>
      <DropdownMenu modal={false} onOpenChange={setOpen} open={isOpen}>
        <DropdownMenuTrigger
          aria-label="Open an app"
          className="grid h-6 w-4.5 cursor-default place-items-center rounded-r-md text-foreground/60 hover:bg-foreground/8 hover:text-foreground data-[state=open]:text-foreground"
        >
          <CaretDownIcon className="size-2.5" weight="bold" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {apps.map((app) => (
            <AppRow
              app={app}
              key={app.slug}
              onDone={() => {
                setOpen(false);
              }}
              open={open}
              openSite={openSite}
            />
          ))}
          {apps.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem {...bookmarkClicks(SCREENS.apps.href, open)}>
            <ShapesIcon className="size-4 text-foreground/70" />
            All apps
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** One app; where a pick goes to its site, Manage goes to its page in Instrument. */
function AppRow({
  app,
  onDone,
  open,
  openSite,
}: {
  app: OwnApp;
  onDone: () => void;
  open: OpenAddress;
  openSite: OpenAddress;
}) {
  const page = `/apps/${app.slug}`;
  const face = (
    <>
      <AppIcon icon={app.icon} name={app.name} site={app.site} size="sm" />
      <span className="min-w-0 flex-1 truncate">{app.name}</span>
    </>
  );
  if (app.opensAt === undefined) {
    return (
      <DropdownMenuItem {...bookmarkClicks(page, open)}>
        {face}
      </DropdownMenuItem>
    );
  }
  const manage = () => {
    onDone();
    open(page);
  };
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <DropdownMenuItem
          className="group/app"
          {...bookmarkClicks(app.opensAt, openSite)}
        >
          {face}
          {/* A press on it is its own, never a pick of the row. */}
          <button
            className="-my-0.5 hidden h-5 shrink-0 items-center rounded-md bg-foreground/8 px-1.5 text-xs font-medium group-data-highlighted/app:flex hover:bg-foreground/15"
            onAuxClick={keep}
            onClick={(event) => {
              keep(event);
              manage();
            }}
            onPointerDown={keep}
            onPointerUp={keep}
            tabIndex={-1}
            type="button"
          >
            Manage
          </button>
        </DropdownMenuItem>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={manage}>Manage</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function keep(event: SyntheticEvent) {
  event.stopPropagation();
}
