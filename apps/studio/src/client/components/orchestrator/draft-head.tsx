import { featuresAtom } from "@/client/atoms/features";
import {
  type Draft,
  type DraftFile,
  draftFilesAtom,
} from "@/client/atoms/orchestrator";
import { AttachedFilePreview } from "@/client/components/attached-file-preview";
import {
  type ComposerAction,
  ComposerAddMenu,
  type ComposerMenuView,
} from "@/client/components/composer-add-menu";
import { FileDropRegion } from "@/client/components/file-drop-region";
import {
  PromptEditor,
  type PromptEditorRef,
} from "@/client/components/prompt-editor";
import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Spinner } from "@/client/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { type DroppedFolder } from "@/client/hooks/use-file-drop-region";
import { shouldAttachClipboardItem } from "@/client/lib/paste-clipboard";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { skillMentionToken } from "@instrument-org/shared/skill-mention";
import { safe } from "@orpc/client";
import { ArrowsInSimpleIcon } from "@phosphor-icons/react/ArrowsInSimple";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { MinusIcon } from "@phosphor-icons/react/Minus";
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { ulid } from "ulid";

import { useOrchestrator } from "./context";
import { fileHref, folderHref } from "./file-tabs";
import { TopicPill } from "./thread-row";
import { type Topic } from "./threads";
import { TopicPickList } from "./topic-menu";

/** Past this size an image is not read in for a preview. */
const MAX_PREVIEW_SIZE = 10 * 1024 * 1024;

/**
 * A draft put away to the bottom edge: its first words, and the ways to
 * take it up again or throw it away. A click on the words takes it up.
 */
export function DraftBar({
  draft,
  onClose,
  onOpen,
}: {
  draft: Draft | undefined;
  onClose: () => void;
  onOpen: () => void;
}) {
  if (!draft) {
    return null;
  }
  return (
    <div
      aria-label="New thread"
      className="absolute right-4 bottom-0 z-30 flex h-9 w-72 items-center gap-1 rounded-t-lg border border-b-0 border-border bg-card pr-1 pl-3 shadow-lg"
      role="region"
    >
      <button
        className="flex h-full min-w-0 flex-1 items-center gap-2 text-left text-sm"
        onClick={onOpen}
        type="button"
      >
        <PencilSimpleIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          {firstLineOf(draft.words) || "New thread"}
        </span>
      </button>
      <HeadControl label="Open" onClick={onOpen}>
        <ArrowsOutSimpleIcon className="size-3.5" />
      </HeadControl>
      <HeadControl label="Close" onClick={onClose}>
        <XIcon className="size-3.5" />
      </HeadControl>
    </div>
  );
}

/**
 * The head of the right area while a draft is up: the draft's words over
 * its tabs, with the topic it will be filed under at the top left and the
 * action at the top right, and beside the words the files read in from
 * bytes as tiles. A file dropped here that has a place on disk opens as a
 * tab of the draft's, the way a site or a folder does; one that has none is
 * read in and goes with the words. The action is the prompt box's round
 * brand arrow with no word on it, since the right word for starting a
 * thread is still to be found. The controls at the head's end shrink the
 * draft to a bar, spread it across the window, or put it away.
 */
