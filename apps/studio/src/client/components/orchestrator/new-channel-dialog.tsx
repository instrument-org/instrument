import { CHANNEL_COLORS } from "@/client/components/orchestrator/channel-colors";
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
  const [emoji, setEmoji] = useState("🗂️");
  const [color, setColor] = useState(CHANNEL_COLORS[0] ?? "#3b6ef6");
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
          color={color}
          onColor={setColor}
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
