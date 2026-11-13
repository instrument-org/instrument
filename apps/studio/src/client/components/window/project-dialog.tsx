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
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import {
  DictationControls,
  DictationReadout,
  useCanDictate,
  useDictatedText,
} from "@/client/components/dictation-controls";
import { MarkdownValueEditor } from "@/client/components/markdown-editor/markdown-value-editor";
import { isDictating } from "@/client/hooks/use-dictation";
import {
  starterEmoji,
  PROJECT_COLORS,
} from "@/client/components/window/project-colors";
import { ProjectMark } from "@/client/components/window/project-mark";
import {
  ColorRow,
  ProjectMarkPicker,
} from "@/client/components/window/project-mark-picker";
import { folderLabel } from "@/client/lib/path-utils";
import { useWorkspaceFolder } from "@/client/lib/output-folder";
import {
  projectFolderPath,
  showInFolder,
  showProjectInFiles,
} from "@/client/lib/show-in-files";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { PROJECT_FILE_NAME } from "@instrument-org/workspace/client";
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { MinusCircleIcon } from "@phosphor-icons/react/MinusCircle";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
import { useRef, useState } from "react";
import { toast } from "@/client/lib/toast";

import { useEmojiSet } from "./emoji-set";
import { useEmojiSuggestions } from "./emoji-suggestions";
import {
  type BackfillCandidate,
  useProjectBackfill,
} from "./use-project-backfill";

/**
 * How sure the decision model has to be before its pick replaces the mark: a
 * half-typed name gets a guess, and a guess should not repaint the mark.
 */
const CONFIDENT = 0.3;

/** What the user chooses about a project: its name, its mark, its tint, its instructions and its folders. */
export interface ProjectChoice {
  color: string;
  /** Its mark when it is an emoji; empty when it is an icon. */
  emoji: string;
  /** The user's folders the work under it uses, attached to each chat filed there. */
  folders: ProjectFolder[];
  /** Its mark when it is a Phosphor icon, by name; empty when it is an emoji. */
  icon: string;
  /** What every chat filed under it is given; empty takes them away. */
  instructions: string;
  name: string;
}

/** How long a project's name may run: a row's worth, since that is where it is read. */
const PROJECT_NAME_MAX = 24;

