import { THREADS_HREF } from "@/client/atoms/orchestrator";
import { settingsModalAtom } from "@/client/atoms/settings-modal";
import { Favicon } from "@/client/components/favicon";
import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { OrchestratorContext } from "@/client/components/orchestrator/context";
import { GlyphButton } from "@/client/components/orchestrator/glyph-button";
import { RelativeTime } from "@/client/components/relative-time";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Input } from "@/client/components/ui/input";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { cn, getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { debounce } from "radashi";
import { type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type Memory =
  RPCOutput["workspace"]["orchestrator"]["memory"]["list"]["memories"][number];
/** How tall a memory is allowed to stand before it is folded. */
const COLLAPSED_MAX_HEIGHT_PX = 60;

/**
 * The chat tools worth asking what they already know about the user.
 *
 * These keep their memory on their own servers, so the only way to it is the
 * one every one of them answers: ask in a chat. Their settings screens agree
 * on nothing, and a page that moves breaks nothing here.
 */
const WEB_SOURCES = [
  { name: "ChatGPT", site: "https://chatgpt.com" },
  { name: "Claude", site: "https://claude.ai" },
  { name: "Gemini", site: "https://gemini.google.com" },
  { name: "Grok", site: "https://grok.com" },
] as const;

/**
 * What the conversation remembers about the user: where it comes from, and
 * what it holds.
 *
 * Import stands above the list because an empty list is exactly when someone
 * needs it, and because it is read once and then ignored, while the list is
 * the thing they came back for.
 */
export function MemorySection() {
  const { data } = useQuery(
    rpcClient.workspace.orchestrator.memory.live.list.experimental_liveOptions(),
  );
  const memories = data?.memories ?? [];
  // The memory a link asked for, which the row for it brings into view. A
  // name the list does not hold is said once the list is known, since a link
  // to a memory since forgotten is the ordinary way to arrive here by name.
  const named = useAtomValue(settingsModalAtom)?.memory;
  const isNamedMissing =
    named !== undefined &&
    data !== undefined &&
    !memories.some((memory) => memory.name === named);
  useEffect(() => {
    if (isNamedMissing) {
      toast(`No memory named “${named}”`, {
        description: `${APP_NAME} may have forgotten it, or never kept one by that name.`,
        id: `memory-missing:${named}`,
      });
    }
  }, [isNamedMissing, named]);

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-semibold">Memory</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          What {APP_NAME} knows about you
        </p>
      </div>

      {/* Open only once the list is known to be empty; while it is loading
          there is nothing to decide from. */}
      <Import />

      <Memories dir={data?.dir} memories={memories} named={named} />
    </div>
  );
}

/**
 * What an import from a service nobody listed says to the conversation.
 *
 * Whatever they typed, said as they typed it: a name the agent has to find
 * the site for, or an address it can open. Guessing which it is here would
 * be guessing at a string a person wrote, which the agent is better placed
 * to read once it is in front of the page.
 */
function anyPrompt(entry: string) {
  return `Import what ${entry} knows about me.

Open ${entry}; if that is a name rather than an address, find the service and open it. If it turns out not to be a service I can sign in to and ask, say so rather than guessing. Check I am signed in, and if I am not, say so and wait for me. Then ask it in a chat to list everything it remembers about me, including anything it has saved about my preferences, my work, and how I like answers written, and read the whole reply.

Bring what it says back to this thread and save the durable facts here as memories, one fact each, in my words where you can. Skip anything that was only about one old conversation, anything you already remember about me, and anything sensitive such as keys, passwords, or payment details. Tell me what you saved and what you left out.`;
}

/**
 * The row for a service nobody listed: a name, or an address, and the same
 * verb beside it.
 *
 * The four above are the ones most people hold something in, and a list that
 * tried to be complete would be a directory nobody reads. Anything else is a
 * sentence the conversation can act on, so the field takes whatever the
 * person calls it and the agent works out where that is.
 */
function AnySource({ onStart }: { onStart: (entry: string) => void }) {
  const [entry, setEntry] = useState("");
  const trimmed = entry.trim();

  return (
    <li className="flex items-center gap-2.5 py-1.5 pr-1.5 pl-3">
      <form
        className="flex min-w-0 flex-1 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed) {
            // Pressable with nothing in it, and answered: a button greyed out
            // says the feature is off rather than that a field is empty.
            toast("Name a tool, or paste its website");
            return;
          }
          onStart(trimmed);
        }}
      >
        <Input
          className="min-w-0 flex-1"
          onChange={(event) => {
            setEntry(event.target.value);
          }}
          placeholder="Tool name or website"
          value={entry}
        />
        <GlyphButton size="sm" type="submit">
          Import
        </GlyphButton>
      </form>
    </li>
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
  const open = gestures.destinations.find((entry) => entry.id === "open");

  if (!from.sessionId || !open) {
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
 * Where memory can be started from: the agents already on this computer, then
 * the chat tools on the web.
 *
 * Two lists rather than one, because the difference decides what happens
 * next. What is on the computer is read straight off the disk in a moment;
 * what is on the web needs a browser, a sign-in that is the person's to give,
 * and a conversation with another product to get there.
 */
function Import() {
  const orchestrator = useContext(OrchestratorContext);
  const closeSettings = useSetAtom(settingsModalAtom);
  const { data: sources } = useQuery(
    rpcClient.workspace.orchestrator.memory.sources.queryOptions(),
  );

  if (!orchestrator) {
    return null;
  }
  const start = (prompt: string) => {
    orchestrator.ask(prompt);
    closeSettings(null);
  };

  return (
    <section className="space-y-3">
      {/* Never folded. It is the one thing on this screen someone would not
          think to look for, and a fold is how a feature goes unfound. */}
      <h4 className="text-sm font-medium">Import</h4>

      {sources && sources.length > 0 && (
        <SourceList caption="On this computer">
          {sources.map((source) => (
            <SourceRow
              detail={source.home}
              icon={<Favicon fallback={<FolderIcon />} url={source.site} />}
              key={source.path}
              name={source.name}
              onStart={() => {
                start(localPrompt(source));
              }}
            />
          ))}
        </SourceList>
      )}

      <SourceList caption="On the web">
        {WEB_SOURCES.map((source) => (
          <SourceRow
            icon={<Favicon url={source.site} />}
            key={source.name}
            name={source.name}
            onStart={() => {
              start(webPrompt(source));
            }}
          />
        ))}
        <AnySource
          onStart={(entry) => {
            start(anyPrompt(entry));
          }}
        />
      </SourceList>
    </section>
  );
}

/**
 * What an import from this computer says to the conversation.
 *
 * The agent has the home folder already, so this is a read and a judgment
 * rather than a permission: it is told where to start and left to decide what
 * in there is a standing fact about the person rather than a note about one
 * repository.
 */
function localPrompt({ home, name }: { home: string; name: string }) {
  // The folder named the way a person writes it, minus the shell's shorthand
  // for home, which is not a path the agent can open: home reaches it as one
  // of its own mounts, and its context already says which.
  const folder = home.replace(/^~\//, "");
  return `Import what ${name} knows about me from this computer.

Have a task read the ${folder} folder inside my home folder, handed to it read-only and never writable: that folder is another tool's memory and losing it would cost me work. Ask it to report the durable facts about me, one per line, in my words where it can, and save each one here as a memory.

What counts is what stays true about me whatever I am working on: how I like things done, how I want to be spoken to, a decision that stands, standing facts about me and my work. Most of what is in there is not that. It is instructions someone wrote for a different assistant, so leave behind anything that only makes sense inside that assistant's setup, its folders, its scripts, the machines it runs on, the way it was told to use its own commands, and anything telling you not to do something you do here. A fact that names a repository, a branch, or a file is almost never about me. Never save a key, a token, or anything else secret, whatever the file says. Tell me what you kept.`;
}

/**
 * The list, and what can be done to it.
 *
 * Selection lives here rather than in the rows, because forgetting a dozen is
 * one decision made once: the rows report what was picked and the bar over
 * them carries the verb, the way a mailbox does. A picked set is dropped
 * whenever the list underneath changes, since a name that is gone is not a
 * thing anyone still means to act on.
 */
function Memories({
  dir,
  memories,
  named,
}: {
  dir: string | undefined;
  memories: Memory[];
  named: string | undefined;
}) {
  // A pick belongs to the list it was made from: once the names under it
  // change, nothing is picked, read off the names rather than reset after
  // the fact.
  const names = memories.map((memory) => memory.name).join("\u0000");
  const [pickedIn, setPickedIn] = useState<{
    names: string;
    set: ReadonlySet<string>;
  }>({ names, set: new Set() });
  const picked = pickedIn.names === names ? pickedIn.set : new Set<string>();
  const setPicked = (
    next:
      | ((current: ReadonlySet<string>) => ReadonlySet<string>)
      | ReadonlySet<string>,
  ) => {
    setPickedIn({
      names,
      set: typeof next === "function" ? next(picked) : next,
    });
  };
  const [isConfirming, setIsConfirming] = useState(false);
  const forgetMutation = useMutation(
    rpcClient.workspace.orchestrator.memory.forget.mutationOptions({
      onError: () => {
        toast.error("Couldn't forget those memories");
      },
    }),
  );

  const toggle = (name: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(name)) {
        next.add(name);
      }
      return next;
    });
  };
  const forgetPicked = () => {
    forgetMutation.mutate({ names: [...picked] });
    setIsConfirming(false);
    setPicked(new Set());
  };

  return (
    <section className="space-y-2">
      <div className="flex h-7 items-center justify-between gap-2">
        {picked.size > 0 ? (
          <>
            <span className="text-sm font-medium tabular-nums">
              {picked.size} selected
            </span>
            <span className="flex items-center gap-1">
              <Button
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setPicked(new Set());
                }}
                size="sm"
                variant="ghost"
              >
                Clear
              </Button>
              <Button
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setIsConfirming(true);
                }}
                size="sm"
                variant="destructive"
              >
                Delete
              </Button>
            </span>
          </>
        ) : (
          <>
            <h4 className="text-sm font-medium">Memories</h4>
            {dir !== undefined && (
              <RevealFolder dir={dir} hidden={memories.length === 0} />
            )}
          </>
        )}
      </div>
      {memories.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          No memories yet.
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {memories.map((memory) => (
            <MemoryRow
              isNamed={memory.name === named}
              isPicked={picked.has(memory.name)}
              isPicking={picked.size > 0}
              key={memory.path}
              memory={memory}
              onPick={() => {
                toggle(memory.name);
              }}
            />
          ))}
        </ul>
      )}
      <AlertDialog onOpenChange={setIsConfirming} open={isConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {picked.size === 1
                ? "Delete this memory?"
                : `Delete ${picked.size} memories?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {APP_NAME} will stop taking {picked.size === 1 ? "it" : "them"}{" "}
              into account. It may learn the same thing again if you say it
              again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={forgetPicked}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/**
 * One memory, folded when it runs long, over where it came from.
 *
 * The one a link asked for scrolls into view as the list appears and stands
 * tinted for as long as the screen is open, since a list of memories that
 * all look alike gives a reader nothing else to find the named one by.
 */
function MemoryRow({
  isNamed,
  isPicked,
  isPicking,
  memory,
  onPick,
}: {
  isNamed: boolean;
  isPicked: boolean;
  /** Whether anything at all is picked, which is what keeps the rest of the boxes in view. */
  isPicking: boolean;
  memory: Memory;
  onPick: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (isNamed) {
      rowRef.current?.scrollIntoView({ block: "center" });
    }
  }, [isNamed]);

  useEffect(() => {
    const element = textRef.current;
    if (!element) {
      return;
    }
    // The full content height under either clamp, so the answer is the same
    // whether it is folded or open.
    const check = () => {
      setIsOverflowing(element.scrollHeight > COLLAPSED_MAX_HEIGHT_PX);
    };
    check();
    const observer = new ResizeObserver(debounce({ delay: 100 }, check));
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [memory.text]);

  return (
    <li
      className={cn(
        "group flex items-start gap-2.5 px-2.5 py-2",
        isPicked ? "bg-accent/50" : isNamed && "bg-accent/40",
      )}
      ref={rowRef}
    >
      {/* The gutter is always there and the box in it usually is not: a
          column that appears on hover would shove the words beside it, and
          one wide enough to read as furniture would cost the list a quarter
          of its width. Sixteen pixels of indent is the whole price. Once
          anything is picked every box stays in view, since a selection whose
          extent you cannot see is one you cannot trust. */}
      <Checkbox
        aria-label="Select this memory"
        checked={isPicked}
        className={cn(
          "mt-0.5 shrink-0 transition-opacity",
          !isPicked &&
            !isPicking &&
            "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
        )}
        onCheckedChange={onPick}
      />
      <div className="min-w-0 flex-1">
        {/* A shade under the page's own text in dark mode. A memory is the
            body of a card rather than a heading over one, and full-strength
            white on this ground reads as the loudest thing on the screen. */}
        <p
          className={cn(
            "text-sm leading-snug whitespace-pre-wrap dark:text-foreground/85",
            !isExpanded && "overflow-hidden",
          )}
          ref={textRef}
          style={
            isExpanded ? undefined : { maxHeight: COLLAPSED_MAX_HEIGHT_PX }
          }
        >
          {memory.text}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {memory.from && (
            <>
              <FromThread from={memory.from} />
              <span aria-hidden>·</span>
            </>
          )}
          <RelativeTime date={new Date(memory.at)} />
          {isOverflowing && (
            <>
              <span aria-hidden>·</span>
              <button
                className="underline-offset-2 hover:underline"
                onClick={() => {
                  setIsExpanded((expanded) => !expanded);
                }}
                type="button"
              >
                {isExpanded ? "Less" : "More"}
              </button>
            </>
          )}
        </p>
      </div>
    </li>
  );
}

/** The way to the files themselves, beside the list they hold. */
function RevealFolder({ dir, hidden }: { dir: string; hidden: boolean }) {
  const revealMutation = useMutation(
    rpcClient.utils.openFolder.mutationOptions({
      onError: () => {
        toast.error("Couldn't open the memory folder");
      },
    }),
  );

  if (hidden) {
    return null;
  }
  return (
    <Button
      className="h-auto p-0 text-xs font-normal text-muted-foreground"
      onClick={() => {
        revealMutation.mutate({ folderPath: dir });
      }}
      variant="link"
    >
      <RevealInFolderIcon className="size-3.5" />
      {getRevealInFolderLabel()}
    </Button>
  );
}

/** One captioned list of places to import from. */
function SourceList({
  caption,
  children,
}: {
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{caption}</p>
      <ul className="divide-y overflow-hidden rounded-lg border">{children}</ul>
    </div>
  );
}

/**
 * A place to import from, the way the Apps screen draws a service: its mark,
 * its name, where it is, and the one thing to do with it.
 */
function SourceRow({
  detail,
  icon,
  name,
  onStart,
}: {
  /** Where it is, for a place whose whereabouts is the point; a site's is not. */
  detail?: string;
  icon: ReactNode;
  name: string;
  onStart: () => void;
}) {
  return (
    <li className="flex items-center gap-2.5 py-1.5 pr-1.5 pl-3">
      <span className="grid size-4 shrink-0 place-items-center [&>*]:size-4 [&>*]:text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">
        {name}
        {detail !== undefined && (
          <span className="ml-2 font-mono text-xs text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
      <GlyphButton onClick={onStart} size="sm">
        Import
      </GlyphButton>
    </li>
  );
}

/** What an import from a website says to the conversation. */
function webPrompt({ name, site }: { name: string; site: string }) {
  return `Import what ${name} knows about me.

Open ${site} and check I am signed in; if I am not, say so and wait for me rather than guessing. Then ask ${name} in a chat to list everything it remembers about me, including anything it has saved about my preferences, my work, and how I like answers written, and read the whole reply.

Bring what it says back to this thread and save the durable facts here as memories, one fact each, in my words where you can. Skip anything that was only about one old conversation, anything you already remember about me, and anything sensitive such as keys, passwords, or payment details. Tell me what you saved and what you left out.`;
}
