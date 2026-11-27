import { TabGroupIcon } from "@/client/components/icons/tab-group-icon";
import { NewTabIcon } from "@/client/components/icons/new-tab-icon";
import { type MenuComponents } from "@/client/components/ui/menu-components";
import { type OpenDestination } from "@/client/hooks/use-open-target";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { SquareSplitHorizontalIcon } from "@phosphor-icons/react/SquareSplitHorizontal";
import { StarIcon } from "@phosphor-icons/react/Star";
import { type ComponentType } from "react";

/** What each row of the window's places wears in a menu the app draws. */
const PLACE_ICONS: Partial<
  Record<OpenDestination["id"], ComponentType<{ className?: string }>>
> = {
  bookmark: StarIcon,
  openNewGroup: TabGroupIcon,
  openNewTab: NewTabIcon,
  openNewWindow: AppWindowIcon,
  openSplit: SquareSplitHorizontalIcon,
};

/**
 * The rows of a menu the app draws over a link or a file, from the list the
 * OS's own menu shows elsewhere (`useWindowPlaces`, `useBookmarkRow`), so
 * both read the same.
 */
export function PlaceItems({
  components: { Item },
  destinations,
}: {
  components: MenuComponents;
  destinations: OpenDestination[];
}) {
  return destinations.map((destination) => {
    const Icon = PLACE_ICONS[destination.id];
    return (
      <Item key={destination.id} onClick={destination.run}>
        {Icon && <Icon className="size-4" />}
        <span>{destination.label}</span>
      </Item>
    );
  });
}
