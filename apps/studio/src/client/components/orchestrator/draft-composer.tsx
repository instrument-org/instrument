import { featuresAtom } from "@/client/atoms/features";
import { type Draft, type DraftFile } from "@/client/atoms/orchestrator";
import { AttachedFilePreview } from "@/client/components/attached-file-preview";
import { type ComposerAction } from "@/client/components/composer-add-menu";
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
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp";
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type DragEvent, useRef, useState } from "react";
import { ulid } from "ulid";

import { TopicPill } from "./thread-row";
import { type Topic } from "./threads";
import { TopicPickList } from "./topic-menu";

/** Past this size an image is pointed at rather than read in for its preview. */
const MAX_PREVIEW_SIZE = 10 * 1024 * 1024;

/** How the draft's words are changed: by an update over the draft as it stands, since files arrive one at a time and later. */
export type DraftUpdate = (update: (draft: Draft) => Draft) => void;

/**
 * The draft's body, the same in the window at the corner and across the
 * right area: its corners first, the topic it will be filed under at the top
 * left and the action at the top right, then the words as the head of it
 * all, and under the words the files gathered so far as a row with the way
 * to add one among them. A file dropped anywhere on it lands in that row.
 * The action's word is a stand-in until the right one is found; it is never
 * Send, since what it does is start a thread.
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
  /** Whether the body has a window's room or the whole right area's. */
  size: "pane" | "window";
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

  const addFiles = (files: File[] | FileList) => {
    for (const file of files) {
      void readFile(file).then((read) => {
        onChange((current) => ({
          ...current,
          files: [...current.files, read],
        }));
      });
    }
  };
  const actions: ComposerAction[] = [
    {
      icon: PaperclipIcon,
      id: "add-files",
      label: "Add files",
      onSelect: () => {
        fileInputRef.current?.click();
      },
    },
  ];

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        size === "pane" ? "px-6 pt-4 pb-6" : "p-3",
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
        {/* The same round brand arrow the prompt box sends with, and no
          word on it: the right word for starting a thread is still to be
          found, and a word learned here would have to be unlearned. */}
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
      <div
        className={cn(
          "mt-2 min-h-0 flex-1 overflow-y-auto text-sm",
          size === "pane" ? "min-h-40" : "min-h-28",
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
      <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-3">
        {draft.files.map((file) => (
          <AttachedFilePreview
            filename={file.name}
            key={file.id}
            mimeType={file.mimeType}
            onRemove={() => {
              onChange((current) => ({
                ...current,
                files: current.files.filter((entry) => entry.id !== file.id),
              }));
            }}
            size={file.size}
            url={file.url}
          />
        ))}
        <button
          aria-label="Add files"
          className="grid size-8 shrink-0 place-items-center rounded-md border border-dashed border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
          onClick={() => {
            fileInputRef.current?.click();
          }}
          type="button"
        >
          <PlusIcon className="size-4" />
        </button>
        {draft.files.length === 0 && (
          <span className="text-xs text-muted-foreground">
            Files go with the words: drop them here, or add them.
          </span>
        )}
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
