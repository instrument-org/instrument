import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { TOPIC_COLORS } from "@/client/components/window/topic-colors";
import { topicTint } from "@/client/components/window/topic-tint";
import { Input } from "@/client/components/ui/input";
import { cn } from "@/client/lib/utils";
import { type ReactNode, useState } from "react";

import { EmojiGrid } from "./emoji-grid";
import { searchTopicIcons } from "./topic-icons";

/**
 * The tints, one of them chosen: a pale one and a deep one of every hue, in
 * that order, so the two rows read as two families rather than as sixteen
 * neighbors. Each swatch is drawn in the rebuilt color rather than the raw hex,
 * since only the hue of a palette entry survives the tint and two entries that
 * look different here would otherwise come out the same on a mark.
 */
export function ColorRow({
  onPick,
  value,
}: {
  onPick: (color: string) => void;
  value?: string;
}) {
  return (
    // Eight to a row, each swatch taking an equal share of the width, so the
    // pale row sits square over the deep one and the two read as two families.
    <div className="grid grid-cols-8 justify-items-center gap-2">
      {TOPIC_COLORS.map((color) => (
        <button
          aria-label={`Color ${color}`}
          className={cn(
            "size-7 rounded-full transition topic-tint",
            color === value
              ? // Outside the swatch, so choosing one does not shrink it: an
                // inset ring eats into the color it is meant to be marking.
                "ring-2 ring-foreground ring-offset-2 ring-offset-popover"
              : "ring-1 ring-black/10 ring-inset hover:scale-110",
          )}
          key={color}
          onClick={() => {
            onPick(color);
          }}
          style={{
            background: "var(--topic-tint-base)",
            ...topicTint(color),
          }}
          type="button"
        />
      ))}
    </div>
  );
}

/** Which half of the picker is up: the app's icons, or every emoji. */
type MarkKind = "emoji" | "icon";

/**
 * The mark a topic is known by, and the popover that changes it: the app's
 * filled icons in the topic's color, or every emoji, each with a search
 * field, so the mark that makes a topic findable in a row of others is
 * chosen in one place. It opens on whichever kind the topic wears.
 */
export function TopicMarkPicker({
  children,
  color,
  context,
  icon,
  onEmoji,
  onIcon,
  onOpenChange,
  open,
}: {
  /** The trigger: the mark as it stands. */
  children: ReactNode;
  /** The topic's color, which the icons are drawn in. */
  color: string;
  /** The name being marked, which the picker suggests emoji for. */
  context?: string;
  /** The icon the topic wears, if it wears one. */
  icon?: string;
  onEmoji: (emoji: string) => void;
  onIcon: (icon: string) => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}) {
  const [kind, setKind] = useState<MarkKind>(icon ? "icon" : "emoji");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setKind(icon ? "icon" : "emoji");
    }
  }
  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-0"
        side="bottom"
        sideOffset={6}
      >
        <div className="flex gap-4 border-b px-3" role="tablist">
          {(["icon", "emoji"] as const).map((each) => (
            <button
              aria-selected={kind === each}
              className={cn(
                "-mb-px border-b-2 py-2 text-sm",
                kind === each
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              key={each}
              onClick={() => {
                setKind(each);
              }}
              role="tab"
              type="button"
            >
              {each === "icon" ? "Icons" : "Emoji"}
            </button>
          ))}
        </div>
        {kind === "icon" ? (
          <IconGrid
            color={color}
            onPick={(picked) => {
              onIcon(picked);
              onOpenChange?.(false);
            }}
            value={icon}
          />
        ) : (
          <EmojiGrid
            context={context}
            onPick={(picked) => {
              onEmoji(picked);
              onOpenChange?.(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The app's topic icons, filled and in the topic's color, narrowed by a search. */
function IconGrid({
  color,
  onPick,
  value,
}: {
  color: string;
  onPick: (icon: string) => void;
  value?: string;
}) {
  const [query, setQuery] = useState("");
  const shown = searchTopicIcons(query);
  return (
    <div className="flex h-80 flex-col">
      <div className="p-2 pb-1">
        <Input
          autoFocus
          className="h-8"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Search icons"
          value={query}
        />
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2 topic-tint"
        style={topicTint(color)}
      >
        {shown.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">
            No icons match “{query.trim()}”
          </p>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {shown.map(({ Icon, name }) => (
              <button
                aria-label={name}
                className={cn(
                  "grid size-8 place-items-center rounded-md text-(--topic-tint-ink) hover:bg-accent",
                  name === value && "bg-accent",
                )}
                key={name}
                onClick={() => {
                  onPick(name);
                }}
                title={name.replaceAll(/([a-z])([A-Z])/g, "$1 $2")}
                type="button"
              >
                <Icon className="size-5" weight="fill" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
