import { IdeaSketch } from "@/client/components/orchestrator/idea-sketch";
import {
  groupIdeas,
  type Idea,
  ideaHref,
} from "@/client/components/orchestrator/ideas";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { useIdeas } from "@/client/components/orchestrator/use-ideas";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

/**
 * The Ideas screen: the kinds of page Instrument can make, each a template
 * of the page skill the app ships, grouped by what the reader arrives with.
 * A tile opens the idea's page, with its examples and a way to ask for one.
 */
export const Route = createFileRoute("/orchestrator/ideas/")({
  component: IdeasRoute,
});

function IdeasRoute() {
  useOnScreen({ screen: "ideas" });
  const navigate = useNavigate();
  const ideas = useIdeas();
  const groups = groupIdeas(ideas.data ?? []);

  return (
    <div className="@container/ideas flex h-full min-h-0 flex-col overflow-y-auto px-8 pt-6 pb-10">
      <h1 className="text-xl font-semibold">
        Things Instrument can make for you
      </h1>
      <p className="mt-1 max-w-lg text-sm text-muted-foreground">
        Each idea is a kind of page Instrument writes from your research. Open
        one for real examples, then ask for your own.
      </p>

      <div className="mt-6 max-w-5xl space-y-8">
        {ideas.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            The registry in this build has no page templates.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.tag}>
              <h2 className="text-lg font-medium text-muted-foreground">
                {group.label}
              </h2>
              <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 @xl/ideas:grid-cols-2 @4xl/ideas:grid-cols-3">
                {group.ideas.map((idea) => (
                  <li className="min-w-0" key={idea.name}>
                    <IdeaTile
                      idea={idea}
                      onOpen={() => {
                        void navigate({
                          params: { idea: idea.name },
                          to: "/orchestrator/ideas/$idea",
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
      className="group relative flex h-32 w-full items-center overflow-hidden rounded-2xl border border-border bg-card pl-5 text-left shadow-xs transition-shadow hover:shadow-md"
      onAuxClick={gestures.onAuxClick}
      onClick={onOpen}
      onContextMenu={gestures.onContextMenu}
      type="button"
    >
      <span className="relative z-10 min-w-0 flex-1 pr-3">
        <span className="block text-base font-semibold text-foreground">
          {idea.title}
        </span>
        <span className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
          {idea.tagline}
        </span>
      </span>
      <span className="relative h-full w-28 shrink-0">
        <IdeaSketch
          className="absolute top-4 right-3 w-24 rotate-3 drop-shadow-md transition-transform group-hover:-translate-y-1 group-hover:rotate-2"
          rows={idea.sketch ?? []}
        />
      </span>
    </button>
  );
}
