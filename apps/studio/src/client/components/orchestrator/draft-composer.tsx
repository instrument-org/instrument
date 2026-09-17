import { featuresAtom } from "@/client/atoms/features";
import { type Draft, type DraftFile } from "@/client/atoms/orchestrator";
import { type ComposerAction } from "@/client/components/composer-add-menu";
import { FileIcon } from "@/client/components/file-icon";
import { FileViewer } from "@/client/components/file-viewer";
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
import { getComputerFileUrl } from "@/client/lib/computer-file-url";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { formatBytes } from "@instrument-org/workspace/client";
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp";
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type DragEvent, useRef, useState } from "react";
import { ulid } from "ulid";

import { TabStrip } from "./tab-strip";
import { TopicPill } from "./thread-row";
import { type Topic } from "./threads";
import { TopicPickList } from "./topic-menu";

/** Past this size an image is pointed at rather than read in for its preview. */
const MAX_PREVIEW_SIZE = 10 * 1024 * 1024;

/** How the draft is changed: by an update over the draft as it stands, since files arrive one at a time and later. */
export type DraftUpdate = (update: (draft: Draft) => Draft) => void;

/**
 * The draft's body, the same in the window at the corner and in the modal
 * over the window: its corners first, the topic it will be filed under at
 * the top left and the action at the top right, then the words as the head
 * of it all, and under the words everything gathered so far as a row of
 * tabs, the one that is up shown in full beneath them, the way the thread's
 * tabs will show it once the draft starts. A file dropped anywhere on it
 * lands in that row and comes up. The action has no word on it: the right
 * one for starting a thread is still to be found.
 */
export function DraftComposer({
  draft,
  isStarting,
  onChange,
  onNewTopic,
  onStart,
  size,
  topics,
}: {
  draft: Draft;
  isStarting: boolean;
  onChange: DraftUpdate;
  onNewTopic: () => void;
  onStart: () => void;
  /** Whether the body has a window's room or the modal's. */
  size: "modal" | "window";
  topics: Topic[];
}) {
  const features = useAtomValue(featuresAtom);
  const skills = useQuery(
    rpcClient.workspace.skill.list.queryOptions({ enabled: features.skills }),
  );
  const userInvocableSkills = features.skills
    ? (skills.data ?? []).filter((skill) => skill.userInvocable)
    : [];
  const [bounds, setBounds] = useState<HTMLElement | null>(null);
  const editorRef = useRef<PromptEditorRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const topic = topics.find((entry) => entry.id === draft.topicId);
  const canStart =
    !isStarting && (draft.words.trim().length > 0 || draft.files.length > 0);
  const shown =
    draft.files.find((file) => file.id === draft.shownFileId) ??
    draft.files.at(-1);

  const addFiles = (files: File[] | FileList) => {
    for (const file of files) {
      void readFile(file).then((read) => {
        // The newest comes up, the way a tab just opened is the one shown.
        onChange((current) => ({
          ...current,
          files: [...current.files, read],
          shownFileId: read.id,
        }));
      });
    }
  };
  const removeFile = (id: string) => {
    onChange((current) => {
      const at = current.files.findIndex((file) => file.id === id);
      const files = current.files.filter((file) => file.id !== id);
      const neighbor = files[Math.max(0, at - 1)];
      return {
        ...current,
        files,
        shownFileId:
          current.shownFileId === id ? neighbor?.id : current.shownFileId,
      };
    });
  };
  const pickFiles = () => {
    fileInputRef.current?.click();
  };
  const actions: ComposerAction[] = [
    {
      icon: PaperclipIcon,
      id: "add-files",
      label: "Add files",
      onSelect: pickFiles,
    },
  ];
  const hasFiles = draft.files.length > 0;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        size === "modal" ? "px-6 pt-4 pb-6" : "p-3",
      )}
      onDragOver={(event: DragEvent) => {
        event.preventDefault();
      }}
      onDrop={(event: DragEvent) => {
        event.preventDefault();
        addFiles(event.dataTransfer.files);
      }}
      ref={setBounds}
    >
      <div className="flex shrink-0 items-center justify-between gap-2">
        <TopicSlot
          onNewTopic={onNewTopic}
          onPick={(topicId) => {
            onChange((current) => ({ ...current, topicId }));
          }}
          topic={topic}
          topics={topics}
        />
        {/* The same round brand arrow the prompt box sends with. */}
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
      {/* The words take the room while nothing is attached; once something
        is, they keep a head's worth and the attachment gets the rest. */}
      <div
        className={cn(
          "mt-2 min-h-0 overflow-y-auto text-sm",
          hasFiles
            ? size === "modal"
              ? "max-h-52 shrink-0"
              : "max-h-32 shrink-0"
            : "flex-1",
          size === "modal" ? "min-h-24" : "min-h-20",
        )}
      >
        <PromptEditor
          actions={actions}
          autoFocus
          bounds={bounds}
          defaultValue={draft.words}
          disabled={isStarting}
          onChange={(words) => {
            onChange((current) => ({ ...current, words }));
          }}
          onPaste={() => false}
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
      {hasFiles ? (
        <div className="mt-2 flex min-h-0 flex-1 flex-col border-t border-border">
          <div className="flex h-9 shrink-0 items-center">
            <TabStrip
              className="min-w-0 flex-1"
              groupKey="draft"
              onClose={removeFile}
              onNew={pickFiles}
              onReorder={(keys) => {
                onChange((current) => ({
                  ...current,
                  files: keys.flatMap((key) => {
                    const file = current.files.find(
                      (entry) => entry.id === key,
                    );
                    return file ? [file] : [];
                  }),
                }));
              }}
              onSelect={(key) => {
                onChange((current) => ({ ...current, shownFileId: key }));
              }}
              selectedKey={shown?.id}
              tabs={draft.files.map((file) => ({
                icon: <FileIcon className="size-4" filename={file.name} />,
                key: file.id,
                title: file.name,
              }))}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-muted/30">
            {shown && <Shown file={shown} key={shown.id} />}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex shrink-0 items-center gap-2 border-t border-border pt-3">
          <button
            aria-label="Add files"
            className="grid size-8 shrink-0 place-items-center rounded-md border border-dashed border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            onClick={pickFiles}
            type="button"
          >
            <PlusIcon className="size-4" />
          </button>
          <span className="text-xs text-muted-foreground">
            Nothing attached yet. Drop files here, or add them: they open as
            tabs of the thread.
          </span>
        </div>
      )}
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
    </div>
  );
}

