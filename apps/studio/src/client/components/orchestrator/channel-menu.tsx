import { ColorRow } from "@/client/components/orchestrator/channel-mark-picker";
import { EmojiGrid } from "@/client/components/orchestrator/emoji-grid";
import { Input } from "@/client/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/client/components/ui/popover";
import { cn } from "@/client/lib/utils";
import { useState } from "react";

/** What a channel's menu can change about it. */
export interface ChannelEdits {
  color?: string;
  emoji?: string;
  name?: string;
}

/** Where a menu was asked for, in window coordinates. */
export interface MenuAt {
  x: number;
  y: number;
}

/**
 * Everything a channel can be told to become, in one place, wherever the
 * channel is drawn.
 *
 * The rail opens it on right click and the banner from the caret beside the
 * name, because a channel shown in two places and changeable in only one of
 * them is a channel you have to remember the rules for.
 */
export function ChannelMenu({
  at,
  canEdit,
  channel,
  onArchive,
  onChange,
  onClose,
}: {
  at: MenuAt | undefined;
  /** False for the app's own channel, which keeps the name and mark it has. */
  canEdit: boolean;
  channel: { color?: string; emoji?: string; name: string };
  /** Absent for the channel that cannot go: the conversation has to happen somewhere. */
  onArchive?: () => void;
  onChange: (edits: ChannelEdits) => void;
  onClose: () => void;
}) {
  const [isEditing, setEditing] = useState(false);

  if (!at) {
    return null;
  }

  const close = () => {
    setEditing(false);
    onClose();
  };

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      open
    >
      <PopoverAnchor asChild>
        <PointAnchor at={at} />
      </PopoverAnchor>
      {isEditing ? (
        <PopoverContent align="start" className="w-72 p-0" side="right">
          <div className="p-2">
            <Input
              autoFocus
              className="h-8"
              defaultValue={channel.name}
              maxLength={16}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }
                const name = event.currentTarget.value.trim();
                if (name && name !== channel.name) {
                  onChange({ name });
                }
                close();
              }}
              placeholder="Name it"
            />
          </div>
          <EmojiGrid
            onPick={(emoji) => {
              onChange({ emoji });
              close();
            }}
          />
          <div className="border-t border-border p-3">
            <p className="pb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Color
            </p>
            <ColorRow
              onPick={(color) => {
                onChange({ color });
              }}
              {...(channel.color === undefined ? {} : { value: channel.color })}
            />
          </div>
        </PopoverContent>
      ) : (
        <PopoverContent
          align="start"
          className="w-48 p-1"
          role="menu"
          side="right"
        >
          <MenuItem
            disabled={!canEdit}
            onClick={() => {
              setEditing(true);
            }}
          >
            Rename, mark and color…
          </MenuItem>
          <div className="my-1 h-px bg-border" />
          <MenuItem
            danger
            disabled={!onArchive}
            onClick={() => {
              onArchive?.();
              close();
            }}
          >
            Archive
          </MenuItem>
        </PopoverContent>
      )}
    </Popover>
  );
}

function MenuItem({
  children,
  danger,
  disabled,
  onClick,
}: {
  children: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-40",
        danger && "text-destructive hover:bg-destructive/10",
      )}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * A point in the window a menu can hang from.
 *
 * Radix anchors to an element and a right click has only coordinates, so this
 * is the element: one pixel, no ink, placed where the press was. It is what
 * lets the rail and the banner open the same menu from two different gestures.
 */
function PointAnchor({ at }: { at: MenuAt }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none fixed size-px"
      style={{ left: at.x, top: at.y }}
    />
  );
}
