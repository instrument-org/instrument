import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { DEFAULT_FOLDER_ACCESS } from "@/client/components/folder-access-list";
import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import { BackButton } from "@/client/components/overlay/back-button";
import { OverlayFooter } from "@/client/components/overlay/footer";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/client/components/ui/command";
import { rpcClient } from "@/client/rpc/client";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { APP_NAME } from "@instrument-org/shared";
import {
  type FileUpload,
  type FolderAttachment,
  type ProjectId,
} from "@instrument-org/workspace/client";
import uFuzzy from "@leeoniya/ufuzzy";
import { safe } from "@orpc/client";
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp";
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { CirclesThreeIcon } from "@phosphor-icons/react/CirclesThree";
import { FileIcon } from "@phosphor-icons/react/File";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { noop } from "radashi";
import { useRef, useState } from "react";
import { toast } from "sonner";

/** Everything the task will be created from, gathered across the steps. */
export interface ComposeDraft {
  files: FileUpload.Input[];
  folders: { access: FolderAttachment.Access; path: string }[];
  modelURI: AIGatewayModelURI.Type | undefined;
  projectId: null | ProjectId;
  prompt: string;
}

export type ComposeStep = "files" | "folders" | "model" | "options" | "project";

const fuzzy = new uFuzzy({ intraMode: 1 });

const basename = (path: string) => path.split("/").findLast(Boolean) ?? path;

/**
 * Attaching, and what has been attached, on one screen.
 *
 * The native dialog takes focus and gives it back. Nothing here closes when it
 * does, because the draft lives above this component rather than in something
 * modal -- which is the whole reason the picker is a screen and not a sheet.
 */
