import { openReportDialog } from "@/client/atoms/report-dialog";
import { openSettings } from "@/client/atoms/settings-modal";
import { type AppPlace } from "@/client/atoms/window";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { ChatMarkDot } from "@/client/components/window/chat-mark";
import { type RailChatMark } from "@/client/components/window/chats";
import { PlaceIcon } from "@/client/components/window/place-icons";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/client/components/ui/avatar";
import { useLiveUser } from "@/client/hooks/use-live-user";
import { wantsNewTab } from "@/client/hooks/use-open-target";
import { getInitials } from "@/client/lib/get-initials";
import { feedbackReport } from "@/client/lib/problem-reports";
import { focusScreenHome } from "@/client/lib/keyboard-home";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { FadersHorizontalIcon } from "@phosphor-icons/react/FadersHorizontal";
import { MegaphoneSimpleIcon } from "@phosphor-icons/react/MegaphoneSimple";
import { NotePencilIcon } from "@phosphor-icons/react/NotePencil";
import { type ReactNode } from "react";

/**
 * The places, in the order the rail draws them, each drawn filled while it
 * is the place stood in.
 */
export const PLACES: { id: AppPlace; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "files", label: "Files" },
  { id: "browser", label: "Browser" },
  { id: "apps", label: "Apps" },
];

/** The rail's width in px, `w-19`, for what is laid over the window clear of it. */
export const APP_RAIL_WIDTH = 76;

/**
 * The rail down the window's left edge: New at its top, then one entry per
 * place, each a mark with its word close under it, and at its foot Feedback
 * over the user, who is the way to Settings. The one the window stands in sits in a soft well
 * around the whole entry, mark and word together. Narrow enough to be
 * chrome rather than a column: a mark, a word, and nothing wider than
 * either. Away from Chat, Chat wears a dot for where the chats stand.
 */
export function AppRail({
  chatMark,
  onChoose,
  onHoverChat,
  onNew,
  place,
}: {
  /** The dot Chat wears while the window stands in another place. */
  chatMark?: RailChatMark;
  /** A place asked for: in the tab up, or in a tab of its own for a middle or modified click or the menu's ask. */
  onChoose: (place: AppPlace, options: { newTab: boolean }) => void;
  /** The pointer come onto Chat or gone from it, for the inbox to peek out while it is nowhere on screen. */
  onHoverChat?: (isOver: boolean) => void;
  /** Opens a draft of a new chat. */
  onNew: () => void;
  /** The place the window stands in; none while a screen outside its places is up. */
  place?: AppPlace;
}) {
  return (
    <nav
      aria-label="Places"
      className="flex h-full w-19 shrink-0 flex-col items-center gap-3 pt-1 pb-2"
    >
      {/* The way to a new chat, in the brand's own green: round, since the
        word under it is the label and the tile needs none of its own. */}
      <ToolbarTooltip chord="newChat" label="New">
        <button
          className="group flex w-15 flex-col items-center gap-0.5 rounded-xl py-1.5"
          onClick={onNew}
          type="button"
        >
          <span className="grid size-11 place-items-center rounded-full bg-brand-600 button-sheen text-brand-foreground shadow-xs group-hover:bg-brand-700">
            <NotePencilIcon className="size-5" weight="bold" />
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
            onChoose={(newTab) => {
              onChoose(entry.id, { newTab });
              // A new tab hands the keyboard over as it comes up.
              if (!newTab) {
                focusScreenHome({ leaving: place !== entry.id });
              }
            }}
            {...(entry.id === "chat" && onHoverChat
              ? { onHover: onHoverChat }
              : {})}
          >
            <PlaceIcon
              className="size-6"
              place={entry.id}
              weight={place === entry.id ? "fill" : "regular"}
            />
            {entry.id === "chat" && place !== "chat" && chatMark && (
              <ChatMarkDot mark={chatMark} />
            )}
          </RailEntry>
        ))}
      </div>
      <div className="flex-1" />
      <div className="flex flex-col items-center gap-1">
        <RailFeedback />
        <RailUser />
      </div>
    </nav>
  );
}

