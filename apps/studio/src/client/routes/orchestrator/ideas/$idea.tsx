import { useOrchestrator } from "@/client/components/orchestrator/context";
import { GlyphButton } from "@/client/components/orchestrator/glyph-button";
import {
  exampleLabel,
  exampleSubject,
  type IdeaExample,
  ideaTitleOf,
} from "@/client/components/orchestrator/ideas";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { useIdeas } from "@/client/components/orchestrator/use-ideas";
import { getComputerFileUrl } from "@/client/lib/computer-file-url";
import { fileUrlOf } from "@/client/lib/file-url";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

/**
 * One idea's page, laid out as the website's is: what the kind of page is
 * for in two lines, its examples as pictures that open the real page in a
 * tab, and beside them the way to ask for one of your own. The button is a
 * message to the conversation, since Instrument makes it.
 */
export const Route = createFileRoute("/orchestrator/ideas/$idea")({
  component: IdeaRoute,
});

/**
 * A page's picture, cut at the top the way a page in a window is, or its name
 * on a plain card when the registry carries no picture of it.
 */
function ExampleCard({
  example,
  onOpen,
}: {
  example: IdeaExample;
  onOpen: () => void;
}) {
  return (
    <button
      className="group block w-full min-w-0 text-left"
      onClick={onOpen}
      type="button"
    >
      <span className="block aspect-2/3 overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-shadow group-hover:shadow-md">
        {example.capture ? (
          // The label under it names the page; the picture adds nothing a
          // reader of the name needs.
          <img
            alt=""
            className="pointer-events-none h-full w-full object-cover object-top select-none"
            draggable={false}
            src={getComputerFileUrl({
              hostPath: example.capture.path,
              version: example.capture.version,
            })}
          />
        ) : (
          <span className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {example.title}
          </span>
        )}
      </span>
      <span className="mt-2 block text-xs leading-snug text-foreground/80 group-hover:text-foreground">
        {exampleLabel(example)}
      </span>
      {exampleSubject(example) ? (
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {exampleSubject(example)}
        </span>
      ) : null}
    </button>
  );
}

function IdeaRoute() {
  const { idea: name } = Route.useParams();
  const { ask, openPage } = useOrchestrator();
  const ideas = useIdeas();
  const idea = ideas.data?.find((entry) => entry.name === name);
  const [subject, setSubject] = useState("");
  // The conversation is told which kind of page is up, so "one of these
  // about X" typed there lands on the same template the form below names.
  useOnScreen({
    screen: "ideas",
    ...(idea
      ? { idea: { name: idea.name, tagline: idea.tagline, title: idea.title } }
      : {}),
  });

  if (ideas.data && !idea) {
    return (
      <div className="flex h-full flex-col px-8 pt-6">
        <h1 className="text-xl font-semibold">{ideaTitleOf(name)}</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          The registry in this build has no page template by that name.
        </p>
      </div>
    );
  }
  if (!idea) {
    return null;
  }

  const kind = idea.title.toLowerCase();
  const makeOne = () => {
    const about = subject.trim();
    ask(about ? `Make a ${kind} about ${about}` : `Make a ${kind}`);
    setSubject("");
  };

  return (
    <div className="@container/idea flex h-full min-h-0 flex-col overflow-y-auto px-8 pt-6 pb-10">
      <div className="grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-8 @3xl/idea:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{idea.title}</h1>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">
            {idea.tagline}
          </p>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            <span className="font-medium text-foreground/80">For when </span>
            {idea.when.charAt(0).toLowerCase() + idea.when.slice(1)}
          </p>

          {idea.examples.length > 0 ? (
            <section className="mt-8">
              <h2 className="text-lg font-medium text-muted-foreground">
                {idea.examples.length === 3
                  ? "Three examples"
                  : idea.examples.length === 1
                    ? "An example"
                    : `${idea.examples.length} examples`}
              </h2>
              <ul className="mt-3 grid grid-cols-2 gap-4 @2xl/idea:grid-cols-3">
                {idea.examples.map((example) => (
                  <li className="min-w-0" key={example.name}>
                    <ExampleCard
                      example={example}
                      onOpen={() => {
                        // The page itself, in a tab of its own: a browser
                        // guest at the file's address, the way any page the
                        // app makes is opened.
                        openPage(fileUrlOf(example.htmlPath), { newTab: true });
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="min-w-0 @3xl/idea:pt-1">
          <form
            className="rounded-2xl border border-border bg-card p-4 shadow-xs"
            onSubmit={(event) => {
              event.preventDefault();
              makeOne();
            }}
          >
            <p className="text-sm font-semibold">Use this idea</p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              Tell Instrument what yours is about, and it makes one like these.
            </p>
            <input
              aria-label="What it is about"
              className="mt-3 h-9 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/30"
              onChange={(event) => {
                setSubject(event.target.value);
              }}
              placeholder="What it is about"
              value={subject}
            />
            <GlyphButton className="mt-3 w-full" type="submit">
              Make one
            </GlyphButton>
          </form>
        </aside>
      </div>
    </div>
  );
}
