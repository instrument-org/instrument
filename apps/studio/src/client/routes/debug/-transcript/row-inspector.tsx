import { cn } from "@/client/lib/utils";
import {
  type StoreId,
  type TranscriptMessage,
  type Turn,
  turnsOf,
} from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { type RefObject, useEffect, useMemo, useState } from "react";

import { Button } from "@/client/components/ui/button";

import { type Frame } from "./frames";

type RawParts = readonly Frame["messages"][number]["parts"][number][];

/** What the row under the pointer is: a name to say out loud, and what it was drawn from. */
function describeRow(
  id: string,
  turns: readonly Turn[],
  rawParts: RawParts,
): { data: unknown; name: string } | undefined {
  const raw = (partId: string) =>
    rawParts.find((part) => part.metadata.id === partId);
  const [kind, turnId] = id.split(":");
  const turn = turnId ? turns.find((each) => each.id === turnId) : undefined;
  if (turn) {
    switch (kind) {
      case "footer": {
        return {
          data: turn.replies.map((reply) => reply.metadata),
          name: "Footer",
        };
      }
      case "message": {
        return { data: turn.opener, name: "Message" };
      }
      case "thinking": {
        return { data: turn.live, name: "Thinking" };
      }
      case "worked": {
        return {
          data: {
            apps: turn.apps,
            folded: turn.rows
              .filter((row) => turn.foldedRowIds.has(row.id))
              .map((row) => `${row.kind} ${row.id}`),
            foldsWhenDone: turn.foldsWhenDone,
            phase: turn.phase,
            sites: turn.sites,
            summary: turn.summary,
            workedMs: turn.workedMs,
          },
          name: "Worked row",
        };
      }
    }
  }
  for (const each of turns) {
    const note = each.opener?.notes.find((part) => part.metadata.id === id);
    if (note) {
      return { data: note, name: note.type };
    }
    for (const row of each.rows) {
      if (row.kind === "activity") {
        const step = row.steps.find((one) => one.metadata.id === id);
        if (step && step.metadata.id !== row.id) {
          return {
            data: { part: raw(step.metadata.id), step },
            name: `Step · ${step.explanation ?? step.tool}`,
          };
        }
      }
      if (row.id !== id) {
        continue;
      }
      const isFolded = each.foldedRowIds.has(row.id);
      switch (row.kind) {
        case "activity": {
          return {
            data: {
              isFolded,
              parts: row.steps.map((step) => raw(step.metadata.id)),
              row,
            },
            name: `Activity · ${row.title ?? "unnamed"}`,
          };
        }
        case "note": {
          return { data: row.part, name: row.part.type };
        }
        case "text": {
          return {
            data: { isFolded, part: row.part },
            name: "Words",
          };
        }
        default: {
          return { data: { isFolded, row }, name: row.kind };
        }
      }
    }
  }
  return undefined;
}

/**
 * The data under what the pointer is on, in the page's side panel, so a row can
 * be talked about by what it is. It keeps the last row when the pointer leaves
 * for the panel, and it owns its own state so hovering never redraws the
 * transcript being measured.
 */
export function RowInspector({
  className,
  frame,
  isDeveloperMode,
  messages,
  sessionId,
  transcript,
}: {
  className?: string;
  frame: Frame;
  isDeveloperMode: boolean;
  messages: readonly TranscriptMessage[];
  sessionId: StoreId.Session | undefined;
  transcript: RefObject<HTMLElement | null>;
}) {
  const [id, setId] = useState<string>();
  const [wasCopied, setWasCopied] = useState(false);

  useEffect(() => {
    const element = transcript.current;
    if (!element) {
      return;
    }
    let marked: Element | undefined;
    const onOver = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      const row = event.target.closest("[data-transcript-row]");
      const next = row?.getAttribute("data-transcript-row");
      if (!row || !next) {
        return;
      }
      marked?.removeAttribute("data-inspected");
      row.setAttribute("data-inspected", "");
      marked = row;
      setId(next);
    };
    element.addEventListener("pointerover", onOver);
    return () => {
      element.removeEventListener("pointerover", onOver);
      marked?.removeAttribute("data-inspected");
    };
  }, [transcript]);

  const found = useMemo(() => {
    if (id === undefined) {
      return undefined;
    }
    const turns = turnsOf(messages, {
      isDeveloperMode,
      isRunning: frame.isAgentRunning,
      sessionId,
    });
    return describeRow(
      id,
      turns,
      frame.messages.flatMap((message) => message.parts),
    );
  }, [
    frame.isAgentRunning,
    frame.messages,
    id,
    isDeveloperMode,
    messages,
    sessionId,
  ]);
  const json = found ? JSON.stringify(found.data, null, 2) : undefined;

  return (
    <section className={cn("flex min-h-0 flex-col border-t", className)}>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b pr-1 pl-3">
        <h3 className="min-w-0 truncate text-xs font-medium">
          {found?.name ?? "Hover a row to see its data"}
        </h3>
        {json !== undefined && (
          <Button
            aria-label="Copy"
            className="ml-auto"
            onClick={() => {
              void navigator.clipboard.writeText(json);
              setWasCopied(true);
              setTimeout(() => {
                setWasCopied(false);
              }, 1200);
            }}
            size="icon-sm"
            variant="ghost"
          >
            {wasCopied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        )}
      </div>
      {json !== undefined && (
        <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-4 wrap-break-word whitespace-pre-wrap text-muted-foreground">
          {json}
        </pre>
      )}
    </section>
  );
}
