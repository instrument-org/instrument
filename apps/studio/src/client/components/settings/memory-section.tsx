import { THREADS_HREF } from "@/client/atoms/orchestrator";
import { settingsModalAtom } from "@/client/atoms/settings-modal";
import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { OrchestratorContext } from "@/client/components/orchestrator/context";
import { GlyphButton } from "@/client/components/orchestrator/glyph-button";
import { RelativeTime } from "@/client/components/relative-time";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useContext, useState } from "react";
import { toast } from "sonner";

type Memory =
  RPCOutput["workspace"]["orchestrator"]["memory"]["list"]["memories"][number];

/**
 * The chat tools worth asking what they already know about the user, each by
 * the name the user knows it as and the page their own account is behind.
 *
 * Every one of them keeps something like memory, and every one of them will
 * say what it holds when asked in a chat, which is the one road that works
 * across all of them: their settings screens agree on nothing.
 */
const MEMORY_SOURCES = [
  { name: "ChatGPT", url: "https://chatgpt.com" },
  { name: "Claude", url: "https://claude.ai" },
  { name: "Gemini", url: "https://gemini.google.com" },
  { name: "Grok", url: "https://grok.com" },
  { name: "Copilot", url: "https://copilot.microsoft.com" },
  { name: "Perplexity", url: "https://www.perplexity.ai" },
] as const;

/**
 * What the conversation remembers about the user, to read and to prune.
 *
 * A tab of its own rather than a block under General: this is a list that
 * grows, each row opens, and none of it is a setting. The agent writes and
 * corrects these itself, so nothing here adds one.
 */
export function MemorySection() {
  const { data } = useQuery(
    rpcClient.workspace.orchestrator.memory.live.list.experimental_liveOptions(),
  );
  const revealMutation = useMutation(
    rpcClient.utils.openFolder.mutationOptions({
      onError: () => {
        toast.error("Couldn't open the memory folder");
      },
    }),
  );
  const memories = data?.memories ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-semibold">Memory</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          What {APP_NAME} remembers about you, across every thread
        </p>
      </div>

      {memories.length === 0 ? (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">
            Nothing remembered yet. {APP_NAME} saves what it learns about you as
            you talk.
          </p>
        </Card>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {memories.map((memory) => (
            <MemoryRow key={memory.path} memory={memory} />
          ))}
        </ul>
      )}

      <Import />

      {data && (
        <Button
          className="h-auto p-0 text-xs font-normal text-muted-foreground"
          onClick={() => {
            revealMutation.mutate({ folderPath: data.dir });
          }}
          variant="link"
        >
          <RevealInFolderIcon className="size-3.5" />
          {getRevealInFolderLabel()}
        </Button>
      )}
    </div>
  );
}

/**
 * The thread a memory was learned in, as a door to it.
 *
 * Only where threads are a thing that can be opened. Elsewhere the title is
 * the name of something the reader cannot get to from here, which is worth
 * less than the room it takes.
 */
function FromThread({ from }: { from: NonNullable<Memory["from"]> }) {
  const closeSettings = useSetAtom(settingsModalAtom);
  const gestures = useOpenGestures({
    href: `${THREADS_HREF}/${from.sessionId ?? ""}`,
    kind: "screen",
  });

  if (!from.sessionId) {
    return <span className="truncate">{from.title}</span>;
  }
  const open = gestures.destinations.find((entry) => entry.id === "open");
  if (!open) {
    return <span className="truncate">{from.title}</span>;
  }
  return (
    <button
      className="truncate text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
      onAuxClick={gestures.onAuxClick}
      onClick={() => {
        open.run();
        closeSettings(null);
      }}
      onContextMenu={gestures.onContextMenu}
      type="button"
    >
      {from.title}
    </button>
  );
}

/**
 * A way to start from what another chat tool already knows about the user.
 *
 * Each button opens a thread with its words as the first message, which is
 * all a button on a screen ever does here. Nothing is imported by this
 * component: the conversation drives the page, reads the answer, and decides
 * what is worth keeping, so a tool that changes its screens next month costs
 * a sentence rather than a parser.
 *
 * Only where there is a conversation to send them to.
 */