export function FilesStep({
  files,
  onBack,
  onChange,
}: {
  files: FileUpload.Input[];
  onBack: () => void;
  onChange: (files: FileUpload.Input[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState("action:choose-files");

  const addFiles = (picked: FileList | null) => {
    if (!picked) {
      return;
    }
    const next: FileUpload.Input[] = [];
    for (const file of picked) {
      const path = window.api.getFilePath(file);
      if (!path.trim()) {
        toast.error(`Could not read ${file.name}`);
        continue;
      }
      next.push({
        filename: file.name,
        mimeType: file.type,
        path,
        size: file.size,
      });
    }
    onChange([...files, ...next]);
  };

  return (
    <Command
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(event) => {
        // Enter means the same thing on every screen in this panel, so removing
        // is its own key rather than a second meaning for that one.
        if (event.key !== "Backspace" && event.key !== "Delete") {
          return;
        }
        const index = Number(selected.split(":")[1]);
        if (!selected.startsWith("file:") || Number.isNaN(index)) {
          return;
        }
        event.preventDefault();
        onChange(files.filter((_, i) => i !== index));
      }}
      onValueChange={setSelected}
      shouldFilter={false}
      value={selected}
    >
      <StepHeader onBack={onBack} placeholder="Files" value="" />
      <CommandList className="max-h-none min-h-0 flex-1">
        <CommandGroup>
          <CommandItem
            onSelect={() => {
              inputRef.current?.click();
            }}
            value="action:choose-files"
          >
            <PlusIcon className="size-4 opacity-50" />
            <span className="min-w-0 flex-1 truncate">Choose files…</span>
          </CommandItem>
        </CommandGroup>
        {files.length > 0 && (
          <CommandGroup heading="Attached">
            {files.map((file, index) => (
              <CommandItem
                key={`${file.filename}:${index}`}
                onSelect={noop}
                value={`file:${index}`}
              >
                <FileIcon className="size-4 opacity-50" />
                <span className="min-w-0 flex-1 truncate">{file.filename}</span>
                <button
                  aria-label={`Remove ${file.filename}`}
                  className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    onChange(files.filter((_, i) => i !== index));
                  }}
                  type="button"
                >
                  <XIcon className="size-3.5" />
                </button>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <OverlayFooter
        hints={[
          { keys: ["↵"], label: "Choose" },
          { keys: ["⌫"], label: "Remove" },
        ]}
      />
      <input
        className="hidden"
        multiple
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = "";
        }}
        ref={inputRef}
        type="file"
      />
    </Command>
  );
}

export function FoldersStep({
  folders,
  onBack,
  onChange,
}: {
  folders: { access: FolderAttachment.Access; path: string }[];
  onBack: () => void;
  onChange: (
    folders: { access: FolderAttachment.Access; path: string }[],
  ) => void;
}) {
  const [selected, setSelected] = useState("action:choose-folder");

  const pickFolder = async () => {
    const [error, result] = await safe(
      rpcClient.utils.showFolderPicker.call({}),
    );
    if (error) {
      toast.error("Failed to open folder picker");
      return;
    }
    if (!result) {
      return;
    }
    if (folders.some((folder) => folder.path === result.path)) {
      toast.info("That folder is already attached");
      return;
    }
    onChange([
      ...folders,
      { access: DEFAULT_FOLDER_ACCESS, path: result.path },
    ]);
  };

  return (
    <Command
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(event) => {
        if (event.key !== "Backspace" && event.key !== "Delete") {
          return;
        }
        const index = Number(selected.split(":")[1]);
        if (!selected.startsWith("folder:") || Number.isNaN(index)) {
          return;
        }
        event.preventDefault();
        onChange(folders.filter((_, i) => i !== index));
      }}
      onValueChange={setSelected}
      shouldFilter={false}
      value={selected}
    >
      <StepHeader onBack={onBack} placeholder="Work in folder" value="" />
      <CommandList className="max-h-none min-h-0 flex-1">
        <CommandGroup>
          <CommandItem
            onSelect={() => {
              void pickFolder();
            }}
            value="action:choose-folder"
          >
            <PlusIcon className="size-4 opacity-50" />
            <span className="min-w-0 flex-1 truncate">Choose a folder…</span>
          </CommandItem>
        </CommandGroup>
        {folders.length > 0 && (
          <CommandGroup heading="Working in">
            {folders.map((folder, index) => (
              <CommandItem
                key={folder.path}
                onSelect={noop}
                value={`folder:${index}`}
              >
                <FolderSimpleIcon className="size-4 opacity-50" />
                <span className="min-w-0 flex-1 truncate">
                  {basename(folder.path)}
                </span>
                <button
                  aria-label={`Remove ${basename(folder.path)}`}
                  className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    onChange(folders.filter((_, i) => i !== index));
                  }}
                  type="button"
                >
                  <XIcon className="size-3.5" />
                </button>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <OverlayFooter
        hints={[
          { keys: ["↵"], label: "Choose" },
          { keys: ["⌫"], label: "Remove" },
        ]}
      />
    </Command>
  );
}

export function ModelStep({
  onBack,
  onPick,
  selectedURI,
}: {
  onBack: () => void;
  onPick: (uri: AIGatewayModelURI.Type) => void;
  selectedURI: AIGatewayModelURI.Type | undefined;
}) {
  const [search, setSearch] = useState("");
  const { data: modelsData, isLoading } = useQuery(
    rpcClient.gateway.models.live.list.experimental_liveOptions(),
  );

  // The same matcher and the same highlight the launcher uses, so a search
  // behaves identically wherever you do it.
  const models = (() => {
    const all = modelsData?.models ?? [];
    const query = search.trim();
    if (!query) {
      // The one in use first, so opening the picker starts where you already
      // are rather than wherever the provider happened to list.
      const current = all.filter((model) => model.uri === selectedURI);
      const rest = all.filter((model) => model.uri !== selectedURI);
      return [...current, ...rest].map((model) => ({ model, ranges: null }));
    }
    const haystack = all.map((model) => model.name);
    // eslint-disable-next-line unicorn/no-array-method-this-argument
    const indexes = fuzzy.filter(haystack, query);
    if (!indexes?.length) {
      return [];
    }
    const info = fuzzy.info(indexes, haystack, query);
    return fuzzy
      .sort(info, haystack, query)
      .map((i) => {
        const index = info.idx[i];
        const model = index === undefined ? undefined : all[index];
        return model ? { model, ranges: info.ranges[i] ?? null } : undefined;
      })
      .filter((entry) => entry !== undefined);
  })();

  return (
    <Command className="flex h-full min-h-0 flex-col" shouldFilter={false}>
      <StepHeader
        onBack={onBack}
        onValueChange={setSearch}
        placeholder="Search models…"
        value={search}
      />
      <CommandList className="max-h-none min-h-0 flex-1">
        <CommandEmpty>{isLoading ? "Loading…" : "No models."}</CommandEmpty>
        <CommandGroup>
          {models.map(({ model, ranges }) => (
            <CommandItem
              key={model.uri}
              onSelect={() => {
                onPick(model.uri);
              }}
              value={`model:${model.uri.toLowerCase()}`}
            >
              <AIProviderIcon className="size-4" type={model.params.provider} />
              <span className="min-w-0 flex-1 truncate">
                <FuzzyHighlight ranges={ranges} text={model.name.trim()} />
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {model.providerName}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      <OverlayFooter hints={[{ keys: ["↵"], label: "Use this model" }]} />
    </Command>
  );
}

/**
 * The step between typing and sending.
 *
 * Deliberately not a form to fill in order: "Start task" is the first row and
 * selected on arrival, so Enter twice from the launcher sends on the defaults
 * and everything under it is skippable. Typing here edits the prompt, so
 * arriving is not a commitment to the words you came with.
 */
export function OptionsStep({
  draft,
  fallbackModelURI,
  isCreating,
  onBack,
  onOpenStep,
  onPromptChange,
  onStartTask,
}: {
  draft: ComposeDraft;
  fallbackModelURI: AIGatewayModelURI.Type | undefined;
  isCreating: boolean;
  onBack: () => void;
  onOpenStep: (step: ComposeStep) => void;
  onPromptChange: (prompt: string) => void;
  onStartTask: () => void;
}) {
  const { data: modelsData } = useQuery(
    rpcClient.gateway.models.live.list.experimental_liveOptions(),
  );
  const { data: projects } = useQuery(
    rpcClient.workspace.project.live.list.experimental_liveOptions(),
  );

  // The model the task would actually run on, which is the default until one
  // is picked. Naming it beats "Default": the point of the row is that you can
  // see the decision without opening anything.
  const effectiveModelURI = draft.modelURI ?? fallbackModelURI;
  const model = modelsData?.models.find((m) => m.uri === effectiveModelURI);
  const project = projects?.find((p) => p.id === draft.projectId);

  const folderValue =
    draft.folders.length === 0
      ? "None"
      : draft.folders.length === 1 && draft.folders[0]
        ? basename(draft.folders[0].path)
        : `${draft.folders.length} folders`;

  return (
    <Command className="flex h-full min-h-0 flex-col" shouldFilter={false}>
      <StepHeader
        onBack={onBack}
        onValueChange={onPromptChange}
        placeholder={`Talk to ${APP_NAME}`}
        value={draft.prompt}
      />
      <CommandList className="max-h-none min-h-0 flex-1">
        <CommandGroup>
          <CommandItem
            disabled={isCreating || !draft.prompt.trim()}
            onSelect={onStartTask}
            value="action:start"
          >
            <ArrowUpIcon className="size-4 opacity-50" />
            {/* Naming the text it will send, so the connection between the
                field above and this row is visible rather than assumed. */}
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">Start task</span>
              {draft.prompt.trim() && (
                <span className="text-muted-foreground">
                  {" "}
                  with “{draft.prompt.trim()}”
                </span>
              )}
            </span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Options">
          <OptionRow
            icon={<CirclesThreeIcon className="size-4 opacity-50" />}
            label="Model"
            onSelect={() => {
              onOpenStep("model");
            }}
            unset={!model}
            value={model?.name.trim() ?? "…"}

            valueIcon={
              model ? (
                <AIProviderIcon
                  className="size-3.5"
                  type={model.params.provider}
                />
              ) : undefined
            }
          />
          <OptionRow
            icon={<PaperclipIcon className="size-4 opacity-50" />}
            label="Files"
            onSelect={() => {
              onOpenStep("files");
            }}
            unset={draft.files.length === 0}
            value={
              draft.files.length === 0
                ? "None"
                : `${draft.files.length} file${draft.files.length === 1 ? "" : "s"}`
            }
            valueIcon={
              draft.files.length > 0 ? (
                <FileIcon className="size-3.5 text-muted-foreground" />
              ) : undefined
            }
          />
          <OptionRow
            icon={<FolderSimpleIcon className="size-4 opacity-50" />}
            label="Work in folder"
            onSelect={() => {
              onOpenStep("folders");
            }}
            unset={draft.folders.length === 0}
            value={folderValue}
            valueIcon={
              draft.folders.length > 0 ? (
                <FolderSimpleIcon className="size-3.5 text-muted-foreground" />
              ) : undefined
            }
          />
          <OptionRow
            icon={<CardsThreeIcon className="size-4 opacity-50" />}
            label="Project"
            onSelect={() => {
              onOpenStep("project");
            }}
            unset={!project}
            value={project?.name ?? "None"}
          />
        </CommandGroup>
      </CommandList>
      <OverlayFooter
        hints={[
          { keys: ["↵"], label: isCreating ? "Starting…" : "Start task" },
        ]}
      />
    </Command>
  );
}

export function ProjectStep({
  onBack,
  onPick,
  selectedId,
}: {
  onBack: () => void;
  onPick: (projectId: null | ProjectId) => void;
  selectedId: null | ProjectId;
}) {
  const [search, setSearch] = useState("");
  const { data: projects, isLoading } = useQuery(
    rpcClient.workspace.project.live.list.experimental_liveOptions(),
  );

  const matches = (projects ?? []).filter((project) =>
    project.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <Command className="flex h-full min-h-0 flex-col" shouldFilter={false}>
      <StepHeader
        onBack={onBack}
        onValueChange={setSearch}
        placeholder="Search projects…"
        value={search}
      />
      <CommandList className="max-h-none min-h-0 flex-1">
        <CommandEmpty>{isLoading ? "Loading…" : "No projects."}</CommandEmpty>
        <CommandGroup>
          <CommandItem
            onSelect={() => {
              onPick(null);
            }}
            value="project:none"
          >
            <XIcon className="size-4 opacity-50" />
            <span className="min-w-0 flex-1 truncate">No project</span>
            {selectedId === null && (
              <span className="shrink-0 text-xs text-brand-600">Current</span>
            )}
          </CommandItem>
          {matches.map((project) => (
            <CommandItem
              key={project.id}
              onSelect={() => {
                onPick(project.id);
              }}
              value={`project:${project.id.toLowerCase()}`}
            >
              <CardsThreeIcon className="size-4 opacity-50" />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      <OverlayFooter hints={[{ keys: ["↵"], label: "Use this project" }]} />
    </Command>
  );
}

/** A row that opens its own screen, with what it is currently set to on the
 *  right. That column is the review: one pass down it is what you check before
 *  sending. */
function OptionRow({
  icon,
  label,
  onSelect,
  unset,
  value,
  valueIcon,
}: {
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
  unset?: boolean;
  value: string;
  valueIcon?: React.ReactNode;
}) {
  return (
    <CommandItem onSelect={onSelect} value={`option:${label}`}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        className={`flex shrink-0 items-center gap-1.5 text-xs ${unset ? "text-muted-foreground/60" : "text-foreground"}`}
      >
        {valueIcon}
        {value}
      </span>
      <CaretRightIcon className="size-3 shrink-0 text-muted-foreground/50" />
    </CommandItem>
  );
}

/** The way back, and on the options step the prompt itself. */
function StepHeader({
  onBack,
  onValueChange,
  placeholder,
  value,
}: {
  onBack: () => void;
  onValueChange?: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5 border-b border-border pr-3">
      <BackButton onBack={onBack} />
      {/* No magnifying glass: the back arrow is the only icon on this bar, and
          a second one reads as a second control. */}
      <CommandInput
        autoFocus
        className="h-11"
        containerClassName="flex-1 border-b-0 px-0 [&>svg]:hidden"
        onValueChange={onValueChange}
        placeholder={placeholder}
        value={value}
      />
    </div>
  );
}
