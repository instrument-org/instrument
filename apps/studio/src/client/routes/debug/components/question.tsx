import {
  type ChooseOutput,
  QuestionCard,
} from "@/client/components/message-part/tool-choose";
import { Button } from "@/client/components/ui/button";
import { type ChooseQuestion } from "@instrument-org/workspace/client";
import { createFileRoute } from "@tanstack/react-router";
import { type ComponentProps, useState } from "react";

export const Route = createFileRoute("/debug/components/question")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug question card" }],
  }),
});

const ONE: ChooseQuestion[] = [
  {
    choices: [
      { label: "React" },
      { description: "Lighter, and the team has used it", label: "Vue" },
      { label: "Svelte" },
    ],
    header: "Framework",
    question: "Which framework should the dashboard use?",
  },
];

const SEVERAL: ChooseQuestion[] = [
  {
    choices: [
      { description: "Where most of your customers are", label: "10 agents" },
      { description: "Where Zendesk's tiers change", label: "25 agents" },
      { description: "Where volume discounts start", label: "50 agents" },
    ],
    header: "Team size",
    question: "Which team size should I compare prices at?",
  },
  {
    choices: [
      { description: "What every competitor leads with", label: "Annual" },
      { description: "What new teams usually start on", label: "Monthly" },
    ],
    header: "Billing",
    question: "Should I use annual or monthly prices?",
  },
  {
    choices: [
      { label: "Zendesk" },
      { label: "Intercom" },
      { label: "Freshdesk" },
      { label: "Help Scout" },
    ],
    header: "Competitors",
    multiSelect: true,
    question: "Which competitors should go in the table?",
  },
];

const variants: {
  description?: string;
  props: Omit<ComponentProps<typeof QuestionCard>, "onAnswer">;
  title: string;
}[] = [
  {
    description: "Between Send and the answer reaching the agent.",
    props: {
      questions: ONE,
      sending: { replies: [{ picked: ["Vue"] }] },
      status: "open",
    },
    title: "Sending",
  },
  {
    props: {
      output: { replies: [{ picked: ["Vue"] }] },
      questions: ONE,
      status: "closed",
    },
    title: "Picked a choice",
  },
  {
    props: {
      output: {
        note: "The team already knows it, and the charts library we like has bindings for it.",
        replies: [{ picked: ["React"] }],
      },
      questions: ONE,
      status: "closed",
    },
    title: "Picked a choice, with a note",
  },
  {
    props: {
      output: { replies: [{ picked: ["Plain HTML and a little Alpine"] }] },
      questions: ONE,
      status: "closed",
    },
    title: "Answered in their own words",
  },
  {
    props: {
      output: {
        note: "Not my call. Check with design first.",
        replies: [{ skipped: true }],
      },
      questions: ONE,
      status: "closed",
    },
    title: "Skipped, with a note",
  },
  {
    props: {
      output: {
        note: "Use list prices, not the promo ones on Intercom's page.",
        replies: [
          { picked: ["10 agents"] },
          { skipped: true },
          { picked: ["Zendesk", "Intercom", "Freshdesk"] },
        ],
      },
      questions: SEVERAL,
      status: "closed",
    },
    title: "Several answered",
  },
  {
    description:
      "The person wrote in the chat instead, so nothing is left to take an answer.",
    props: { questions: SEVERAL, status: "ended" },
    title: "Ended without an answer",
  },
];

function noop() {
  // These cards are already answered or closed, so nothing takes an answer.
}

/**
 * How long the playground holds an answer as sending before it lands, standing
 * in for the round trip to the agent.
 */
const SEND_DELAY_MS = 1200;

/** An open card answered here rather than by a session, showing what the answer sends. */
function Playground({
  questions,
  title,
}: {
  questions: ChooseQuestion[];
  title: string;
}) {
  const [output, setOutput] = useState<ChooseOutput>();
  const [sending, setSending] = useState<ChooseOutput>();
  // Bumped on reset so the card's own picks and note start empty again.
  const [round, setRound] = useState(0);

  const answer = (answered: ChooseOutput) => {
    setSending(answered);
    setTimeout(() => {
      setSending(undefined);
      setOutput(answered);
    }, SEND_DELAY_MS);
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">
            Answer it to see the card send, then close, and the output it sends.
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
        key={round}
        onAnswer={answer}
        output={output}
        questions={questions}
        sending={sending}
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
            picks a choice, writes their own answer, or skips each question, can
            add a note, and sends them all together.
          </p>
        </header>

        <div className="flex flex-col gap-10">
          <Playground questions={ONE} title="One question" />
          <Playground questions={SEVERAL} title="Several questions" />
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
