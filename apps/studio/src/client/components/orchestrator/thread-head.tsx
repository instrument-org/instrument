import { type AppsBySlug } from "./apps-by-slug";
import { HoldsStrip } from "./holds-strip";
import { TopicMark, type TopicMarkSpec } from "./topic-mark";

/** A topic the thread carries, by id, with what it is drawn as. */
export type ThreadTopic = TopicMarkSpec & { id: string; name: string };

/**
 * The head of a thread opened as a screen, which does not scroll: its topics'
 * marks, and the strip of what it has made and used so far, oldest at the
 * left. The title is already in the tab's location row above, so it is not
 * said again here, and a thread with neither topics nor holds has no head.
 */
export function ThreadHead({
  appsBySlug,
  holds,
  topics,
}: {
  appsBySlug: AppsBySlug;
  holds: { apps: string[]; files: string[]; sites: string[] };
  topics: ThreadTopic[];
}) {
  const hasHolds =
    holds.apps.length > 0 || holds.files.length > 0 || holds.sites.length > 0;
  if (topics.length === 0 && !hasHolds) {
    return null;
  }
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-muted/40 px-4 py-2">
      {topics.length > 0 ? (
        <p className="flex shrink-0 items-center gap-1.5">
          {topics.map((topic) => (
            <TopicMark
              className="size-5 rounded-md text-[12px]"
              key={topic.id}
              topic={topic}
            />
          ))}
        </p>
      ) : null}
      {hasHolds ? (
        <HoldsStrip
          appsBySlug={appsBySlug}
          className="min-w-0 flex-1"
          holds={holds}
          size="md"
        />
      ) : null}
    </div>
  );
}