// eslint-disable-next-line no-control-regex
const NOT_IN_A_FOLDER_NAME = /[<>:"/\\|?*\u0000-\u001F]/;

interface ProjectFolder {
  path: string;
}

/**
 * A project's name, mark, tint, instructions and folders, the same fields
 * whether the project is being made or changed.
 *
 * Making one (`create`) starts from a fresh mark that follows the name until
 * one is picked by hand, and can file the chats that fit it as it lands.
 * Changing one (`edit`) starts from the project as it stands, hands back only
 * what changed, and offers deleting it at its foot.
 */
export function ProjectDialog(
  props: {
    onOpenChange: (open: boolean) => void;
    open: boolean;
    /** Every other project's name, none of which this one can take. */
    otherNames: readonly string[];
  } & (
    | {
        /** Chats the new project can be filed on as it is made, when they fit it. */
        candidates?: BackfillCandidate[];
        mode: "create";
        /** The name it starts with: what was typed where it was asked for. */
        name?: string;
        /** The project, and the chats the person chose to file under it at once. */
        onCreate: (
          project: ProjectChoice,
          alsoFile: BackfillCandidate["id"][],
        ) => void;
        /** The marks already in use, so a new project does not repeat one. */
        taken?: readonly string[];
      }
    | {
        mode: "edit";
        onChange: (edits: Partial<ProjectChoice>) => void;
        /** Asked for from the foot, past a confirmation; the dialog closes with it. */
        onDelete: () => void;
        project: {
          color?: string;
          emoji?: string;
          folders?: ProjectFolder[];
          icon?: string;
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
        <ProjectForm
          action="Create"
          candidates={candidates}
          description="Filing chats under a project makes them easier to find later."
          // Seeded from how many projects there already are, so opening the
          // dialog twice in a row offers two different marks without the
          // render being random.
          initial={{
            color:
              PROJECT_COLORS[taken.length % PROJECT_COLORS.length] ?? "#3b6ef6",
            emoji: starterEmoji(taken, taken.length),
            folders: [],
            icon: "",
            instructions: "",
            name,
          }}
          isNew
          onCommit={onCreate}
          onOpenChange={onOpenChange}
          open={open}
          otherNames={otherNames}
          title="New project"
        />
      </Dialog>
    );
  }
  const { onChange, onDelete, project } = props;
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {/* Keyed by the project so opening a different one re-seeds the fields
        rather than showing the last project's name. */}
      <ProjectForm
        action="Save"
        deleting={{ name: project.name, onDelete }}
        description="Changes apply to every chat filed under this project."
        folderName={project.name}
        initial={{
          color: project.color ?? PROJECT_COLORS[8] ?? "#3b6ef6",
          emoji: project.emoji ?? "",
          folders: project.folders ?? [],
          icon: project.icon ?? "",
          instructions: project.instructions ?? "",
          name: project.name,
        }}
        key={project.id}
        onCommit={(chosen) => {
          onChange({
            ...(chosen.color === project.color ? {} : { color: chosen.color }),
            ...(chosen.emoji === (project.emoji ?? "")
              ? {}
              : { emoji: chosen.emoji }),
            ...(samePaths(chosen.folders, project.folders ?? [])
              ? {}
              : { folders: chosen.folders }),
            ...(chosen.icon === (project.icon ?? "")
              ? {}
              : { icon: chosen.icon }),
            ...(chosen.instructions.trim() ===
            (project.instructions ?? "").trim()
              ? {}
              : { instructions: chosen.instructions }),
            ...(chosen.name === project.name ? {} : { name: chosen.name }),
          });
        }}
        onOpenChange={onOpenChange}
        open={open}
        otherNames={otherNames}
        title="Project details"
      />
    </Dialog>
  );
}

/**
 * Why a name cannot be a project's, said under the field, or nothing: a project's
 * name is its folder's, so it cannot hold what a folder name cannot, and no
 * two projects share one. The workspace checks the same again.
 */
function nameProblem(name: string, otherNames: readonly string[]) {
  const trimmed = name.trim();
  if (NOT_IN_A_FOLDER_NAME.test(trimmed)) {
    return `A project name can't contain any of: < > : " / \\ | ? *`;
  }
  if (trimmed.startsWith(".") || trimmed.endsWith(".")) {
    return "A project name can't start or end with a period";
  }
  const taken = otherNames.find(
    (other) => other.toLowerCase() === trimmed.toLowerCase(),
  );
  return taken ? `There is already a project called “${taken}”` : undefined;
}

/** Whether two folder lists name the same paths in the same order. */
function samePaths(a: ProjectFolder[], b: ProjectFolder[]) {
  return (
    a.length === b.length &&
    a.every((folder, index) => folder.path === b[index]?.path)
  );
}

/**
 * The folders the work under a project uses: each one's place, a way to take
 * it off, and a way to add another from the system's own picker. Every chat
 * filed under the project has them attached, so a task can be handed one.
 */
function ProjectFolders({
  folders,
  onChange,
  onOpenFolder,
}: {
  folders: ProjectFolder[];
  onChange: (folders: ProjectFolder[]) => void;
  /** Opens a folder in Files, the dialog closing so the tab shows. */
  onOpenFolder: (path: string) => void;
}) {
  const remove = (folder: ProjectFolder) => {
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
                  onOpenFolder(folder.path);
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
 * Deleting a project, behind a confirmation: the tag goes, and the chats
 * filed under it keep everything else they have.
 */
function DeleteProjectButton({
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
          Delete project
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
 * The offer to file the chats that fit a new project as it is made: one
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

/** The form's fields and how it stands, as one value, so an opening starts all of it over. */
type ProjectFormState = ProjectChoice & {
  /**
   * A new project's mark follows the best fit for its name until one is chosen
   * by hand; an existing project's mark stays what its owner picked.
   */
  follows: boolean;
  /**
   * Off until asked for: filing chats is the person's call, made once, for
   * the whole set the line names.
   */
  isFilingFits: boolean;
  isPicking: boolean;
};

function startForm(initial: ProjectChoice, isNew: boolean): ProjectFormState {
  return { ...initial, follows: isNew, isFilingFits: false, isPicking: false };
}

/**
 * The fields, which start over from `initial` each time the dialog opens: the
 * form stays mounted through the dialog's close, so what was typed into it
 * last time would otherwise be waiting at the next opening.
 */
function ProjectForm({
  action,
  candidates = [],
  deleting,
  description,
  folderName,
  initial,
  isNew = false,
  onCommit,
  onOpenChange,
  open,
  otherNames,
  title,
}: {
  action: string;
  /** Chats to offer filing under the project as it is made; none for a project that exists. */
  candidates?: BackfillCandidate[];
  /** Offered at the foot when the project exists to be deleted: whose name to confirm, and what deleting does. */
  deleting?: { name: string; onDelete: () => void };
  description: string;
  /** The name the project's own folder has on disk, once it has one. */
  folderName?: string;
  initial: ProjectChoice;
  /** A project being made, whose mark follows its name until one is picked by hand. */
  isNew?: boolean;
  onCommit: (
    project: ProjectChoice,
    alsoFile: BackfillCandidate["id"][],
  ) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  otherNames: readonly string[];
  title: string;
}) {
  const [form, setForm] = useState(() => startForm(initial, isNew));
  const {
    color,
    emoji,
    folders,
    follows,
    icon,
    instructions,
    isFilingFits,
    isPicking,
    name,
  } = form;
  const edit = (change: Partial<ProjectFormState>) => {
    setForm((current) => ({ ...current, ...change }));
  };
  const instructionsDictation = useDictatedText({
    onChange: (text) => {
      edit({ instructions: text });
    },
    surface: "project-instructions",
    value: instructions,
  });
  const canDictate = useCanDictate();
  // Saving waits for dictated words, so the instructions keep them.
  const isHolding = isDictating(instructionsDictation.phase);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(startForm(initial, isNew));
    } else {
      // The form outlives the dialog, so a take still recording into the
      // instructions is thrown away rather than left on with no controls.
      instructionsDictation.cancel();
    }
  }
  const fits = useProjectBackfill({ candidates, name, open });
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
    edit({ emoji: best.emoji.unicode });
  }
  const nameField = useRef<HTMLInputElement>(null);
  const workspaceFolder = useWorkspaceFolder();
  const projectFolder =
    folderName !== undefined && workspaceFolder !== undefined
      ? projectFolderPath(workspaceFolder, folderName)
      : undefined;

  // Judged only while open: the project it just made joins the names in use
  // as the dialog animates out, and would be named as taken by itself.
  const problem = open ? nameProblem(name, otherNames) : undefined;
  const commit = () => {
    // A second Enter while the dialog closes would make the project again.
    if (isHolding || !open) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed || problem) {
      return;
    }
    onCommit(
      { color, emoji, folders, icon, instructions, name: trimmed },
      isFilingFits ? fits.map((chat) => chat.id) : [],
    );
    onOpenChange(false);
  };

  return (
    <DialogContent
      className="h-full gap-0 overflow-hidden p-0"
      maxHeight="60rem"
      maxWidth="80rem"
      // The name is what the dialog is for, so the caret starts in it, with
      // the name selected so typing replaces it; the dialog would otherwise
      // put focus on the first control, which is the mark.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        nameField.current?.focus();
        nameField.current?.select();
      }}
    >
      <DialogTitle className="sr-only">{title}</DialogTitle>
      {/* Side by side, each scrolling alone: the project down the left, its
        instructions taking the rest, as wide as a page reads. Stacked when
        the dialog is too narrow for both, which goes by its own width since
        zoom and the window's size both decide it. */}
      <div className="@container/project-dialog size-full min-h-0">
        <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,2fr)_minmax(0,3fr)] @3xl/project-dialog:grid-cols-[22rem_minmax(0,1fr)] @3xl/project-dialog:grid-rows-1">
          <div className="flex min-h-0 min-w-0 flex-col gap-5 overflow-y-auto border-b bg-muted/30 p-6 @3xl/project-dialog:border-r @3xl/project-dialog:border-b-0">
            <ProjectMarkPicker
              context={name}
              icon={icon || undefined}
              onEmoji={(picked) => {
                edit({ emoji: picked, follows: false, icon: "" });
              }}
              onIcon={(picked) => {
                edit({ emoji: "", follows: false, icon: picked });
              }}
              onOpenChange={(next) => {
                edit({ isPicking: next });
              }}
              open={isPicking}
            >
              <button
                aria-label="Choose a mark"
                className="group/mark relative w-fit shrink-0 rounded-2xl"
                type="button"
              >
                <ProjectMark
                  // A changed mark fades in where it stands, so one that follows
                  // the name reads as an answer arriving rather than a flicker.
                  className="size-16 animate-in rounded-2xl text-[32px] duration-300 fade-in-0 zoom-in-90 group-hover/mark:opacity-80"
                  key={icon || emoji}
                  size="lg"
                  project={{ color, emoji, icon, name }}
                />
                <span className="absolute -right-1.5 -bottom-1.5 grid size-6 place-items-center rounded-full border bg-background text-muted-foreground shadow-xs">
                  <PencilSimpleIcon className="size-3" />
                </span>
              </button>
            </ProjectMarkPicker>
            <div>
              <Input
                aria-label="Name"
                className="h-11 text-lg font-semibold md:text-lg"
                maxLength={PROJECT_NAME_MAX}
                onChange={(event) => {
                  edit({ name: event.target.value });
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
              {problem && (
                <p className="pt-2 text-xs text-destructive">{problem}</p>
              )}
              <DialogDescription className="pt-2 text-xs">
                {description}
              </DialogDescription>
            </div>
            {fits.length > 0 && (
              <FitsLine
                checked={isFilingFits}
                fits={fits}
                name={name.trim()}
                onCheckedChange={(next) => {
                  edit({ isFilingFits: next });
                }}
              />
            )}
            <ColorRow
              onPick={(next) => {
                edit({ color: next });
              }}
              value={color}
            />
            <ProjectFolders
              folders={folders}
              onChange={(next) => {
                edit({ folders: next });
              }}
              onOpenFolder={(path) => {
                onOpenChange(false);
                void showInFolder(path, { kind: "folder" });
              }}
            />
            {projectFolder !== undefined && (
              <ProjectOwnFolder
                onOpenInFiles={() => {
                  onOpenChange(false);
                  void showProjectInFiles({ name: folderName ?? name });
                }}
                path={projectFolder}
              />
            )}
            {deleting && (
              <div className="mt-auto -ml-3 pt-2">
                <DeleteProjectButton
                  name={deleting.name}
                  onDelete={() => {
                    deleting.onDelete();
                    onOpenChange(false);
                  }}
                />
              </div>
            )}
          </div>
          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="shrink-0 border-b py-4 pr-14 pl-8">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold" id="project-instructions">
                  Instructions
                </h3>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {PROJECT_FILE_NAME}
                </code>
              </div>
              <p className="pt-0.5 text-xs text-muted-foreground">
                {name.trim()
                  ? `Every chat in “${name.trim()}” starts with these.`
                  : "Every chat in this project starts with these."}
              </p>
            </div>
            <div className="relative min-h-0 flex-1 overflow-y-auto">
              <MarkdownValueEditor
                className="mx-auto max-w-2xl pt-6 pr-8 pb-24 pl-14"
                label="Instructions"
                onChange={(next) => {
                  edit({ instructions: next });
                }}
                placeholder={`What ${APP_NAME} should know or do in every chat filed here`}
                value={instructions}
              />
              {(canDictate || isHolding) && (
                <div className="pointer-events-none sticky bottom-3 flex items-center justify-end gap-2 px-4 [&>*]:pointer-events-auto">
                  <DictationReadout
                    className="max-w-md rounded-full bg-background/95 px-3 py-1 shadow-xs"
                    dictation={instructionsDictation}
                  />
                  <DictationControls
                    className="rounded-full bg-background/95 p-0.5 shadow-xs"
                    dictation={instructionsDictation}
                    size="sm"
                  />
                </div>
              )}
            </div>
            <DialogFooter className="shrink-0 border-t px-6 py-4">
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
            </DialogFooter>
          </div>
        </div>
      </div>
    </DialogContent>
  );
}

/**
 * The project's own folder, where its instructions are kept as a file, with
 * the way into it in Files.
 */
function ProjectOwnFolder({
  onOpenInFiles,
  path,
}: {
  onOpenInFiles: () => void;
  path: string;
}) {
  return (
    <div className="min-w-0">
      <p className="pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        Project folder
      </p>
      <div className="overflow-hidden rounded-lg border bg-background">
        <FolderRow
          className="gap-1 py-2 pr-1.5 pl-1"
          note="Its instructions are saved here, along with anything else you keep for it."
          onOpen={onOpenInFiles}
          path={path}
        />
        <Button
          className="w-full rounded-none border-t"
          onClick={onOpenInFiles}
          variant="ghost"
        >
          Open in Files
          <ArrowUpRightIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
