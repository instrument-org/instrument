import { FolderRow } from "@/client/components/folder-row";
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
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import {
  DictatedTextarea,
  useDictatedText,
} from "@/client/components/dictation-controls";
import { isDictating } from "@/client/hooks/use-dictation";
import {
  starterEmoji,
  TOPIC_COLORS,
} from "@/client/components/window/topic-colors";
import { TopicMark } from "@/client/components/window/topic-mark";
import {
  ColorRow,
  TopicMarkPicker,
} from "@/client/components/window/topic-mark-picker";
import { folderLabel } from "@/client/lib/path-utils";
import { showInFolder } from "@/client/lib/show-in-files";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { MinusCircleIcon } from "@phosphor-icons/react/MinusCircle";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
import { useRef, useState } from "react";
import { toast } from "@/client/lib/toast";

import { useEmojiSet } from "./emoji-set";
import { useEmojiSuggestions } from "./emoji-suggestions";
import { type BackfillCandidate, useTopicBackfill } from "./use-topic-backfill";

/**
 * How sure the decision model has to be before its pick replaces the mark: a
 * half-typed name gets a guess, and a guess should not repaint the mark.
 */
const CONFIDENT = 0.3;

/** What the user chooses about a topic: its name, its mark, its tint, its instructions and its folders. */
export interface TopicChoice {
  color: string;
  emoji: string;
  /** The user's folders the work under it uses, attached to each chat filed there. */
  folders: TopicFolder[];
  /** What every chat filed under it is given; empty takes them away. */
  instructions: string;
  name: string;
}

/** How long a topic's name may run: a row's worth, since that is where it is read. */
const TOPIC_NAME_MAX = 24;

// eslint-disable-next-line no-control-regex
const NOT_IN_A_FOLDER_NAME = /[<>:"/\\|?*\u0000-\u001F]/;

interface TopicFolder {
  path: string;
}

/**
 * A topic's name, mark, tint, instructions and folders, the same fields
 * whether the topic is being made or changed.
 *
 * Making one (`create`) starts from a fresh mark that follows the name until
 * one is picked by hand, and can file the chats that fit it as it lands.
 * Changing one (`edit`) starts from the topic as it stands, hands back only
 * what changed, and offers deleting it at its foot.
 */
export function TopicDialog(
  props: {
    onOpenChange: (open: boolean) => void;
    open: boolean;
    /** Every other topic's name, none of which this one can take. */
    otherNames: readonly string[];
  } & (
    | {
        /** Chats the new topic can be filed on as it is made, when they fit it. */
        candidates?: BackfillCandidate[];
        mode: "create";
        /** The name it starts with: what was typed where it was asked for. */
        name?: string;
        /** The topic, and the chats the person chose to file under it at once. */
        onCreate: (
          topic: TopicChoice,
          alsoFile: BackfillCandidate["id"][],
        ) => void;
        /** The marks already in use, so a new topic does not repeat one. */
        taken?: readonly string[];
      }
    | {
        mode: "edit";
        onChange: (edits: Partial<TopicChoice>) => void;
        /** Asked for from the foot, past a confirmation; the dialog closes with it. */
        onDelete: () => void;
        topic: {
          color?: string;
          emoji?: string;
          folders?: TopicFolder[];
          id: string;
          instructions?: string;
          name: string;
        };
      }
  ),
) {
  const { onOpenChange, open, otherNames } = props;
  if (props.mode === "create") {
    const { candidates = [], name = "", onCreate, taken = [] } = props;
    return (
      <Dialog onOpenChange={onOpenChange} open={open}>
        <TopicForm
          action="Create"
          candidates={candidates}
          description="Filing chats under a topic makes them easier to find later."
          // Seeded from how many topics there already are, so opening the
          // dialog twice in a row offers two different marks without the
          // render being random.
          initial={{
            color:
              TOPIC_COLORS[taken.length % TOPIC_COLORS.length] ?? "#3b6ef6",
            emoji: starterEmoji(taken, taken.length),
            folders: [],
            instructions: "",
            name,
          }}
          isNew
          onCommit={onCreate}
          onOpenChange={onOpenChange}
          open={open}
          otherNames={otherNames}
          title="New topic"
        />
      </Dialog>
    );
  }
  const { onChange, onDelete, topic } = props;
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {/* Keyed by the topic so opening a different one re-seeds the fields
        rather than showing the last topic's name. */}
      <TopicForm
        action="Save"
        deleting={{ name: topic.name, onDelete }}
        description="Changes apply to every chat filed under this topic."
        initial={{
          color: topic.color ?? TOPIC_COLORS[8] ?? "#3b6ef6",
          emoji: topic.emoji ?? "",
          folders: topic.folders ?? [],
          instructions: topic.instructions ?? "",
          name: topic.name,
        }}
        key={topic.id}
        onCommit={(chosen) => {
          onChange({
            ...(chosen.color === topic.color ? {} : { color: chosen.color }),
            ...(chosen.emoji === (topic.emoji ?? "")
              ? {}
              : { emoji: chosen.emoji }),
            ...(samePaths(chosen.folders, topic.folders ?? [])
              ? {}
              : { folders: chosen.folders }),
            ...(chosen.instructions.trim() === (topic.instructions ?? "").trim()
              ? {}
              : { instructions: chosen.instructions }),
            ...(chosen.name === topic.name ? {} : { name: chosen.name }),
          });
        }}
        onOpenChange={onOpenChange}
        open={open}
        otherNames={otherNames}
        title="Topic details"
      />
    </Dialog>
  );
}

