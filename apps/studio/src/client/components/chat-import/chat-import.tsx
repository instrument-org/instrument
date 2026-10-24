import { settingsModalAtom } from "@/client/atoms/settings-modal";
import { VendorMark } from "@/client/components/vendor-mark";
import { Button } from "@/client/components/ui/button";
import { Progress } from "@/client/components/ui/progress";
import { Spinner } from "@/client/components/ui/spinner";
import { WindowContext } from "@/client/components/window/context";
import { chatHref } from "@/client/components/window/window-href";
import { useModalBack } from "@/client/hooks/use-modal-back";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCInput, type RPCOutput } from "@/client/rpc/client";
import claudeCode from "@lobehub/icons-static-svg/icons/claudecode-color.svg?raw";
import claude from "@lobehub/icons-static-svg/icons/claude-color.svg?raw";
import codex from "@lobehub/icons-static-svg/icons/codex-color.svg?raw";
import cursor from "@lobehub/icons-static-svg/icons/cursor.svg?raw";
import openai from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { type ReactNode, useContext, useEffect, useRef, useState } from "react";

import { type Candidate, countOf } from "./chat-import-model";
import { ChatImportPicker } from "./chat-import-picker";

type ImportFrom = RPCInput["workspace"]["chatImport"]["list"]["from"];
type ImportSourceKind =
  RPCOutput["workspace"]["chatImport"]["sources"][number]["kind"];
type RunOutput = RPCOutput["workspace"]["chatImport"]["run"];

/** The marks of the apps chats come from, by the source's kind. */
const MARKS: Record<ImportSourceKind, { ink: boolean; svg: string }> = {
  "chatgpt-export": { ink: true, svg: openai },
  "claude-code": { ink: true, svg: claudeCode },
  "claude-export": { ink: true, svg: claude },
  // Its glyph sits on a white tile of its own, which stays white in either
  // theme rather than taking the text color.
  codex: { ink: false, svg: codex },
  cursor: { ink: true, svg: cursor },
};

/**
 * The chat services whose export a person asks for themselves, and where in
 * each one's settings that is. Each emails a link to a zip that works for a
 * day; nothing here asks for the export on their behalf.
 */
const EXPORTS = [
  {
    howTo:
      "In ChatGPT, open Settings, then Data controls, and choose Export. ChatGPT emails you a link to a zip, and the link works for a day.",
    kind: "chatgpt-export",
    name: "ChatGPT",
    settings: "https://chatgpt.com/#settings/DataControls",
  },
  {
    howTo:
      "In Claude, open Settings, then Privacy, and choose Export data. Claude emails you a link to a zip, and the link works for a day.",
    kind: "claude-export",
    name: "Claude",
    settings: "https://claude.ai/settings/data-privacy-controls",
  },
] as const satisfies {
  howTo: string;
  kind: ImportSourceKind;
  name: string;
  settings: string;
}[];

type Step =
  | { step: "sources" }
  | { from: ImportFrom; step: "pick" }
  | { from: ImportFrom; picked: Candidate[]; step: "run" }
  | { output: RunOutput; picked: Candidate[]; step: "done" };

/**
 * Bringing chats in from other AI apps: pick a source, pick its chats, watch
 * them come in, then open one.
 *
 * Fills the height it is given, since the picker's list has a scroller of
 * its own. `onBack` is the way out of the first step, for a page this one is
 * drawn inside.
 */
export function ChatImport({
  backLabel,
  onBack,
}: {
  backLabel: string;
  onBack: () => void;
}) {
  const [step, setStep] = useState<Step>({ step: "sources" });
  const toSources = () => {
    setStep({ step: "sources" });
  };
  // Back steps to the sources from a later step and out from the sources,
  // and a run in flight stays put.
  useModalBack(() => {
    if (step.step === "sources") {
      onBack();
    } else {
      toSources();
    }
  }, step.step !== "run");

  return (
    <div className="flex flex-1 basis-0 flex-col gap-6">
      {step.step !== "run" && (
        <BackButton
          label={step.step === "sources" ? backLabel : "Import chats"}
          onClick={step.step === "sources" ? onBack : toSources}
        />
      )}
      {step.step === "sources" && (
        <SourcesStep
          onPick={(from) => {
            setStep({ from, step: "pick" });
          }}
        />
      )}
      {step.step === "pick" && (
        <PickStep
          from={step.from}
          onImport={(picked) => {
            setStep({ from: step.from, picked, step: "run" });
          }}
        />
      )}
      {step.step === "run" && (
        <RunStep
          from={step.from}
          onDone={(output) => {
            setStep({ output, picked: step.picked, step: "done" });
          }}
          onFailed={() => {
            setStep({ from: step.from, step: "pick" });
          }}
          picked={step.picked}
        />
      )}
      {step.step === "done" && (
        <DoneStep
          onMore={toSources}
          output={step.output}
          picked={step.picked}
        />
      )}
    </div>
  );
}

function BackButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex shrink-0 items-center gap-2 self-start text-sm text-muted-foreground hover:text-foreground"
      onClick={onClick}
      type="button"
    >
      <ArrowLeftIcon className="size-4" />
      {label}
    </button>
  );
}

function Heading({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="shrink-0">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function SourceMark({ kind }: { kind: ImportSourceKind | undefined }) {
  const mark = kind ? MARKS[kind] : undefined;
  return mark ? (
    <VendorMark className="size-5" ink={mark.ink} svg={mark.svg} />
  ) : (
    <FolderIcon className="size-5 text-muted-foreground" />
  );
}

/**
 * Where chats can come from: a tile for each coding agent this computer
 * has, which opens its chats at once, and a card for each chat service,
 * which takes the export file the person asked that service for.
 */
function SourcesStep({ onPick }: { onPick: (from: ImportFrom) => void }) {
  const { data: sources } = useQuery(
    rpcClient.workspace.chatImport.sources.queryOptions(),
  );

  return (
    <>
      <Heading title="Import chats">
        Bring in your conversations from other AI apps, so you can read, search,
        and continue them here.
      </Heading>
      <div className="space-y-3">
        {EXPORTS.map((service) => (
          <ExportCard
            key={service.kind}
            onFile={(path) => {
              onPick({ path, type: "export" });
            }}
            service={service}
          />
        ))}
      </div>
      {sources && sources.length > 0 && (
        <section className="space-y-3">
          <p className="text-sm text-muted-foreground">
            These coding agents on your computer have chats too.
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
            {sources.map((source) => (
              <button
                className="flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring"
                key={source.kind}
                onClick={() => {
                  onPick(source.from);
                }}
                type="button"
              >
                <span className="grid size-6 shrink-0 place-items-center">
                  <SourceMark kind={source.kind} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {source.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {source.location}
                  </span>
                </span>
                <CaretRightIcon className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/**
 * One chat service's export: how to ask for it, a way to its settings page
 * in the app's browser, and a place to drop the zip that arrives.
 *
 * The person presses Export there themselves. The whole card takes a drop,
 * so the zip can land anywhere on it.
 */
function ExportCard({
  onFile,
  service,
}: {
  onFile: (path: string) => void;
  service: (typeof EXPORTS)[number];
}) {
  const appWindow = useContext(WindowContext);
  const closeSettings = useSetAtom(settingsModalAtom);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOver, setIsOver] = useState(false);

  const take = (file: File | undefined) => {
    const path = file ? window.api.getFilePath(file) : "";
    if (path) {
      onFile(path);
    }
  };

  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border px-3 py-3",
        isOver && "border-primary bg-accent/50",
      )}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsOver(false);
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setIsOver(true);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsOver(false);
        take(event.dataTransfer.files[0]);
      }}
    >
      <span className="grid size-6 shrink-0 place-items-center">
        <SourceMark kind={service.kind} />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="text-sm font-medium">{service.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {service.howTo} Once it&rsquo;s downloaded, drop the zip here.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {appWindow && (
            <Button
              className="h-7 px-2 text-xs"
              onClick={() => {
                appWindow.openPage(service.settings, { newTab: true });
                closeSettings(null);
              }}
              size="sm"
              variant="outline"
            >
              <ArrowSquareOutIcon className="size-3.5" />
              Open {service.name} settings
            </Button>
          )}
          <Button
            className="h-7 px-2 text-xs"
            onClick={() => {
              inputRef.current?.click();
            }}
            size="sm"
            variant="outline"
          >
            Choose zip
          </Button>
          <input
            accept=".zip,application/zip"
            className="hidden"
            onChange={(event) => {
              take(event.target.files?.[0]);
              event.target.value = "";
            }}
            ref={inputRef}
            type="file"
          />
        </div>
      </div>
    </div>
  );
}

/** A source's chats, read and offered for picking. */
function PickStep({
  from,
  onImport,
}: {
  from: ImportFrom;
  onImport: (picked: Candidate[]) => void;
}) {
  const { data, error, isPending } = useQuery(
    rpcClient.workspace.chatImport.list.queryOptions({ input: { from } }),
  );

  if (isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Reading your chats…
      </div>
    );
  }
  if (error) {
    return (
      <Heading title="Couldn’t read those chats">
        {from.type === "export"
          ? "Make sure it’s the zip the service emailed you, then try again."
          : "Something went wrong reading them. Try again in a moment."}
      </Heading>
    );
  }
  return (
    <>
      <Heading title={`Import from ${data.source.name}`}>
        Choose the chats you want to bring in. They keep their original dates,
        so they won&rsquo;t crowd this week&rsquo;s chats.
      </Heading>
      <ChatImportPicker
        candidates={data.candidates}
        onImport={onImport}
        sourceName={data.source.name}
      />
    </>
  );
}

/**
 * The run: starts the import once it is listening for progress, and shows
 * how far along it is, chat by chat.
 */
function RunStep({
  from,
  onDone,
  onFailed,
  picked,
}: {
  from: ImportFrom;
  onDone: (output: RunOutput) => void;
  onFailed: () => void;
  picked: Candidate[];
}) {
  const [progress, setProgress] = useState<{ done: number; title: string }>({
    done: 0,
    title: "",
  });
  const run = useMutation(
    rpcClient.workspace.chatImport.run.mutationOptions({
      onError: (error) => {
        toast.error("The import didn’t finish", { cause: error });
        onFailed();
      },
      onSuccess: onDone,
    }),
  );
  const { mutate } = run;
  // Started once for the step, however often the effect runs.
  const hasStarted = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const events = await rpcClient.workspace.chatImport.events.progress.call(
        undefined,
        { signal: controller.signal },
      );
      if (!hasStarted.current) {
        hasStarted.current = true;
        mutate({ from, sourceIds: picked.map((entry) => entry.sourceId) });
      }
      try {
        for await (const event of events) {
          setProgress({ done: event.done, title: event.title });
        }
      } catch {
        // Aborted when the step goes, which is the end of listening.
      }
    })();
    return () => {
      controller.abort();
    };
  }, [from, mutate, picked]);

  const total = picked.length;
  return (
    <>
      <Heading title={`Importing ${countOf(total, "chat")}…`}>
        You can close Settings while this runs. Your chats will keep coming in.
      </Heading>
      <div className="space-y-2">
        <Progress value={(progress.done / total) * 100} />
        <p className="flex gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 tabular-nums">
            {progress.done.toLocaleString("en-US")} of{" "}
            {total.toLocaleString("en-US")}
          </span>
          {progress.title && (
            <span className="min-w-0 truncate">{progress.title}</span>
          )}
        </p>
      </div>
    </>
  );
}

