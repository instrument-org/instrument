import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { cn } from "@/client/lib/utils";
import { useState } from "react";

/**
 * The marks on offer. Broad enough that most work finds something, short
 * enough to pick from without hunting; the user is not stopped from typing one
 * of their own into the field beside it.
 */
const EMOJI = [
  "🛒",
  "🔬",
  "🧵",
  "📓",
  "🧾",
  "✈️",
  "🏠",
  "🧑‍💻",
  "📚",
  "🎧",
  "🍋",
  "🛠️",
  "💼",
  "🪶",
  "🧭",
  "🎬",
];

/** The tints a channel's conversation can be drawn on. */
const COLORS = [
  "#3b6ef6",
  "#e0562f",
  "#0f9d6e",
  "#8b5cf6",
  "#d4a017",
  "#0891b2",
  "#db2777",
  "#65a30d",
];

/**
 * Making a channel, which is a workspace rather than a row: its own
 * conversation, its own tabs, its own files. Worth a moment, and nothing here
 * can be got wrong permanently, since the banner renames and re-marks it.
 */
export function NewChannelDialog({
  onCreate,
  onOpenChange,
  open,
}: {
  onCreate: (channel: { color: string; emoji: string; name: string }) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        {/* Inside the content, which the dialog unmounts on close, so the
          fields are empty again next time without an effect to clear them. */}
        <NewChannelForm onCreate={onCreate} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function NewChannelForm({
  onCreate,
  onOpenChange,
}: {
  onCreate: (channel: { color: string; emoji: string; name: string }) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(EMOJI[0] ?? "🛒");
  const [color, setColor] = useState(COLORS[0] ?? "#3b6ef6");

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    onCreate({ color, emoji, name: trimmed });
    onOpenChange(false);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>New channel</DialogTitle>
        <DialogDescription>
          Its own conversation, its own tabs, its own files.
        </DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-[20px] ring-1 ring-border">
          {emoji}
        </span>
        <Input
          autoFocus
          maxLength={16}
          onChange={(event) => {
            setName(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              create();
            }
          }}
          placeholder="Name it"
          value={name}
        />
      </div>
      <div>
        <p className="pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Mark
        </p>
        <div className="flex flex-wrap gap-1">
          {EMOJI.map((choice) => (
            <button
              aria-label={choice}
              className={cn(
                "grid size-8 place-items-center rounded-lg text-[17px] hover:bg-accent",
                choice === emoji && "bg-accent ring-1 ring-ring",
              )}
              key={choice}
              onClick={() => {
                setEmoji(choice);
              }}
              type="button"
            >
              {choice}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Color
        </p>
        <div className="flex gap-2">
          {COLORS.map((choice) => (
            <button
              aria-label={choice}
              className={cn(
                "size-6 rounded-full",
                choice === color && "ring-2 ring-foreground ring-offset-2",
              )}
              key={choice}
              onClick={() => {
                setColor(choice);
              }}
              style={{ background: choice }}
              type="button"
            />
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={() => {
            onOpenChange(false);
          }}
          variant="ghost"
        >
          Cancel
        </Button>
        <Button disabled={!name.trim()} onClick={create}>
          Create
        </Button>
      </DialogFooter>
    </>
  );
}
