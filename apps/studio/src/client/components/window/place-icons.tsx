import { type AppPlace } from "@/client/atoms/window";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { ShapesIcon } from "@phosphor-icons/react/Shapes";
import { type ComponentType } from "react";

type PlaceIconProps = {
  className?: string;
  weight?: "fill" | "regular" | "thin";
};

// Files is the same folder on every system: the Finder's face belongs to the
// Finder itself, which `RevealInFolderIcon` draws with its real icon.
const PLACE_ICONS = {
  apps: ShapesIcon,
  browser: GlobeIcon,
  chat: ChatCircleIcon,
  files: FolderSimpleIcon,
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
