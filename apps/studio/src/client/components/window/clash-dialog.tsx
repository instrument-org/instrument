import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { type RPCOutput } from "@/client/rpc/client";
import { useId, useRef, useState } from "react";

/** Something whose name is already taken in the folder it is going into. */
export type Clash = RPCOutput["files"]["clashes"]["clashes"][number];

/** What to do with one: keep both, replace what is there, or leave it. */
export type ClashAnswer = "keepBoth" | "replace" | "skip";

/** What the person is doing, as the question names it. */
export type ClashVerb = "copying" | "moving";

type Asking = {
  answers: Record<string, ClashAnswer>;
  at: number;
  clashes: readonly Clash[];
  folder: string;
  settle: (answers: null | Record<string, ClashAnswer>) => void;
  verb: ClashVerb;
};

/**
 * Asks about each thing whose name is taken in the folder it is going into,
 * one at a time and in order, the way the Finder does before it touches
 * anything. `ask` settles with an answer for every one, or with null once
 * the person stops, so nothing at all happens.
 */
export function useClashQuestions() {
  const [asking, setAsking] = useState<Asking | null>(null);
  const ask = (
    clashes: readonly Clash[],
    { folder, verb }: { folder: string; verb: ClashVerb },
  ) =>
    new Promise<null | Record<string, ClashAnswer>>((settle) => {
      setAsking({ answers: {}, at: 0, clashes, folder, settle, verb });
    });
  const dialog = asking ? (
    <ClashDialog
      clash={asking.clashes[asking.at]}
      folder={asking.folder}
      key={asking.at}
      onAnswer={(answer, { toAll }) => {
        const { answers, at } = answerClashes(asking, answer, { toAll });
        if (at >= asking.clashes.length) {
          asking.settle(answers);
          setAsking(null);
        } else {
          setAsking({ ...asking, answers, at });
        }
      }}
      onStop={() => {
        asking.settle(null);
        setAsking(null);
      }}
      remaining={asking.clashes.length - asking.at}
      verb={asking.verb}
    />
  ) : null;
  return { ask, dialog };
}

/**
 * The answers after one is given: to the clash on screen, and with "Apply to
 * all" to every one after it that can take it. Replace is never applied to
 * one that cannot be replaced, which is asked about in its turn.
 */
function answerClashes(
  asking: Pick<Asking, "answers" | "at" | "clashes">,
  answer: ClashAnswer,
  { toAll }: { toAll: boolean },
) {
  const answers = { ...asking.answers };
  let at = asking.at;
  const current = asking.clashes[at];
  if (current) {
    answers[current.path] = answer;
    at += 1;
  }
  if (toAll) {
    for (const clash of asking.clashes.slice(at)) {
      if (answer !== "replace" || clash.replaceable) {
        answers[clash.path] = answer;
      }
    }
  }
  // On to the next one still without an answer.
  while (at < asking.clashes.length) {
    const next = asking.clashes[at];
    if (next && answers[next.path] === undefined) {
      break;
    }
    at += 1;
  }
  return { answers, at };
}

function ClashDialog({
  clash,
  folder,
  onAnswer,
  onStop,
  remaining,
  verb,
}: {
  clash: Clash | undefined;
  folder: string;
  onAnswer: (answer: ClashAnswer, options: { toAll: boolean }) => void;
  onStop: () => void;
  /** How many are still to answer, this one included. */
  remaining: number;
  verb: ClashVerb;
}) {
  const [toAll, setToAll] = useState(false);
  const keepBothRef = useRef<HTMLButtonElement>(null);
  const toAllId = useId();
  if (!clash) {
    return null;
  }
  const several = remaining > 1;
  const isSource = clash.with.by === "source";
  const incoming = clash.kind === "folder" ? "folder" : "one";
  const title = isSource
    ? `You’re ${verb} two items named “${clash.name}”`
    : `“${clash.name}” already exists in “${folder}”`;
  const body = isSource
    ? "Do you want to keep both?"
    : !clash.replaceable
      ? `It’s one of the items you’re ${verb}, or holds one, so you can keep both or skip this one.`
      : clash.with.kind === "folder" && clash.kind !== "folder"
        ? `Do you want to replace the folder with the ${incoming} you’re ${verb}?`
        : `Do you want to replace it with the ${incoming} you’re ${verb}?`;
  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          onStop();
        }
      }}
      open
    >
      <AlertDialogContent
        // Keep Both under Return, since it loses nothing; Escape stops.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          keepBothRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        {several ? (
          <label
            className="flex items-center gap-2 text-sm text-muted-foreground"
            htmlFor={toAllId}
          >
            <Checkbox
              checked={toAll}
              id={toAllId}
              onCheckedChange={(checked) => {
                setToAll(checked === true);
              }}
            />
            Apply to all ({remaining})
          </label>
        ) : null}
        <AlertDialogFooter>
          <Button onClick={onStop} variant="outline">
            Stop
          </Button>
          {several || !clash.replaceable ? (
            <Button
              onClick={() => {
                onAnswer("skip", { toAll });
              }}
              variant="outline"
            >
              Skip
            </Button>
          ) : null}
          {clash.replaceable ? (
            <Button
              onClick={() => {
                onAnswer("replace", { toAll });
              }}
              variant="outline"
            >
              Replace
            </Button>
          ) : null}
          <Button
            onClick={() => {
              onAnswer("keepBoth", { toAll });
            }}
            ref={keepBothRef}
          >
            Keep Both
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
