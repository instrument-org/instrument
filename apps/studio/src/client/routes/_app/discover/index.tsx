import { IdeaSketch } from "@/client/components/window/idea-sketch";
import {
  groupIdeas,
  type Idea,
  ideaHref,
} from "@/client/components/window/ideas";
import { useOnScreen } from "@/client/components/window/on-screen";
import { useIdeas } from "@/client/components/window/use-ideas";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

/**
 * The Discover screen: the kinds of page Instrument can make, each a template
 * of the page skill the app ships, grouped by what the reader arrives with.
 * A tile opens the idea's page, with its examples and a way to ask for one.
 */
export const Route = createFileRoute("/_app/discover/")({
  component: IdeasRoute,
});

function IdeasRoute() {
  useOnScreen({ screen: "discover" });
  const navigate = useNavigate();
  const ideas = useIdeas();
  const groups = groupIdeas(ideas.data ?? []);

  return (
    <div className="@container/ideas h-full min-h-0 overflow-y-auto">
      {/* One centered column with room around it, so the page reads as a
        catalog laid out on the pane rather than a list pinned to its edge. */}
      <div className="mx-auto w-full max-w-5xl px-10 pt-14 pb-20">
        <header className="max-w-xl">
          <h1 className="font-serif text-3xl leading-tight font-normal tracking-tight text-brand-600 dark:text-brand-300">
            Things Instrument can make for you
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
            Each idea is a kind of page Instrument writes from your research.
            Open one for real examples, then ask for your own.
          </p>
        </header>

        <div className="mt-12 space-y-12">
          {ideas.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The registry in this build has no page templates.
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.tag}>
                {/* A quiet label on a hairline: it names the shelf without
                  competing with the cards on it. */}
                <div className="flex items-center gap-3">
                  <h2 className="shrink-0 text-[13px] font-medium text-muted-foreground">
                    {group.label}
                  </h2>
                  <span aria-hidden className="h-px flex-1 bg-border" />
                </div>
                <ul className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 @xl/ideas:grid-cols-2 @4xl/ideas:grid-cols-3">
                  {group.ideas.map((idea) => (
                    <li className="min-w-0" key={idea.name}>
                      <IdeaTile
                        idea={idea}
                        onOpen={() => {
                          void navigate({
                            params: { id: idea.name },
                            to: "/discover/$id",
                          });
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One idea: its name and tagline beside the sketch of its page, which lifts a
 * little on hover the way a card is picked up.
 */
function IdeaTile({ idea, onOpen }: { idea: Idea; onOpen: () => void }) {
  const gestures = useOpenGestures({
    href: ideaHref(idea.name),
    kind: "screen",
  });
  return (
    <button
      // The shadow's own hairline is the card's edge, so there is one line
      // around it rather than a border and a ring doubled up.
      className="group relative flex h-30 w-full items-stretch overflow-hidden rounded-xl bg-card text-left shadow-xs transition-shadow duration-200 hover:shadow-md"
      {...gestures.opening(onOpen)}
      onContextMenu={gestures.onContextMenu}
      type="button"
    >
      <span className="relative z-10 flex min-w-0 flex-1 flex-col justify-center py-4 pr-3 pl-5">
        <span className="line-clamp-2 text-[15px] leading-snug font-medium text-foreground">
          {idea.title}
        </span>
        <span className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
          {idea.tagline}
        </span>
      </span>
      {/* The sketch stands on a pale shelf of the brand's green at the
        card's end, like a page set down on the desk, and lifts a little as
        the card is picked up. */}
      <span className="relative w-30 shrink-0 bg-brand-50/70 dark:bg-brand-500/10">
        <IdeaSketch
          className="absolute top-4 right-3 w-24 rotate-3 drop-shadow-md transition-transform duration-200 group-hover:-translate-y-1 group-hover:rotate-2"
          rows={idea.sketch ?? []}
        />
      </span>
    </button>
  );
}
