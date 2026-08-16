import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import { useOverlayHeight } from "@/client/components/overlay/chrome";
import { OverlayFooter } from "@/client/components/overlay/footer";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/client/components/ui/command";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import uFuzzy from "@leeoniya/ufuzzy";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { useMemo, useState } from "react";

// One shape every time it is summoned, with the list scrolling rather than the
// window growing: a launcher that resizes as you type reads as unstable.
const LAUNCHER_HEIGHT = 340;

// cmdk stores item values lowercased, so anything compared against them has
// to be lowercased too or a controlled selection never matches its row.
const taskValue = (id: string) => `task:${id.toLowerCase()}`;

const fuzzy = new uFuzzy({ intraMode: 1 });

const MAX_RESULTS = 12;
const RESTING_RESULTS = 9;

export function Launcher({
  draftPrompt,
  onOpenTask,
  onQuickSend,
  onResumeDraft,
  onReview,
}: {
  /** The prompt left behind by the last trip into the options step, if any. */
  draftPrompt: string;
  onOpenTask: (taskId: TaskId) => void;
  onQuickSend: (prompt: string) => void;
  onResumeDraft: () => void;
  onReview: (prompt: string) => void;
}) {
  useOverlayHeight(LAUNCHER_HEIGHT);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const trimmed = query.trim();

  const tasksQuery = useQuery(
    rpcClient.workspace.task.list.queryOptions({
      input: { direction: "desc", sortBy: "updatedAt" },
    }),
  );

  // The same resolution the composer uses, rather than reading the stored
  // preference directly: that one is unset until something has saved it, which
  // would leave the fast path refusing to start anything on a fresh install.
  const [defaultModelURI] = useDefaultModelURI();

  // Which model the one-line path will actually use. Shown on the row rather
  // than left implicit: this is the only place that decision is visible before
  // the task exists, since the launcher has no picker of its own.
  const { data: modelsData } = useQuery(
    rpcClient.gateway.models.live.list.experimental_liveOptions(),
  );
  const defaultModel = modelsData?.models.find(
    (model) => model.uri === defaultModelURI,
  );

  const tasks = useMemo(() => tasksQuery.data?.tasks ?? [], [tasksQuery.data]);

  const results = useMemo(() => {
    if (!trimmed) {
      return tasks
        .slice(0, RESTING_RESULTS)
        .map((task) => ({ ranges: null, task }));
    }

    const haystack = tasks.map((task) => task.title);
    // eslint-disable-next-line unicorn/no-array-method-this-argument
    const indexes = fuzzy.filter(haystack, trimmed);
    if (!indexes?.length) {
      return [];
    }

    const info = fuzzy.info(indexes, haystack, trimmed);
    const order = fuzzy.sort(info, haystack, trimmed);
    return order
      .slice(0, MAX_RESULTS)
      .map((i) => {
        const taskIndex = info.idx[i];
        const task = taskIndex === undefined ? undefined : tasks[taskIndex];
        // The matched characters, so a row shows why it is a row.
        return task ? { ranges: info.ranges[i] ?? null, task } : undefined;
      })
      .filter((result) => result !== undefined);
  }, [trimmed, tasks]);

  // cmdk keeps whatever was selected last, which on open is whichever row
  // happened to mount first -- the actions, since the task list arrives with
  // the query. Selection is derived from the rendered order instead, so it is
  // always the top row unless the user moved it somewhere still on screen.
  const hasDraft = !trimmed && draftPrompt.trim().length > 0;
  const standingValues = trimmed
    ? []
    : ["action:start", ...(hasDraft ? ["action:draft"] : [])];
  const values = [
    ...standingValues,
    ...results.map(({ task }) => taskValue(task.id)),
    ...(trimmed ? ["action:new-task"] : []),
  ];
  // First row, and selected: opening the panel and pressing Enter should start
  // something, which is what the panel is for.
  const selectedValue = values.includes(selected)
    ? selected
    : (values[0] ?? "");
  const isStartRow =
    selectedValue === "action:new-task" || selectedValue === "action:start";

  return (
    <>
      {/* cmdk drives selection and Enter, so what you typed is a filter first
          and the text of a new task second -- the same way the app's own
          command palette behaves, rather than a prompt box that happens to
          list things underneath it. */}
      <Command
        className="min-h-0 flex-1"
        onKeyDown={(event) => {
          // The fast path: skip the options entirely and send on the defaults.
          // The row already names the model, so this is never a blind send.
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            if (!trimmed) return;
            event.preventDefault();
            onQuickSend(trimmed);
          }
        }}
        onValueChange={setSelected}
        shouldFilter={false}
        value={selectedValue}
      >
        {/* The search row is the drag handle. `app-region: drag` swallows
            clicks, so the field itself opts back out: clicking into it and
            selecting text still work, and the space beside it moves the
            window. No separate handle to look at. */}
        <div
          className="[&_input]:[-webkit-app-region:no-drag]"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <CommandInput
            autoFocus
            onValueChange={setQuery}
            placeholder="Search tasks, or type to start one…"
            value={query}
          />
        </div>
        <CommandList className="max-h-none min-h-0 flex-1">
          <CommandEmpty>
            {tasksQuery.isLoading ? "Loading…" : "No matching tasks."}
          </CommandEmpty>

          {!trimmed && (
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  onReview("");
                }}
                value="action:start"
              >
                <PlusIcon className="size-4 shrink-0 opacity-50" />
                <span className="min-w-0 flex-1 truncate">Start a task</span>
              </CommandItem>
              {hasDraft && (
                <CommandItem onSelect={onResumeDraft} value="action:draft">
                  <PencilSimpleIcon className="size-4 shrink-0 opacity-50" />
                  <span className="min-w-0 flex-1 truncate">
                    Continue draft{" "}
                    <span className="text-muted-foreground">
                      “{draftPrompt.trim()}”
                    </span>
                  </span>
                </CommandItem>
              )}
            </CommandGroup>
          )}

          {results.length > 0 && (
            <CommandGroup heading={trimmed ? "Tasks" : "Recent"}>
              {results.map(({ ranges, task }) => (
                <CommandItem
                  key={task.id}
                  onSelect={() => {
                    onOpenTask(task.id);
                  }}
                  value={taskValue(task.id)}
                >
                  <ChatCircleIcon className="size-4 shrink-0 opacity-50" />
                  <span className="min-w-0 flex-1 truncate">
                    <FuzzyHighlight ranges={ranges} text={task.title} />
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDistanceToNowStrict(task.updatedAt)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* Only once something has been typed: with nothing in the field
              there is nothing to start, and the resting panel is better as a
              list of what you were doing. Last, so a query that matches opens
              the match rather than starting a near-duplicate -- and first when
              nothing matched, which is when starting one is what you meant. */}
          {trimmed && (
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  onReview(trimmed);
                }}
                value="action:new-task"
              >
                <PlusIcon className="size-4 shrink-0 opacity-50" />
                <span className="min-w-0 flex-1 truncate">
                  Start a task with{" "}
                  <span className="font-medium">“{trimmed}”</span>
                </span>
                {defaultModel && (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <AIProviderIcon
                      className="size-3.5"
                      type={defaultModel.params.provider}
                    />
                    {defaultModel.name.trim()}
                  </span>
                )}
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
        <OverlayFooter
          hints={
            isStartRow
              ? [
                  { keys: ["↵"], label: "Options" },
                  { keys: ["⌘", "↵"], label: "Send now" },
                ]
              : [{ keys: ["↵"], label: "Open" }]
          }
        />
      </Command>
    </>
  );
}
