import {
  CHANNEL_COLORS,
  starterEmoji,
} from "@/client/components/orchestrator/channel-colors";
import {
  ChannelMarkPicker,
  ColorRow,
} from "@/client/components/orchestrator/channel-mark-picker";
import { ChannelChip } from "@/client/components/orchestrator/channel-rail";
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
import { useState } from "react";

/**
 * Making a channel, which is a workspace rather than a row: its own
 * conversation, its own tabs, its own files. Worth a moment, and nothing here
 * can be got wrong permanently, since the banner renames and re-marks it.
 */
export function NewChannelDialog({
  onCreate,
  onOpenChange,
  open,
  taken = [],
}: {
  onCreate: (channel: { color: string; emoji: string; name: string }) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** The marks already on the rail, so a new channel does not repeat one. */
  taken?: readonly string[];
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        {/* Inside the content, which the dialog unmounts on close, so the
          fields are empty again next time without an effect to clear them. */}
        <NewChannelForm
          onCreate={onCreate}
          onOpenChange={onOpenChange}
          taken={taken}
        />
      </DialogContent>
    </Dialog>
  );
}

function NewChannelForm({
  onCreate,
  onOpenChange,
  taken,
}: {
  onCreate: (channel: { color: string; emoji: string; name: string }) => void;
  onOpenChange: (open: boolean) => void;
  taken: readonly string[];
}) {
  const [name, setName] = useState("");
  // Seeded from how many channels there already are, so opening the dialog
  // twice in a row offers two different marks without the render being random.
  const [emoji, setEmoji] = useState(() => starterEmoji(taken, taken.length));
  const [color, setColor] = useState(
    () => CHANNEL_COLORS[taken.length % CHANNEL_COLORS.length] ?? "#3b6ef6",
  );
  const [isPicking, setPicking] = useState(false);

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
        <ChannelMarkPicker
          onEmoji={setEmoji}
          onOpenChange={setPicking}
          open={isPicking}
        >
          <button
            aria-label="Choose a mark"
            className="shrink-0 rounded-xl hover:opacity-80"
            type="button"
          >
            <ChannelChip
              channel={{ color, emoji }}
              className="size-11 text-[22px]"
            />
          </button>
        </ChannelMarkPicker>
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
        <p className="pb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Color
        </p>
        <ColorRow onPick={setColor} value={color} />
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