/** The middle button, which asks for a tab of its own. */
const MIDDLE_BUTTON = 1;

function openGeneralSettings() {
  openSettings({ tab: "General" });
}

/**
 * One entry of the rail: its mark in a slot of one height, and its word
 * close under it, the two together in a well that fills while it is the
 * place stood in and tints under the pointer. Never the mark alone. A click
 * takes the tab up there; the middle button, a click with Command or
 * Control, or the menu's Open in New Tab opens a tab there.
 */
function RailEntry({
  children,
  isOn,
  label,
  onChoose,
  onHover,
}: {
  children: ReactNode;
  isOn: boolean;
  label: string;
  onChoose: (newTab: boolean) => void;
  onHover?: (isOver: boolean) => void;
}) {
  return (
    <button
      aria-current={isOn ? "page" : undefined}
      // What the inbox peeks out from, so a press on it is no press outside
      // the peek.
      data-peeks-inbox={onHover ? "" : undefined}
      className={cn(
        "flex w-15 flex-col items-center gap-0.5 rounded-xl py-1.5",
        isOn
          ? "bg-foreground/8 text-brand-600 dark:text-brand-400"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
      )}
      onAuxClick={(event) => {
        if (event.button === MIDDLE_BUTTON) {
          event.preventDefault();
          onChoose(true);
        }
      }}
      onClick={(event) => {
        onChoose(wantsNewTab(event));
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        void rpcClient.utils.showContextMenu
          .call({
            items: [
              { id: "open", label: "Open" },
              { id: "newTab", label: "Open in New Tab" },
            ],
          })
          .then((picked) => {
            if (picked.id === "open" || picked.id === "newTab") {
              onChoose(picked.id === "newTab");
            }
          });
      }}
      onPointerEnter={() => {
        onHover?.(true);
      }}
      onPointerLeave={() => {
        onHover?.(false);
      }}
      type="button"
    >
      <span className="relative grid h-6 place-items-center">{children}</span>
      <span className={cn("text-[11px] leading-4", isOn && "font-medium")}>
        {label}
      </span>
    </button>
  );
}

/**
 * Send feedback, kept in sight above the user rather than only in the Help
 * menu: the feedback dialog, about no chat in particular.
 */
function RailFeedback() {
  return (
    <button
      className="flex w-15 flex-col items-center gap-0.5 rounded-xl py-1.5 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
      onClick={() => {
        openReportDialog(feedbackReport({ surface: "rail" }));
      }}
      type="button"
    >
      <span className="grid h-6 place-items-center">
        <MegaphoneSimpleIcon className="size-6" />
      </span>
      <span className="text-[11px] leading-4">Feedback</span>
    </button>
  );
}

/**
 * The user at the rail's foot, which is the way to Settings: their picture
 * alone, in a rounded square, while they are signed in, and the faders
 * Settings wears elsewhere with the word under them while they are not.
 * The window has no sidebar of its own to keep the account row in, so this
 * is where it shows.
 */
function RailUser() {
  const { data: user } = useLiveUser();
  if (user) {
    return (
      <ToolbarTooltip label="Settings">
        <button
          // The same well the signed-out Settings entry stands in, so the
          // foot holds the rail's 8px gutter either way, with the picture
          // centered in it: 16px from either side and from the bottom.
          className="grid w-15 place-items-center rounded-xl p-2 hover:bg-foreground/5"
          onClick={openGeneralSettings}
          type="button"
        >
          <Avatar className="size-11 rounded-xl">
            <AvatarImage alt="" src={user.image ?? undefined} />
            <AvatarFallback className="text-xs">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
        </button>
      </ToolbarTooltip>
    );
  }
  return (
    <button
      className="flex w-15 flex-col items-center gap-0.5 rounded-xl py-1.5 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
      onClick={openGeneralSettings}
      type="button"
    >
      <span className="grid h-6 place-items-center">
        <FadersHorizontalIcon className="size-6" />
      </span>
      <span className="text-[11px] leading-4">Settings</span>
    </button>
  );
}
