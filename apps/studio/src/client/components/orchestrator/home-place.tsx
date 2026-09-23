import { FileTypeIcon } from "@/client/components/extend/file-system";
import { PlanningDotIcon } from "@/client/components/icons/planning-dot";
import { Skeleton } from "@/client/components/ui/skeleton";
import { getComputerFileUrl } from "@/client/lib/computer-file-url";
import { getFileType } from "@/client/lib/get-file-type";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { type ReactNode, useState } from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { useOrchestrator } from "./context";
import { FileThumbnail } from "./file-thumbnail";
import { segmentsOf } from "./host-path";
import { NewTopicDialog } from "./new-topic-dialog";
import { useThreadActionsFor } from "./thread-actions";
import { ThreadRow } from "./thread-row";
import { byActivity, type Thread, type Topic } from "./threads";
import { useSetThreadTopics } from "./use-set-thread-topics";

type RecentFile = RPCOutput["workspace"]["computer"]["recents"][number];

/** How many of each Home shows: a picture of lately, not a list of everything. */
const FILES_SHOWN = 12;
const THREADS_SHOWN = 8;

/** The kinds of file a thumbnail can be drawn for: anything the viewer lays out as a document. */
const DRAWN_AS_DOCUMENT = new Set(["code", "html", "markdown", "text"]);

/**
 * Home: the landing page a person jumps into recent things from. The date
 * as a large heading, one quiet line of what the agent is doing now, then
 * the things lately made, each drawn small with its mark and name and the
 * thread it came from under it, and the recent chats as the rows the inbox
 * draws them as, in one card. A tile opens the thing where it lives: a file
 * in Files as its tab, a chat in Chat on that thread. Nothing counts and
 * nothing is unread here; it is a picture of the week, not a second inbox.
 */
export function HomePlace({
  onOpenFile,
  onOpenThread,
}: {
  /** Opens a file in Files, as its own tab. */
  onOpenFile: (hostPath: string) => void;
  /** Opens a thread in Chat. */
  onOpenThread: (sessionId: StoreId.Session) => void;
}) {
  const { taskId } = useOrchestrator();
  const threadsQuery = useQuery(
    rpcClient.workspace.orchestrator.threads.live.list.experimental_liveOptions(
      { input: { id: taskId } },
    ),
  );
  const recents = useQuery(
    rpcClient.workspace.computer.recents.queryOptions({
      input: { id: taskId },
    }),
  );
  const threads = byActivity(threadsQuery.data ?? []);
  const working = threads.find((thread) => thread.state === "working");
  const files = (recents.data ?? []).slice(0, FILES_SHOWN);
  const recent = threads
    .filter((thread) => !thread.archived)
    .slice(0, THREADS_SHOWN);
  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-8 pt-6 pb-8"
      data-slot="home-place"
    >
      <h1 className="text-[28px] leading-9 font-semibold">
        {format(new Date(), "EEEE, MMMM d")}
      </h1>
      <p className="mt-1.5 flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
        {working ? (
          <>
            <PlanningDotIcon className="size-4" />
            <span className="min-w-0 truncate">
              Working on {working.title}
              {working.latest?.text ? `: ${working.latest.text}` : ""}
            </span>
          </>
        ) : (
          <>
            <ChatsCircleIcon className="size-4 shrink-0" />
            <span>Nothing is running right now.</span>
          </>
        )}
      </p>

      <Section title="Made lately">
        {recents.data === undefined ? (
          <FileGrid>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton className="h-28 rounded-lg" key={index} />
            ))}
          </FileGrid>
        ) : files.length === 0 ? (
          <Empty>Files Instrument makes will appear here.</Empty>
        ) : (
          <FileGrid>
            {files.map((file) => (
              <FileTile
                file={file}
                from={threadOfFile(file, threads)?.title}
                key={file.path}
                onOpen={() => {
                  onOpenFile(file.path);
                }}
              />
            ))}
          </FileGrid>
        )}
      </Section>

      <Section title="Recent chats">
        {threadsQuery.data === undefined ? (
          <Skeleton className="h-36 rounded-xl" />
        ) : recent.length === 0 ? (
          <Empty>Threads you start show up here.</Empty>
        ) : (
          <RecentChats onOpen={onOpenThread} taskId={taskId} threads={recent} />
        )}
      </Section>
    </div>
  );
}

/** A quiet line where a grid would be, for a section with nothing in it yet. */
function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>;
}

/** The file tiles, as many across as the room allows, small enough that a row of them is a row. */
function FileGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-x-4 gap-y-5">
      {children}
    </div>
  );
}