export function DraftHead({
  draft,
  isExpanded,
  isStarting,
  onChange,
  onClose,
  onExpand,
  onMinimize,
  onStart,
  topics,
}: {
  draft: Draft | undefined;
  isExpanded: boolean;
  isStarting: boolean;
  onChange: (update: (draft: Draft) => Draft) => void;
  onClose: () => void;
  onExpand: (expanded: boolean) => void;
  onMinimize: () => void;
  onStart: () => void;
  topics: Topic[];
}) {
  const { openScreen } = useOrchestrator();
  const features = useAtomValue(featuresAtom);
  const skills = useQuery(
    rpcClient.workspace.skill.list.queryOptions({ enabled: features.skills }),
  );
  const userInvocableSkills = features.skills
    ? (skills.data ?? []).filter((skill) => skill.userInvocable)
    : [];
  const [filesByDraft, setFilesByDraft] = useAtom(draftFilesAtom);
  const [bounds, setBounds] = useState<HTMLElement | null>(null);
  const [menuView, setMenuView] = useState<ComposerMenuView | null>(null);
  const editorRef = useRef<PromptEditorRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  if (!draft) {
    return null;
  }
  const files = filesByDraft[draft.id] ?? [];
  const topic = topics.find((entry) => entry.id === draft.topicId);
  const canStart =
    !isStarting && (draft.words.trim().length > 0 || files.length > 0);

  /** Files handed over: those with a place on disk open as tabs; the rest are read in and ride with the words. */
  const addFiles = (dropped: File[] | FileList) => {
    for (const file of dropped) {
      const path = window.api.getFilePath(file).trim();
      if (path) {
        openScreen(fileHref(path), { newTab: true });
        continue;
      }
      void readFile(file).then((read) => {
        setFilesByDraft((current) => ({
          ...current,
          [draft.id]: [...(current[draft.id] ?? []), read],
        }));
      });
    }
  };
  /** Folders handed over: each opens as a tab standing in it. */
  const addFolders = (folders: DroppedFolder[]) => {
    for (const folder of folders) {
      openScreen(folderHref(folder.path), { newTab: true });
    }
  };
  const pickFiles = () => {
    fileInputRef.current?.click();
  };
  const pickFolder = async () => {
    const [error, result] = await safe(
      rpcClient.utils.showFolderPicker.call({}),
    );
    if (error) {
      toast.error("Failed to open folder picker");
      return;
    }
    if (result) {
      addFolders([{ path: result.path, type: "folder" }]);
    }
  };
  /** A paste of files (a screenshot, say) is read in the way a drop with no path is; text is the editor's. */
  const handlePaste = (event: ClipboardEvent) => {
    const data = event.clipboardData;
    if (!data) {
      return false;
    }
    const hasText = data.getData("text/plain").trim().length > 0;
    const pasted: File[] = [];
    for (const item of data.items) {
      if (!shouldAttachClipboardItem({ hasText, item })) {
        continue;
      }
      const file = item.getAsFile();
      if (file) {
        pasted.push(file);
      }
    }
    if (pasted.length === 0) {
      return false;
    }
    event.preventDefault();
    addFiles(pasted);
    return true;
  };
  const actions: ComposerAction[] = [
    {
      icon: PaperclipIcon,
      id: "add-files",
      label: "Add files",
      onSelect: pickFiles,
    },
    {
      icon: FolderIcon,
      id: "work-in-folder",
      label: "Work in a local folder",
      onSelect: () => {
        void pickFolder();
      },
    },
  ];

  return (
    <FileDropRegion
      className="flex shrink-0 flex-col"
      note="Drop to add to the draft"
      onFilesDropped={addFiles}
      onFoldersDropped={addFolders}
    >
    <section
      aria-label="New thread"
      className="flex shrink-0 flex-col border-b border-border bg-background"
      ref={setBounds}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/40 pr-1 pl-3">
        <PencilSimpleIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          New thread
        </span>
        <HeadControl label="Minimize" onClick={onMinimize}>
          <MinusIcon className="size-3.5" />
        </HeadControl>
        <HeadControl
          label={isExpanded ? "Shrink" : "Expand"}
          onClick={() => {
            onExpand(!isExpanded);
          }}
        >
          {isExpanded ? (
            <ArrowsInSimpleIcon className="size-3.5" />
          ) : (
            <ArrowsOutSimpleIcon className="size-3.5" />
          )}
        </HeadControl>
        <HeadControl label="Close" onClick={onClose}>
          <XIcon className="size-3.5" />
        </HeadControl>
      </div>
      <div className={cn("flex flex-col px-4 pt-3 pb-3", isExpanded && "px-8")}>
        <div className="flex shrink-0 items-center justify-between gap-2">
          <TopicSlot
            onPick={(topicId) => {
              onChange((current) => ({ ...current, topicId }));
            }}
            topic={topic}
            topics={topics}
          />
          <Button
            aria-label="Start the thread"
            className="size-8 shrink-0 rounded-full p-0 disabled:opacity-100"
            disabled={!canStart}
            onClick={onStart}
            variant="brand"
          >
            {isStarting ? (
              <Spinner className="size-4" />
            ) : (
              <ArrowUpIcon className="size-4" />
            )}
          </Button>
        </div>
        {/* Room for a paragraph before the words scroll: the head is where
          the ask is written, and the tabs under it are what it is about. */}
        <div
          className={cn(
            "mt-2 min-h-0 overflow-y-auto text-sm",
            isExpanded ? "max-h-96 min-h-40" : "max-h-64 min-h-28",
          )}
        >
          <PromptEditor
            actions={actions}
            autoFocus
            bounds={bounds}
            defaultValue={draft.words}
            disabled={isStarting}
            key={draft.id}
            onChange={(words) => {
              onChange((current) => ({ ...current, words }));
            }}
            onPaste={handlePaste}
            onSubmit={() => {
              if (canStart) {
                onStart();
              }
            }}
            placeholder="What do you need?"
            ref={editorRef}
            skills={userInvocableSkills}
          />
        </div>
        {/* The foot of the head, where a composer keeps its attachments: the
          plus, with what can be gathered (files, a folder, and the skills
          the words can call), and beside it the files read in for the
          draft. Always here, so adding more is one place to find. */}
        <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2">
          <ComposerAddMenu
            actions={actions}
            bounds={bounds}
            disabled={isStarting}
            onReturnFocus={() => {
              editorRef.current?.focus();
            }}
            onSelectSkill={(skill) => {
              editorRef.current?.insertText(skillMentionToken(skill.id));
            }}
            onViewChange={setMenuView}
            skills={userInvocableSkills}
            triggerClassName="size-7 rounded-full [&_svg]:size-4"
            view={menuView}
          />
          {files.map((file) => (
            <AttachedFilePreview
              filename={file.name}
              key={file.id}
              mimeType={file.mimeType}
              onRemove={() => {
                setFilesByDraft((current) => ({
                  ...current,
                  [draft.id]: (current[draft.id] ?? []).filter(
                    (entry) => entry.id !== file.id,
                  ),
                }));
              }}
              size={file.size}
              url={file.url}
            />
          ))}
        </div>
      </div>
      <input
        className="hidden"
        multiple
        onChange={(event) => {
          if (event.target.files) {
            addFiles(event.target.files);
          }
          event.target.value = "";
        }}
        ref={fileInputRef}
        type="file"
      />
    </section>
    </FileDropRegion>
  );
}

