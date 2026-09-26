import {
  composeAtom,
  draftOfGroup,
  windowTabsAtom,
} from "@/client/atoms/orchestrator";
import {
  promptDraftRefAtom,
  setPromptDraftAtom,
} from "@/client/atoms/prompt-value";
import { StoreId } from "@instrument-org/workspace/client";
import { useStore } from "jotai";
import { useContext } from "react";

import { OrchestratorContext } from "./context";

export interface AskAboutSelection {
  /** Where the quote sits in the file, 1-based and inclusive, when the surface knows. */
  lines?: [number, number];
  /** A line of the person's own to go with the quote, when the surface has one. */
  note?: string;
  /** The file the quote is from, by its path on this computer. */
  path: string;
  /** The words picked, as they read on screen. */
  quote: string;
}

/**
 * How a quote reads in a composer: where it is from, then the words as a
 * Markdown quote, then a line of its own for the question. Plain text rather than
 * a chip of its own: the composer's only tokens are skills and apps, the
 * agent reads a quote in the words as well as anything, and the person can
 * trim it to the part they mean before sending.
 */
export function quoteForComposer({
  lines,
  note,
  path,
  quote,
}: AskAboutSelection): string {
  const name = path.split(/[/\\]/).at(-1) ?? path;
  const where =
    lines === undefined
      ? name
      : lines[0] === lines[1]
        ? `${name}, line ${lines[0]}`
        : `${name}, lines ${lines[0]}-${lines[1]}`;
  const quoted = quote
    .trim()
    .split("\n")
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");
  return `From ${where}:\n${quoted}\n${note ? `${note}\n` : ""}`;
}

/**
 * Asks about part of a file: hands the words picked in a document to the
 * conversation that is on screen, or opens one about the file.
 *
 * Where a composer is already up for this window -- the thread beside the
 * tabs, or a draft's window in the corner -- the quote goes on the end of
 * what it holds and the caret follows it, so the question is typed where the
 * person already talks. With none, a new draft opens over the file with the
 * file chosen for it and the quote already in its words.
 */
export function useAskAboutSelection(): (args: AskAboutSelection) => void {
  const orchestrator = useContext(OrchestratorContext);
  const store = useStore();

  return (args) => {
    const text = quoteForComposer(args);
    const { group } = store.get(windowTabsAtom);
    const thread = StoreId.SessionSchema.safeParse(group);
    const draftUp = draftOfGroup(group);
    // The composers that could take it, nearest first: the thread whose
    // group is on screen, a draft whose group is, then the draft windows
    // standing in the corner, newest first.
    const standing = store
      .get(composeAtom)
      .flatMap((entry) =>
        entry.kind === "draft" && entry.placement !== "bar"
          ? [entry.draftId]
          : [],
      )
      .reverse();
    const keys = [
      ...(thread.success
        ? [{ scope: "thread" as const, sessionId: thread.data }]
        : []),
      ...(draftUp === undefined
        ? []
        : [{ id: draftUp, scope: "transient" as const }]),
      ...standing.map((id) => ({ id, scope: "transient" as const })),
    ];
    const key = keys.find((k) => store.get(promptDraftRefAtom(k)) !== null);
    if (key) {
      const editor = store.get(promptDraftRefAtom(key));
      store.set(setPromptDraftAtom, {
        key,
        update: (current) =>
          current.trim() ? `${current.trimEnd()}\n\n${text}` : text,
      });
      editor?.focus();
      editor?.moveCaretToEnd();
      return;
    }
    if (orchestrator?.askAbout) {
      orchestrator.askAbout([{ kind: "file", path: args.path }], text);
    } else {
      orchestrator?.ask(text);
    }
  };
}