/** A file drawn small: a document as its viewer draws it, a picture as itself, and anything else as its mark. */
function FilePicture({ file }: { file: RecentFile }) {
  const kind = getFileType({ filename: file.name, mimeType: file.mimeType });
  const version =
    file.modifiedAt === undefined ? undefined : String(file.modifiedAt);
  if (DRAWN_AS_DOCUMENT.has(kind)) {
    return (
      <FileThumbnail hostPath={file.path} name={file.name} version={version} />
    );
  }
  if (kind === "image") {
    return (
      <img
        alt=""
        className="size-full object-cover"
        draggable={false}
        src={getComputerFileUrl({ hostPath: file.path, version })}
      />
    );
  }
  return (
    <div className="grid size-full place-items-center">
      <FileTypeIcon className="size-10" fileName={file.name} />
    </div>
  );
}

/** One thing lately made: its picture, then its mark and name, then the thread it came from in grey. */
function FileTile({
  file,
  from,
  onOpen,
}: {
  file: RecentFile;
  from: string | undefined;
  onOpen: () => void;
}) {
  // A button in role only: the picture is a document's viewer, which can draw
  // a button of its own, and a button cannot hold another.
  return (
    <div
      className="group/tile flex min-w-0 cursor-default flex-col text-left"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="h-28 w-full overflow-hidden rounded-lg bg-card shadow-sm ring-1 ring-border group-hover/tile:ring-foreground/25">
        <FilePicture file={file} />
      </div>
      <p className="mt-2 flex min-w-0 items-center gap-1.5 text-[12px] leading-4 font-medium">
        <FileTypeIcon className="size-3.5" fileName={file.name} />
        <span className="truncate">{file.name}</span>
      </p>
      <p className="h-4 truncate text-[11px] leading-4 text-muted-foreground">
        {from}
      </p>
    </div>
  );
}

/**
 * The recent chats as the inbox draws them: its own rows, one under the
 * other in one card, with the state dot, the topics, the latest line, the
 * holds and the star each row carries there, so a chat looks the same here
 * as it does in the list. The rows are the inbox's one-line rows, since
 * Home is as wide as the inbox ever gets.
 */
function RecentChats({
  onOpen,
  taskId,
  threads,
}: {
  onOpen: (sessionId: StoreId.Session) => void;
  taskId: TaskId;
  threads: Thread[];
}) {
  const appsBySlug = useAppsBySlug();
  const actionsFor = useThreadActionsFor();
  const setThreadTopics = useSetThreadTopics(taskId);
  const topicsQuery = useQuery(
    rpcClient.workspace.orchestrator.topics.list.queryOptions({
      input: { id: taskId },
    }),
  );
  const topics: Topic[] = topicsQuery.data ?? [];
  const createTopic = useMutation(
    rpcClient.workspace.orchestrator.topics.create.mutationOptions({
      onSuccess: () => void topicsQuery.refetch(),
    }),
  );
  // The thread a new topic is being made for, from its row's tag control.
  const [newTopicFor, setNewTopicFor] = useState<Thread>();
  return (
    <>
      <div
        className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border"
        data-density="slim"
      >
        {threads.map((thread) => (
          <ThreadRow
            actions={actionsFor(thread)}
            appsBySlug={appsBySlug}
            density="slim"
            isOpen={false}
            key={thread.id}
            onNewTopic={() => {
              setNewTopicFor(thread);
            }}
            onOpen={() => {
              onOpen(thread.id);
            }}
            onSetTopics={(next) => {
              setThreadTopics(thread.id, next);
            }}
            thread={thread}
            topics={topics}
          />
        ))}
      </div>
      <NewTopicDialog
        onCreate={(topic) => {
          const forThread = newTopicFor;
          createTopic.mutate(
            { ...topic, id: taskId },
            {
              onSuccess: (created) => {
                if (forThread) {
                  setThreadTopics(forThread.id, [
                    ...forThread.topics,
                    created.id,
                  ]);
                }
              },
            },
          );
        }}
        onOpenChange={(open) => {
          if (!open) {
            setNewTopicFor(undefined);
          }
        }}
        open={newTopicFor !== undefined}
        taken={topics.flatMap((topic) => (topic.emoji ? [topic.emoji] : []))}
      />
    </>
  );
}

/** A section of the page: a quiet head over its tiles. */
function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2.5 text-[13px] font-medium text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The thread a file came from: the one whose replies handed a file of that name over. */
function threadOfFile(file: RecentFile, threads: Thread[]) {
  return threads.find((thread) =>
    thread.holds.files.some(
      (path) => (segmentsOf(path).at(-1) ?? path) === file.name,
    ),
  );
}