/**
 * Why a name cannot be a topic's, said under the field, or nothing: a topic's
 * name is its folder's, so it cannot hold what a folder name cannot, and no
 * two topics share one. The workspace checks the same again.
 */
function nameProblem(name: string, otherNames: readonly string[]) {
  const trimmed = name.trim();
  if (NOT_IN_A_FOLDER_NAME.test(trimmed)) {
    return `A topic name can't contain any of: < > : " / \\ | ? *`;
  }
  if (trimmed.startsWith(".") || trimmed.endsWith(".")) {
    return "A topic name can't start or end with a period";
  }
  const taken = otherNames.find(
    (other) => other.toLowerCase() === trimmed.toLowerCase(),
  );
  return taken ? `There is already a topic called “${taken}”` : undefined;
}

/** Whether two folder lists name the same paths in the same order. */
function samePaths(a: TopicFolder[], b: TopicFolder[]) {
  return (
    a.length === b.length &&
    a.every((folder, index) => folder.path === b[index]?.path)
  );
}

/**
 * The folders the work under a topic uses: each one's place, a way to take
 * it off, and a way to add another from the system's own picker. Every chat
 * filed under the topic has them attached, so a task can be handed one.
 */
function TopicFolders({
  folders,
  onChange,
}: {
  folders: TopicFolder[];
  onChange: (folders: TopicFolder[]) => void;
}) {
  const remove = (folder: TopicFolder) => {
    onChange(folders.filter((entry) => entry !== folder));
  };
  const add = async () => {
    const picked = await rpcClient.utils.showFolderPicker
      .call({ buttonLabel: "Add" })
      .catch((error: unknown) => {
        toast.error("Couldn't open the folder picker", { cause: error });
        return null;
      });
    if (picked && !folders.some((folder) => folder.path === picked.path)) {
      onChange([...folders, { path: picked.path }]);
    }
  };
  return (
    // min-w-0 so a long path truncates inside the dialog rather than
    // widening the grid track it sits in.
    <div className="min-w-0">
      <div className="flex items-center justify-between pb-1">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Folders
        </p>
        <Button
          className="text-muted-foreground"
          onClick={() => {
            void add();
          }}
          size="xs"
          variant="ghost"
        >
          <PlusIcon className="size-3" />
          Add folder
        </Button>
      </div>
      {folders.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">No folders yet.</p>
      ) : (
        <ul className="-mx-2 grid grid-cols-1">
          {folders.map((folder) => (
            <li key={folder.path}>
              <FolderRow
                className="gap-1 rounded-md py-1.5 pr-1.5 pl-2 hover:bg-muted/50"
                end={
                  // Out of the way until the row is pointed at.
                  <button
                    aria-label={`Remove ${folderLabel(folder.path)}`}
                    className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 group-hover/folder-row:opacity-100 hover:bg-foreground/5 hover:text-foreground focus-visible:opacity-100"
                    onClick={() => {
                      remove(folder);
                    }}
                    type="button"
                  >
                    <XIcon className="size-3" />
                  </button>
                }
                menu={[
                  {
                    icon: <MinusCircleIcon className="size-4" />,
                    label: "Remove",
                    onSelect: () => {
                      remove(folder);
                    },
                  },
                ]}
                onOpen={() => {
                  void showInFolder(folder.path, { kind: "folder" });
                }}
                path={folder.path}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** How many of the chats that fit are named on the line before the rest are counted. */
const FITS_NAMED = 3;

/**
 * Deleting a topic, behind a confirmation: the tag goes, and the chats
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
            Your chats will stay. They just won’t be filed under “{name}”
            anymore.
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
 * The offer to file the chats that fit a new topic as it is made: one
 * checkbox, off until checked, over the first few chats by title, each with
 * the chat mark so it reads as a chat, and a count of the rest, so the person
 * sees what would be filed without choosing chat by chat.
 */
function FitsLine({
  checked,
  fits,
  name,
  onCheckedChange,
}: {
  checked: boolean;
  fits: BackfillCandidate[];
  name: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  const named = fits.slice(0, FITS_NAMED);
  const more = fits.length - named.length;
  return (
    // min-w-0 so a long title truncates inside the dialog rather than
    // widening the grid track it sits in.
    <label className="flex min-w-0 animate-in cursor-default items-start gap-2.5 rounded-lg bg-muted/60 px-3 py-2.5 duration-300 fade-in-0">
      <Checkbox
        checked={checked}
        className="mt-0.5"
        onCheckedChange={(value) => {
          onCheckedChange(value === true);
        }}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm break-words">
          {`Also file ${fits.length} ${fits.length === 1 ? "chat that fits" : "chats that fit"} “${name}”`}
        </span>
        <span className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
          {named.map((chat) => (
            <span className="flex min-w-0 items-center gap-1.5" key={chat.id}>
              <ChatCircleIcon className="size-3 shrink-0" />
              <span className="truncate">{chat.title}</span>
            </span>
          ))}
          {more > 0 && <span className="pl-4.5">{`and ${more} more`}</span>}
        </span>
      </span>
    </label>
  );
}

/**
 * The fields, which start over from `initial` each time the dialog opens: the
 * form stays mounted through the dialog's close, so what was typed into it
 * last time would otherwise be waiting at the next opening.
 */
function TopicForm({
  action,
  candidates = [],
  deleting,
  description,
  initial,
  isNew = false,
  onCommit,
  onOpenChange,
  open,
  otherNames,
  title,
}: {
  action: string;
  /** Chats to offer filing under the topic as it is made; none for a topic that exists. */
  candidates?: BackfillCandidate[];
  /** Offered at the foot when the topic exists to be deleted: whose name to confirm, and what deleting does. */
  deleting?: { name: string; onDelete: () => void };
  description: string;
  initial: TopicChoice;
  /** A topic being made, whose mark follows its name until one is picked by hand. */
  isNew?: boolean;
  onCommit: (topic: TopicChoice, alsoFile: BackfillCandidate["id"][]) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  otherNames: readonly string[];
  title: string;
}) {
  const [name, setName] = useState(initial.name);
  const [emoji, setEmoji] = useState(initial.emoji);
  const [color, setColor] = useState(initial.color);
  const [instructions, setInstructions] = useState(initial.instructions);
  const instructionsDictation = useDictatedText({
    onChange: setInstructions,
    surface: "topic-instructions",
    value: instructions ?? "",
  });
  // Saving waits for dictated words, so the instructions keep them.
  const isHolding = isDictating(instructionsDictation.phase);
  const [folders, setFolders] = useState(initial.folders);
  const [isPicking, setPicking] = useState(false);
  // A new topic's mark follows the best fit for its name until one is chosen
  // by hand; an existing topic's mark stays what its owner picked.
  const [follows, setFollows] = useState(isNew);
  // Off until asked for: filing chats is the person's call, made once, for
  // the whole set the line names.
  const [isFilingFits, setFilingFits] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(initial.name);
      setEmoji(initial.emoji);
      setColor(initial.color);
      setInstructions(initial.instructions);
      setFolders(initial.folders);
      setPicking(false);
      setFollows(isNew);
      setFilingFits(false);
    }
  }
  const fits = useTopicBackfill({ candidates, name, open });
  const all = useEmojiSet();
  // Asked after a pause rather than per word, so the mark changes once the
  // name has settled instead of flickering through every prefix of it.
  const { suggestions } = useEmojiSuggestions(
    open && follows ? name : "",
    all,
    {
      debounceMs: 400,
      personal: true,
    },
  );
  const [best] = suggestions;
  if (
    follows &&
    best &&
    best.probability >= CONFIDENT &&
    best.emoji.unicode !== emoji
  ) {
    setEmoji(best.emoji.unicode);
  }
  const choose = (picked: string) => {
    setFollows(false);
    setEmoji(picked);
  };
  const nameField = useRef<HTMLInputElement>(null);

  const problem = nameProblem(name, otherNames);
  const commit = () => {
    if (isHolding) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed || problem) {
      return;
    }
    onCommit(
      { color, emoji, folders, instructions, name: trimmed },
      isFilingFits ? fits.map((chat) => chat.id) : [],
    );
    onOpenChange(false);
  };

  return (
    <DialogContent
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
          context={name}
          onEmoji={choose}
          onOpenChange={setPicking}
          open={isPicking}
        >
          <button
            aria-label="Choose a mark"
            className="shrink-0 rounded-xl hover:opacity-80"
            type="button"
          >
            <TopicMark
              // A changed mark fades in where it stands, so one that follows
              // the name reads as an answer arriving rather than a flicker.
              className="animate-in duration-300 fade-in-0 zoom-in-90"
              key={emoji}
              size="lg"
              topic={{ color, emoji, name }}
            />
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
      {problem && <p className="-mt-2 text-xs text-destructive">{problem}</p>}
      {fits.length > 0 && (
        <FitsLine
          checked={isFilingFits}
          fits={fits}
          name={name.trim()}
          onCheckedChange={setFilingFits}
        />
      )}
      <div>
        <p className="pb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Color
        </p>
        <ColorRow onPick={setColor} value={color} />
      </div>
      <div>
        <label
          className="block pb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
          htmlFor="topic-instructions"
        >
          Instructions
        </label>
        <DictatedTextarea
          className="max-h-64 min-h-24 text-sm"
          dictation={instructionsDictation}
          id="topic-instructions"
          onChange={(event) => {
            setInstructions(event.target.value);
          }}
          placeholder={`What ${APP_NAME} should know or do in every chat filed here`}
          value={instructions}
        />
      </div>
      <TopicFolders folders={folders} onChange={setFolders} />
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
          <Button
            disabled={!name.trim() || problem !== undefined || isHolding}
            onClick={commit}
          >
            {action}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}