/**
 * What came in, said plainly: how many, what was already here, and what
 * could not be read, with a way to the newest one.
 */
function DoneStep({
  onMore,
  output,
  picked,
}: {
  onMore: () => void;
  output: RunOutput;
  picked: Candidate[];
}) {
  const appWindow = useContext(WindowContext);
  const closeSettings = useSetAtom(settingsModalAtom);
  const bySourceId = new Map(picked.map((entry) => [entry.sourceId, entry]));
  // The newest by when it happened, which is where the chat list puts it.
  const newest = output.imported
    .map((entry) => ({ ...entry, candidate: bySourceId.get(entry.sourceId) }))
    .toSorted(
      (a, b) =>
        (b.candidate?.updatedAt.getTime() ?? 0) -
        (a.candidate?.updatedAt.getTime() ?? 0),
    )[0];
  const count = output.imported.length;

  return (
    <>
      <Heading
        title={
          count === 0
            ? "No chats came in"
            : `Imported ${countOf(count, "chat")}`
        }
      >
        {count === 0
          ? "Nothing new was imported this time."
          : "They’re in your chat list, sorted by when they happened."}
        {output.skipped.length > 0 &&
          ` ${countOf(output.skipped.length, "chat")} ${output.skipped.length === 1 ? "was" : "were"} already here, so ${output.skipped.length === 1 ? "it was" : "they were"} left alone.`}
      </Heading>
      {output.failed.length > 0 && (
        <div className="space-y-2 rounded-lg border px-3 py-2.5">
          <p className="text-sm">
            {output.failed.length === 1
              ? "One chat couldn’t be imported:"
              : `${countOf(output.failed.length, "chat")} couldn’t be imported:`}
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
            {output.failed.map((failure) => (
              <li className="flex gap-2" key={failure.sourceId}>
                <span className="min-w-0 truncate font-medium text-foreground">
                  {bySourceId.get(failure.sourceId)?.title ?? failure.sourceId}
                </span>
                <span className="min-w-0 truncate">{failure.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {newest && appWindow && (
          <Button
            onClick={() => {
              appWindow.openScreen(chatHref(newest.chatId));
              closeSettings(null);
            }}
          >
            Open newest chat
          </Button>
        )}
        <Button onClick={onMore} variant="outline">
          Import more
        </Button>
      </div>
    </>
  );
}