function Import() {
  const orchestrator = useContext(OrchestratorContext);
  const closeSettings = useSetAtom(settingsModalAtom);

  if (!orchestrator) {
    return null;
  }
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium">Import from another tool</h4>
      <p className="text-xs text-muted-foreground">
        {APP_NAME} opens the tool, asks it what it knows about you, and keeps
        what is worth keeping. You will need to be signed in there.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        {MEMORY_SOURCES.map((source) => (
          <GlyphButton
            key={source.name}
            onClick={() => {
              orchestrator.ask(importPrompt(source));
              closeSettings(null);
            }}
            size="sm"
          >
            {source.name}
          </GlyphButton>
        ))}
      </div>
    </section>
  );
}

/**
 * What one of those buttons says to the conversation.
 *
 * Written as the user would say it, because that is what it becomes: the
 * thread opens with these words as the first message. It names the road
 * rather than the result, since the agent owns how it drives a page, and it
 * is explicit that the saving happens back in the thread -- a task has no
 * memory command, so a brief that tells one to save would end in a task
 * reporting a thing it could not do.
 */
function importPrompt({ name, url }: { name: string; url: string }) {
  return `Import what ${name} knows about me.

Open ${url} and check I am signed in; if I am not, say so and wait for me rather than guessing. Then ask ${name} in a chat to list everything it remembers about me, including anything it has saved about my preferences, my work, and how I like answers written, and read the whole reply.

Bring what it says back to this thread and save the durable facts here as memories, one fact each, in my words where you can. Skip anything that was only about one old conversation, anything you already remember about me, and anything sensitive such as keys, passwords, or payment details. Tell me what you saved and what you left out.`;
}

/**
 * One memory: its first line, opening to the whole of it, with the thread it
 * came from and when underneath.
 *
 * Most are a sentence, so the row is the memory and the caret only earns its
 * place on the ones that run longer.
 */
function MemoryRow({ memory }: { memory: Memory }) {
  const [isOpen, setIsOpen] = useState(false);
  const forgetMutation = useMutation(
    rpcClient.workspace.orchestrator.memory.forget.mutationOptions({
      onError: () => {
        toast.error("Couldn't forget that memory");
      },
    }),
  );
  const [headline, ...rest] = memory.text.split("\n");
  const hasMore = rest.join("\n").trim() !== "";

  return (
    <li className="flex items-start gap-2 p-3">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {/* The caret and the memory open the rest of it; the line beneath
            carries a link of its own, so it stays outside the control. */}
        {hasMore ? (
          <button
            aria-expanded={isOpen}
            aria-label={isOpen ? "Show less" : "Show the whole memory"}
            className="mt-0.5 shrink-0"
            onClick={() => {
              setIsOpen((open) => !open);
            }}
            type="button"
          >
            <CaretRightIcon
              className={`size-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="mt-0.5 size-3.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <p
            className={hasMore ? "cursor-default text-sm" : "text-sm"}
            onClick={
              hasMore
                ? () => {
                    setIsOpen((open) => !open);
                  }
                : undefined
            }
          >
            {headline}
          </p>
          {hasMore && isOpen && (
            <p className="pt-1 text-sm whitespace-pre-wrap text-muted-foreground">
              {rest.join("\n").trim()}
            </p>
          )}
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {memory.from && <FromThread from={memory.from} />}
            {memory.from && <span aria-hidden>·</span>}
            <RelativeTime date={new Date(memory.at)} />
          </p>
        </div>
      </div>
      <Button
        aria-label={`Forget “${memory.name}”`}
        className="shrink-0"
        disabled={forgetMutation.isPending}
        onClick={() => {
          forgetMutation.mutate({ name: memory.name });
        }}
        size="icon-sm"
        variant="ghost"
      >
        <TrashIcon className="size-4" />
      </Button>
    </li>
  );
}
