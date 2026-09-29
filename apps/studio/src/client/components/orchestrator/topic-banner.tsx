import { XIcon } from "@phosphor-icons/react/X";
import { format } from "date-fns";

import { type AppsBySlug } from "./apps-by-slug";
import { type Chat, type Topic } from "./chats";
import { HoldMarks } from "./hold-marks";
import { TopicMark } from "./topic-mark";
import { TopicActionsButton } from "./topic-menu";

/** How many marks the banner's strip shows before the rest fold into a count: a banner has more room than a row. */
const MARKS_SHOWN = 12;

/**
 * What sits above the rows while the list is filtered to one topic: the
 * topic's mark and name, one line about it, and a strip of what its chats
 * hold as marks, clipped at the banner's edge. The name is said once and the
 * count once, in that line, and only when the topic has no words of its own
 * about what it is for. At its right, the topic's own menu (its details) and
 * the way out of the topic: the banner is the one place that says the list
 * is narrowed, so it is where the narrowing is undone.
 */
export function TopicBanner({
  appsBySlug,
  chats,
  onClear,
  onDetails,
  topic,
}: {
  appsBySlug: AppsBySlug;
  /** The chats filed under the topic, which is what it holds. */
  chats: Chat[];
  /** Takes the topic off the filter, so the list shows every chat again. */
  onClear: () => void;
  onDetails: (topic: Topic) => void;
  topic: Topic;
}) {
  const holds = holdsOf(chats);
  const hasHolds =
    holds.apps.length > 0 || holds.files.length > 0 || holds.sites.length > 0;
  return (
    <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
      <TopicMark size="lg" topic={topic} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm leading-5 font-semibold">{topic.name}</p>
        <p className="truncate text-xs leading-4 text-muted-foreground">
          {topic.about || sinceLine(chats)}
        </p>
        {hasHolds && (
          <HoldMarks
            appsBySlug={appsBySlug}
            className="mt-1.5 -ml-0.5"
            holds={holds}
            shown={MARKS_SHOWN}
            wrap={false}
          />
        )}
      </div>
      <div className="-mt-0.5 -mr-1.5 flex shrink-0 items-center">
        <TopicActionsButton
          className="opacity-100"
          onDetails={onDetails}
          topic={topic}
        />
        <button
          aria-label={`Show all chats, not only ${topic.name}`}
          className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
          onClick={onClear}
          title="Show all chats"
          type="button"
        >
          <XIcon className="size-4" weight="bold" />
        </button>
      </div>
    </div>
  );
}

/**
 * Everything the topic's chats hold, each thing once, with what the newest
 * chat holds first so the strip's front is the topic's latest work.
 */
function holdsOf(chats: Chat[]): Chat["holds"] {
  const newestFirst = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  // A row lists its files newest last and draws them reversed, so the
  // banner's files are gathered oldest first to draw the same way.
  const oldestFirst = newestFirst.toReversed();
  return {
    apps: [...new Set(newestFirst.flatMap((chat) => chat.holds.apps))],
    files: [...new Set(oldestFirst.flatMap((chat) => chat.holds.files))],
    sites: [...new Set(oldestFirst.flatMap((chat) => chat.holds.sites))],
  };
}

/** What the banner says about a topic that says nothing about itself: how much is filed here, and since when. */
function sinceLine(chats: Chat[]): string {
  if (chats.length === 0) {
    return "Nothing filed here yet";
  }
  const since = Math.min(...chats.map((chat) => chat.createdAt));
  const count = `${chats.length} ${chats.length === 1 ? "chat" : "chats"}`;
  return `${count} since ${format(since, "MMM d")}`;
}