/** The first line of the words, which is how a draft is named while it is a bar. */
function firstLineOf(words: string): string {
  return (
    words
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? ""
  );
}

/** One of the head's controls: a small tile in the window's own type. */
function HeadControl({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={onClick}
          type="button"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** A file read in for the draft: its bytes, and a preview when it is an image small enough for one. */
async function readFile(file: File): Promise<DraftFile> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Could not read the file"));
    });
    reader.readAsDataURL(file);
  });
  const wantsPreview =
    file.type.startsWith("image/") && file.size <= MAX_PREVIEW_SIZE;
  return {
    content: url.split(",")[1] ?? "",
    id: ulid(),
    mimeType: file.type,
    name: file.name,
    size: file.size,
    ...(wantsPreview ? { url } : {}),
  };
}

/**
 * The topic the thread will be filed under, at the head's left: a dashed
 * slot until one is chosen, then the topic's pill. Either opens the list of
 * topics, where choosing the same one again takes it off.
 */
function TopicSlot({
  onPick,
  topic,
  topics,
}: {
  onPick: (topicId: string | undefined) => void;
  topic: Topic | undefined;
  topics: Topic[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        {/* The pill stops its click short of the trigger and opens the list
          itself, so either face of the slot lands in the same list. */}
        <span className="inline-flex">
          {topic ? (
            <TopicPill
              onPick={() => {
                setOpen(true);
              }}
              topic={topic}
            />
          ) : (
            <button
              className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-border px-2 text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              type="button"
            >
              <PlusIcon className="size-3" />
              topic
            </button>
          )}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-60 p-1"
        role="menu"
        side="bottom"
        sideOffset={4}
      >
        <TopicPickList
          chosen={new Set(topic ? [topic.id] : [])}
          onNew={() => {
            setOpen(false);
          }}
          onToggle={(id) => {
            onPick(id === topic?.id ? undefined : id);
            setOpen(false);
          }}
          topics={topics}
        />
      </PopoverContent>
    </Popover>
  );
}
