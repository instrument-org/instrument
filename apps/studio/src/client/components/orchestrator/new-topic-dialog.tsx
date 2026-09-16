import {
  starterEmoji,
  TOPIC_COLORS,
} from "@/client/components/orchestrator/topic-colors";
import { TopicMark } from "@/client/components/orchestrator/topic-mark";
import {
  ColorRow,
  TopicMarkPicker,
} from "@/client/components/orchestrator/topic-mark-picker";
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
import { useRef, useState } from "react";

/** What the user chooses about a topic: its name, its mark, its tint. */
export interface TopicChoice {
  color: string;
  emoji: string;
  name: string;
}

/** How long a topic's name may run: a chip's worth, since that is where it is read. */
const TOPIC_NAME_MAX = 24;

/**
 * A topic as it stands, in the shape the dialog that made it used, for
 * renaming it or changing its mark. Only what changed is handed back.
 */
export function EditTopicDialog({
  onChange,
  onOpenChange,
  open,
  picking = false,
  topic,
}: {
  onChange: (edits: Partial<TopicChoice>) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** Opens with the mark picker already out, for a change asked for as "change mark". */
  picking?: boolean;
  topic: { color?: string; emoji?: string; id: string; name: string };
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {/* Keyed by the topic so opening a different one re-seeds the fields
        rather than showing the last topic's name. */}
      <TopicForm
        action="Save"
        description="Threads filed under it keep the change."
        initial={{
          color: topic.color ?? TOPIC_COLORS[8] ?? "#3b6ef6",
          emoji: topic.emoji ?? "",
          name: topic.name,
        }}
        key={topic.id}
        onCommit={(chosen) => {
          onChange({
            ...(chosen.color === topic.color ? {} : { color: chosen.color }),
            ...(chosen.emoji === topic.emoji ? {} : { emoji: chosen.emoji }),
            ...(chosen.name === topic.name ? {} : { name: chosen.name }),
          });
        }}
        onOpenChange={onOpenChange}
        picking={picking}
        title="Edit topic"
      />
    </Dialog>
  );
}

/**
 * Making a topic, which is a tag rather than a place: threads are filed under
 * it and the list is filtered by it. Worth a moment, and nothing here can be
 * got wrong permanently, since the topic's own menu renames and re-marks it.
 */
export function NewTopicDialog({
  onCreate,
  onOpenChange,
  open,
  taken = [],
}: {
  onCreate: (topic: TopicChoice) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** The marks already in use, so a new topic does not repeat one. */
  taken?: readonly string[];
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {/* The form is the content, which the dialog unmounts on close, so the
        fields are empty again next time without an effect to clear them. */}
      <TopicForm
        action="Create"
        description="File threads under it, and find them by it."
        // Seeded from how many topics there already are, so opening the
        // dialog twice in a row offers two different marks without the
        // render being random.
        initial={{
          color: TOPIC_COLORS[taken.length % TOPIC_COLORS.length] ?? "#3b6ef6",
          emoji: starterEmoji(taken, taken.length),
          name: "",
        }}
        onCommit={onCreate}
        onOpenChange={onOpenChange}
        title="New topic"
      />
    </Dialog>
  );
}

function TopicForm({
  action,
  description,
  initial,
  onCommit,
  onOpenChange,
  picking = false,
  title,
}: {
  action: string;
  description: string;
  initial: TopicChoice;
  onCommit: (topic: TopicChoice) => void;
  onOpenChange: (open: boolean) => void;
  picking?: boolean;
  title: string;
}) {
  const [name, setName] = useState(initial.name);
  const [emoji, setEmoji] = useState(initial.emoji);
  const [color, setColor] = useState(initial.color);
  const [isPicking, setPicking] = useState(picking);
  const nameField = useRef<HTMLInputElement>(null);

  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    onCommit({ color, emoji, name: trimmed });
    onOpenChange(false);
  };

  return (
    <DialogContent
      className="sm:max-w-md"
      // The name is what the dialog is for, so the caret starts in it, with
      // the name selected so typing replaces it; the dialog would otherwise
      // put focus on the first control, which is the mark. Left alone while
      // the picker opens with the dialog, since that is where the caret goes.
      onOpenAutoFocus={(event) => {
        if (picking) {
          return;
        }
        event.preventDefault();
        nameField.current?.focus();
        nameField.current?.select();
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-3">
        <TopicMarkPicker
          onEmoji={setEmoji}
          onOpenChange={setPicking}
          open={isPicking}
        >
          <button
            aria-label="Choose a mark"
            className="shrink-0 rounded-xl hover:opacity-80"
            type="button"
          >
            <TopicMark size="lg" topic={{ color, emoji, name }} />
          </button>
        </TopicMarkPicker>
        <Input
          maxLength={TOPIC_NAME_MAX}
          onChange={(event) => {
            setName(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
            }
          }}
          placeholder="Name it"
          ref={nameField}
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
        <Button disabled={!name.trim()} onClick={commit}>
          {action}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
