import {
  starterEmoji,
  TOPIC_COLORS,
} from "@/client/components/orchestrator/topic-colors";
import { TopicMark } from "@/client/components/orchestrator/topic-mark";
import {
  ColorRow,
  TopicMarkPicker,
} from "@/client/components/orchestrator/topic-mark-picker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/client/components/ui/alert-dialog";
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

/** How long a topic's name may run: a row's worth, since that is where it is read. */
const TOPIC_NAME_MAX = 24;

/**
 * A topic as it stands, in the shape the dialog that made it used: its name,
 * its mark, and its tint, for changing any of them, and at its foot the way to
 * delete it. Only what changed is handed back.
 */
export function EditTopicDialog({
  onChange,
  onDelete,
  onOpenChange,
  open,
  topic,
}: {
  onChange: (edits: Partial<TopicChoice>) => void;
  /** Asked for from the foot, past a confirmation; the dialog closes with it. */
  onDelete: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  topic: { color?: string; emoji?: string; id: string; name: string };
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {/* Keyed by the topic so opening a different one re-seeds the fields
        rather than showing the last topic's name. */}
      <TopicForm
        action="Save"
        deleting={{ name: topic.name, onDelete }}
        description="Changes apply to every thread filed under it."
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
        open={open}
        title="Topic details"
      />
    </Dialog>
  );
}

/**
 * Making a topic, which is a tag rather than a place: threads are filed under
 * it and the list is filtered by it. Worth a moment, and nothing here can be
 * got wrong permanently, since the topic's details rename and re-mark it.
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
      <TopicForm
        action="Create"
        description="File threads under it to find them later."
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
        open={open}
        title="New topic"
      />
    </Dialog>
  );
}

/**
 * Deleting a topic, behind a confirmation: the tag goes, and the threads
 * filed under it keep everything else they have.
 */
function DeleteTopicButton({
  name,
  onDelete,
}: {
  name: string;
  onDelete: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          className="text-destructive hover:text-destructive"
          variant="ghost"
        >
          Delete topic
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{`Delete “${name}”?`}</AlertDialogTitle>
          <AlertDialogDescription>
            Threads filed under it keep everything; they lose the tag.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onDelete} variant="destructive">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The fields, which start over from `initial` each time the dialog opens: the
 * form stays mounted through the dialog's close, so what was typed into it
 * last time would otherwise be waiting at the next opening.
 */
function TopicForm({
  action,
  deleting,
  description,
  initial,
  onCommit,
  onOpenChange,
  open,
  title,
}: {
  action: string;
  /** Offered at the foot when the topic exists to be deleted: whose name to confirm, and what deleting does. */
  deleting?: { name: string; onDelete: () => void };
  description: string;
  initial: TopicChoice;
  onCommit: (topic: TopicChoice) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}) {
  const [name, setName] = useState(initial.name);
  const [emoji, setEmoji] = useState(initial.emoji);
  const [color, setColor] = useState(initial.color);
  const [isPicking, setPicking] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(initial.name);
      setEmoji(initial.emoji);
      setColor(initial.color);
      setPicking(false);
    }
  }
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
      // put focus on the first control, which is the mark.
      onOpenAutoFocus={(event) => {
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
      <DialogFooter className="sm:justify-between">
        {deleting ? (
          <DeleteTopicButton
            name={deleting.name}
            onDelete={() => {
              deleting.onDelete();
              onOpenChange(false);
            }}
          />
        ) : (
          <span />
        )}
        <div className="flex gap-2">
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
        </div>
      </DialogFooter>
    </DialogContent>
  );
}
