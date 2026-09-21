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
import { rpcClient } from "@/client/rpc/client";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { FadersHorizontalIcon } from "@phosphor-icons/react/FadersHorizontal";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { HouseIcon } from "@phosphor-icons/react/House";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

import { AppIcon } from "./app-icon";

/** The places, in the order the rail draws them; Apps draws its own mark from the apps the workspace reaches. */
const PLACES: { icon: ReactNode; id: AppPlace; label: string }[] = [
  {
    icon: <HouseIcon className="size-6" />,
    id: "home",
    label: "Home",
  },
  {
    icon: <ChatsCircleIcon className="size-6" />,
    id: "chat",
    label: "Chat",
  },
  { icon: <AppFan />, id: "apps", label: "Apps" },
  {
    icon: <FolderIcon className="size-6" />,
    id: "files",
    label: "Files",
  },
];

/** How many of the workspace's apps the Apps mark fans out. */
const FAN_SHOWN = 3;

/**
 * What the Apps mark fans out before the workspace reaches any app: three
 * services most people know, so the mark hints at what the place holds.
 * The first takes the front of the fan, so Notion stands in the middle
 * between Slack and Linear.
 */
const SAMPLE_APPS = [
  { name: "Notion", site: "https://notion.so", slug: "notion" },
  { name: "Slack", site: "https://slack.com", slug: "slack" },
  { name: "Linear", site: "https://linear.app", slug: "linear" },
];

/**
 * The rail down the window's left edge: New at its top, then one entry per
 * place, each a mark with its word close under it, and the user at its foot
 * as the way to Settings. The one the window stands in sits in a soft well
 * around the whole entry, mark and word together. Narrow enough to be
 * chrome rather than a column: a mark, a word, and nothing wider than
 * either.
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
      className="flex h-full w-19 shrink-0 flex-col items-center gap-3 border-r border-border bg-muted/40 pt-3 pb-2"
    >
      {/* The way to a new thread, in the brand's own green: round, since the
        word under it is the label and the tile needs none of its own. */}
      <ToolbarTooltip chord="newThread" label="New">
        <button
          className="group flex w-16 flex-col items-center gap-0.5 rounded-xl py-1.5"
          onClick={onNew}
          type="button"
        >
          <span className="grid size-11 place-items-center rounded-full bg-brand-600 button-sheen text-brand-foreground shadow-xs group-hover:bg-brand-700">
            <PencilSimpleIcon className="size-5" />
          </span>
          <span className="text-[11px] leading-4 font-medium">New</span>
        </button>
      </ToolbarTooltip>
      <div className="flex w-full flex-col items-center gap-1">
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

/**
 * One entry of the rail: its mark in a slot of one height, and its word
 * close under it, the two together in a well that fills while it is the
 * place stood in and tints under the pointer. Never the mark alone.
 */
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
      className={cn(
        "flex w-16 flex-col items-center gap-0.5 rounded-xl py-1.5",
        isOn
          ? "bg-foreground/8 text-foreground"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
      )}
      onClick={onChoose}
      type="button"
    >
      <span className="grid h-7 place-items-center">{children}</span>
      <span className={cn("text-[11px] leading-4", isOn && "font-medium")}>
        {label}
      </span>
    </button>
  );
}

/** The front card of the fan: upright, in the middle, over the rest. */
const FRONT_CARD = "top-0 left-1/2 z-10 -translate-x-1/2";

/** The cards leaning out behind the front one, a little lower and turned out to each side. */
const LEFT_CARD = "top-0.5 left-0 -rotate-12";
const RIGHT_CARD = "top-0.5 right-0 rotate-12";

/** Where each card of the fan stands, by how many there are, in the order the apps come: the first app takes the front. */
const FAN_CARDS: Record<number, string[]> = {
  1: [FRONT_CARD],
  2: [FRONT_CARD, RIGHT_CARD],
  3: [FRONT_CARD, LEFT_CARD, RIGHT_CARD],
};

/**
 * The Apps mark: the workspace's own apps, each on a small white card, fanned
 * out like a hand of cards with the front one upright. Connected apps go in
 * front of ones still being set up, since theirs are the icons worth
 * showing. With no apps yet, the sample hand, so the mark says what the
 * place is for rather than that it is empty.
 */
function AppFan() {
  const list = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const apps = list.data?.apps ?? [];
  const own = [
    ...apps.filter((app) => app.standing === "connected"),
    ...apps.filter((app) => app.standing !== "connected"),
  ].slice(0, FAN_SHOWN);
  const shown = own.length === 0 ? SAMPLE_APPS : own;
  const cards = FAN_CARDS[shown.length] ?? [];
  return (
    <span aria-hidden className="relative block h-7 w-11">
      {shown.map((app, index) => (
        <span
          className={cn(
            "absolute grid size-6 place-items-center rounded-md bg-card p-1 shadow-sm ring-1 ring-border",
            cards[index],
          )}
          key={app.slug}
        >
          <AppIcon
            className="size-full bg-transparent"
            name={app.name}
            site={app.site}
            size="sm"
          />
        </span>
      ))}
    </span>
  );
}

/**
 * The user at the rail's foot, which is the way to Settings: their picture
 * while they are signed in, the faders Settings wears elsewhere while they
 * are not, and the word under either. The 2.0 window has no sidebar of its
 * own to keep the account row in, so this is where it shows.
 */
function RailUser() {
  const { data: user } = useLiveUser();
  return (
    <button
      className="flex w-16 flex-col items-center gap-0.5 rounded-xl py-1.5 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
      onClick={() => {
        openSettings({ tab: "General" });
      }}
      type="button"
    >
      <span className="grid h-7 place-items-center">
        {user ? (
          <Avatar className="size-7 rounded-full">
            <AvatarImage alt="" src={user.image ?? undefined} />
            <AvatarFallback className="rounded-full text-[10px]">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
        ) : (
          <FadersHorizontalIcon className="size-6" />
        )}
      </span>
      <span className="text-[11px] leading-4">Settings</span>
    </button>
  );
}
