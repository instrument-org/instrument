import {
  type ChooseOutput,
  QuestionCard,
} from "@/client/components/message-part/tool-choose";
import { Button } from "@/client/components/ui/button";
import { createFileRoute } from "@tanstack/react-router";
import { type ComponentProps, useState } from "react";

export const Route = createFileRoute("/_app/debug/components/question")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug question card" }],
  }),
});

const QUESTION = "Which framework should the dashboard use?";
const CHOICES = ["React", "Vue", "Svelte"];

const variants: {
  description?: string;
  props: Omit<ComponentProps<typeof QuestionCard>, "onAnswer">;
  title: string;
}[] = [
  {
    description: "Between the click and the answer reaching the agent.",
    props: {
      choices: CHOICES,
      isSending: true,
      question: QUESTION,
      status: "open",
    },
    title: "Sending",
  },
  {
    props: {
      choices: CHOICES,
      output: { selectedChoice: "Vue" },
      question: QUESTION,
      status: "closed",
    },
    title: "Picked a choice",
  },
  {
    props: {
      choices: CHOICES,
      output: {
        note: "The team already knows it, and the charts library we like has bindings for it.",
        selectedChoice: "React",
      },
      question: QUESTION,
      status: "closed",
    },
    title: "Picked a choice, with a note",
  },
  {
    props: {
      choices: CHOICES,
      output: { selectedChoice: "Plain HTML and a little Alpine" },
      question: QUESTION,
      status: "closed",
    },
    title: "Answered in their own words",
  },
  {
    props: {
      choices: CHOICES,
      output: {
        note: "Ask me again once we know who is maintaining it.",
        selectedChoice: "Whatever is quickest to build",
      },
      question: QUESTION,
      status: "closed",
    },
    title: "Answered in their own words, with a note",
  },
  {
    props: {
      choices: CHOICES,
      output: { declined: true },
      question: QUESTION,
      status: "closed",
    },
    title: "Skipped",
  },
  {
    props: {
      choices: CHOICES,
      output: { declined: true, note: "Not my call. Check with design first." },
      question: QUESTION,
      status: "closed",
    },
    title: "Skipped, with a note",
  },
  {
    description:
      "The app stopped mid-turn, so nothing is left to take an answer.",
    props: { choices: CHOICES, question: QUESTION, status: "ended" },
    title: "Ended without an answer",
  },
];

function noop() {
  // These questions are already answered or closed, so nothing takes an answer.
}

/** An open question answered here rather than by a session, showing what the answer sends. */
function Playground() {
  const [output, setOutput] = useState<ChooseOutput>();
  // Bumped on reset so the card's own typing and note start empty again.
  const [round, setRound] = useState(0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Open</p>
          <p className="text-xs text-muted-foreground">
            Answer it to see the card close and the output it sends.
          </p>
        </div>
        {output && (
          <Button
            onClick={() => {
              setOutput(undefined);
              setRound((current) => current + 1);
            }}
            size="xs"
            variant="ghost"
          >
            Ask again
          </Button>
        )}
      </div>
      <QuestionCard
        choices={CHOICES}
        key={round}
        onAnswer={setOutput}
        output={output}
        question={QUESTION}
        status={output ? "closed" : "open"}
      />
      {output && (
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
          {JSON.stringify(output, null, 2)}
        </pre>
      )}
    </section>
  );
}

function RouteComponent() {
  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-8">
        <header className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            Components
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Question card
          </h1>
          <p className="text-sm text-muted-foreground">
            What the agent&rsquo;s <code>choose</code> call draws. The user
            picks a choice, writes their own answer, or skips, and can add a
            note to any of them.
          </p>
        </header>

        <div className="flex flex-col gap-10">
          <Playground />
          {variants.map((v) => (
            <section className="flex flex-col gap-3" key={v.title}>
              <div>
                <p className="text-sm font-medium">{v.title}</p>
                {v.description && (
                  <p className="text-xs text-muted-foreground">
                    {v.description}
                  </p>
                )}
              </div>
              <QuestionCard {...v.props} onAnswer={noop} />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
