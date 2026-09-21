import { type AppPlace } from "@/client/atoms/orchestrator";
import { openSettings } from "@/client/atoms/settings-modal";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/client/components/ui/avatar";
import { useLiveUser } from "@/client/hooks/use-live-user";
import { getInitials } from "@/client/lib/get-initials";
import { cn } from "@/client/lib/utils";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { GearIcon } from "@phosphor-icons/react/Gear";
import { HouseIcon } from "@phosphor-icons/react/House";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { type ReactNode } from "react";

/** The places, in the order the rail draws them. */
const PLACES: { icon: ReactNode; id: AppPlace; label: string }[] = [
  { icon: <HouseIcon className="size-5" />, id: "home", label: "Home" },
  {
    icon: <ChatsCircleIcon className="size-5" />,
    id: "chat",
    label: "Chat",
  },
  { icon: <FolderIcon className="size-5" />, id: "files", label: "Files" },
];

/**
 * The rail down the window's left edge: New at its top, then one entry per
 * place, each a mark with its word under it, and the user at its foot as the
 * way to Settings. The one the window stands in wears a lifted tile. Narrow
 * enough to be chrome rather than a column: a mark, a word, and nothing
 * wider than either.
 */
export function AppRail({
  onChoose,
  onNew,
  place,
}: {
  onChoose: (place: AppPlace) => void;
  /** Opens a draft of a new thread. */
  onNew: () => void;
  /** The place the window stands in. */
  place: AppPlace;
}) {
  return (
    <nav
      aria-label="Places"
      className="flex h-full w-19 shrink-0 flex-col items-center gap-4 border-r border-border bg-muted/40 pt-3 pb-2"
    >
      {/* The way to a new thread, in the brand's own green: round, since the
        word under it is the label and the tile needs none of its own. */}
      <ToolbarTooltip chord="newThread" label="New">
        <button
          className="group flex w-full flex-col items-center gap-1"
          onClick={onNew}
          type="button"
        >
          <span className="grid size-11 place-items-center rounded-full bg-brand-600 button-sheen text-brand-foreground shadow-xs group-hover:bg-brand-700">
            <PencilSimpleIcon className="size-5" />
          </span>
          <span className="text-[11px] leading-none font-medium">New</span>
        </button>
      </ToolbarTooltip>
      <div className="flex w-full flex-col items-center gap-2.5">
        {PLACES.map((entry) => (
          <RailEntry
            isOn={place === entry.id}
            key={entry.id}
            label={entry.label}
            onChoose={() => {
              onChoose(entry.id);
            }}
          >
            {entry.icon}
          </RailEntry>
        ))}
      </div>
      <div className="flex-1" />
      <RailUser />
    </nav>
  );
}

/** One place in the rail: its mark on a tile that lifts while it is the place stood in, and its word under it. Never the mark alone. */
function RailEntry({
  children,
  isOn,
  label,
  onChoose,
}: {
  children: ReactNode;
  isOn: boolean;
  label: string;
  onChoose: () => void;
}) {
  return (
    <button
      aria-current={isOn ? "page" : undefined}
      className="group flex w-full flex-col items-center gap-1"
      onClick={onChoose}
      type="button"
    >
      <span
        className={cn(
          "grid size-10 place-items-center rounded-lg",
          isOn
            ? "bg-card text-foreground shadow-xs ring-1 ring-border"
            : "text-muted-foreground group-hover:bg-foreground/5 group-hover:text-foreground",
        )}
      >
        {children}
      </span>
      <span
        className={cn(
          "text-[11px] leading-none",
          isOn ? "font-medium text-foreground" : "text-foreground/80",
        )}
      >
        {label}
      </span>
    </button>
  );
}

/**
 * The user at the rail's foot, which is the way to Settings: their picture
 * while they are signed in, a gear while they are not, and the word under
 * either. The 2.0 window has no sidebar of its own to keep the account row
 * in, so this is where it shows.
 */
function RailUser() {
  const { data: user } = useLiveUser();
  return (
    <button
      className="group flex w-full flex-col items-center gap-1"
      onClick={() => {
        openSettings({ tab: "General" });
      }}
      type="button"
    >
      <span className="grid size-10 place-items-center rounded-lg text-muted-foreground group-hover:bg-foreground/5 group-hover:text-foreground">
        {user ? (
          <Avatar className="size-7 rounded-full">
            <AvatarImage alt="" src={user.image ?? undefined} />
            <AvatarFallback className="rounded-full text-[10px]">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
        ) : (
          <GearIcon className="size-5" />
        )}
      </span>
      <span className="text-[11px] leading-none text-foreground/80">
        Settings
      </span>
    </button>
  );
}