/**
 * A dropped or chosen file as the draft holds it: pointed at where it sits
 * when the drop said, read in otherwise, and read in either way for an
 * image small enough to preview.
 */
async function readFile(file: File): Promise<DraftFile> {
  const path = window.api.getFilePath(file).trim();
  const wantsPreview =
    file.type.startsWith("image/") && file.size <= MAX_PREVIEW_SIZE;
  const base = {
    id: ulid(),
    mimeType: file.type,
    name: file.name,
    size: file.size,
  };
  if (path && !wantsPreview) {
    return { ...base, path };
  }
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
  return path
    ? { ...base, path, url }
    : { ...base, content: url.split(",")[1] ?? "", url };
}

/**
 * The attachment whose tab is up, in full: the file viewer over its place on
 * this computer when it has one, the way the thread's tab will show it; an
 * image read in as itself; and anything else read in as its name and size,
 * since its bytes are with the draft rather than at a place a viewer can
 * open.
 */
function Shown({ file }: { file: DraftFile }) {
  if (file.path) {
    return (
      <FileViewer
        className="h-full"
        file={{
          filename: file.name,
          hostPath: file.path,
          mimeType: file.mimeType,
          url: getComputerFileUrl({ hostPath: file.path }),
        }}
      />
    );
  }
  if (file.url && file.mimeType.startsWith("image/")) {
    return (
      <div className="grid h-full place-items-center overflow-auto p-3">
        <img
          alt={file.name}
          className="max-h-full max-w-full object-contain"
          src={file.url}
        />
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <FileIcon className="size-8 text-muted-foreground" filename={file.name} />
      <p className="text-sm">{file.name}</p>
      <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
    </div>
  );
}

/**
 * The topic the thread will be filed under, at the head's left: a dashed
 * slot until one is chosen, then the topic's pill. Either opens the list of
 * topics, where choosing the same one again takes it off.
 */
function TopicSlot({
  onNewTopic,
  onPick,
  topic,
  topics,
}: {
  onNewTopic: () => void;
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
            onNewTopic();
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
