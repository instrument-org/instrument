import {
  ChannelMarkPicker,
  ColorRow,
} from "@/client/components/orchestrator/channel-mark-picker";
import {
  ChannelChip,
  type ChannelMark,
} from "@/client/components/orchestrator/channel-rail";
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

/** What the details dialog can change about a channel. */
export interface ChannelEdits {
  color?: string;
  emoji?: string;
  name?: string;
}

/**
 * A channel as it stands, in the shape the dialog that made it used: the mark
 * beside the name, the colors under them, and here also the way to archive it.
 *
 * Archiving lives in the dialog rather than on a menu because it is the most
 * destructive thing a channel can be told, and it should cost a deliberate
 * trip rather than a slip of the pointer.
 */
export function ChannelDetailsDialog({
  canEdit,
  channel,
  onArchive,
  onChange,
  onOpenChange,
  open,
}: {
  /** False for the channel the conversation started in: the app's own room. */
  canEdit: boolean;
  channel: ChannelMark & { id: string; name: string };
  /** Absent for the channel that cannot go: the conversation has to happen somewhere. */
  onArchive?: () => void;
  onChange: (edits: ChannelEdits) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        {/* Keyed by the channel so opening a different one re-seeds the field
          rather than showing the last channel's name. */}
        <ChannelDetailsForm
          canEdit={canEdit}
          channel={channel}
          key={channel.id}
          onChange={onChange}
          onOpenChange={onOpenChange}
          {...(onArchive ? { onArchive } : {})}
        />
      </DialogContent>
    </Dialog>
  );
}

function ChannelDetailsForm({
  canEdit,
  channel,
  onArchive,
  onChange,
  onOpenChange,
}: {
  canEdit: boolean;
  channel: ChannelMark & { id: string; name: string };
  onArchive?: () => void;
  onChange: (edits: ChannelEdits) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(channel.name);
  const [isPicking, setPicking] = useState(false);

  const commitName = () => {
    const next = name.trim();
    if (next && next !== channel.name) {
      onChange({ name: next });
    }
  };

  const mark = (
    <ChannelChip channel={channel} className="size-11 text-[22px]" />
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Channel details</DialogTitle>
        <DialogDescription>
          Its own conversation, its own tabs, its own files.
        </DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-3">
        {canEdit ? (
          <ChannelMarkPicker
            onEmoji={(emoji) => {
              onChange({ emoji });
            }}
            onOpenChange={setPicking}
            open={isPicking}
          >
            <button
              aria-label="Choose a mark"
              className="shrink-0 rounded-xl hover:opacity-80"
              type="button"
            >
              {mark}
            </button>
          </ChannelMarkPicker>
        ) : (
          mark
        )}
        <Input
          disabled={!canEdit}
          maxLength={16}
          onBlur={commitName}
          onChange={(event) => {
            setName(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commitName();
            }
          }}
          placeholder="Name it"
          value={name}
        />
      </div>
      {canEdit && (
        <div>
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
      )}
      <DialogFooter className="sm:justify-between">
        {onArchive ? (
          <Button
            onClick={() => {
              onArchive();
              onOpenChange(false);
            }}
            variant="ghost-destructive"
          >
            Archive channel
          </Button>
        ) : (
          <span />
        )}
        <Button
          onClick={() => {
            commitName();
            onOpenChange(false);
          }}
        >
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
