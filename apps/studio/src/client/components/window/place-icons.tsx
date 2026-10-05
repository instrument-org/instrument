import { type AppPlace } from "@/client/atoms/window";
import { FinderIcon } from "@/client/components/icons/finder-icon";
import { isMacOS } from "@/client/lib/utils";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { MapTrifoldIcon } from "@phosphor-icons/react/MapTrifold";
import { ShapesIcon } from "@phosphor-icons/react/Shapes";
import { type ComponentType } from "react";

type PlaceIconProps = { className?: string; weight?: "fill" | "regular" };

/**
 * The Finder's face on the Mac, where the place is the Finder's own ground; a
 * folder everywhere else.
 */
function FilesPlaceIcon(props: PlaceIconProps) {
  return isMacOS() ? <FinderIcon {...props} /> : <FolderIcon {...props} />;
}

const PLACE_ICONS = {
  apps: ShapesIcon,
  browser: GlobeIcon,
  chat: ChatCircleIcon,
  discover: MapTrifoldIcon,
  files: FilesPlaceIcon,
} satisfies Record<AppPlace, ComponentType<PlaceIconProps>>;

/**
 * A place's mark, as the rail draws it. Whatever stands for a place itself
 * (its home's tab, title, and omnibar mark, a link to it) draws this one, so a
 * place looks the same in the rail and everywhere it is named.
 */
export function PlaceIcon({
  place,
  ...props
}: PlaceIconProps & { place: AppPlace }) {
  const Icon = PLACE_ICONS[place];
  return <Icon {...props} />;
}
