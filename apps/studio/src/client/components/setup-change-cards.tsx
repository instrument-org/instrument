import { ScreenLink } from "@/client/components/skill-link";
import { AppIcon } from "@/client/components/window/app-icon";
import { memoryHref, skillHref } from "@/client/components/window/tab-location";
import { SKILL_LIST_STALE_TIME_MS } from "@/client/lib/skill-query";
import { rpcClient } from "@/client/rpc/client";
import {
  type SessionMessageDataPart,
  setupChangesHeading,
  setupChangeWord,
} from "@instrument-org/workspace/client";
import { skillMentionLabel } from "@instrument-org/shared/skill-mention";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { CubeIcon } from "@phosphor-icons/react/Cube";
import { FingerprintIcon } from "@phosphor-icons/react/Fingerprint";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import {
  ChangeCard,
  ChangeRow,
  RowGlyph,
  SHOWN_ROWS,
  useChangeCardUndo,
} from "./change-card";
import { type ChangesCard } from "./project-changes-card";

type SetupChange =
  SessionMessageDataPart.SetupChangesDataPart["changes"][number];

const NAME_LINK_CLASS_NAME = "min-w-0 truncate hover:underline";

/** The rows a card shows now, and the Show more that opens the rest. */
function useShown<T>(rows: readonly T[]) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, SHOWN_ROWS);
  return {
    hidden: rows.length - shown.length,
    onShowMore: () => {
      setExpanded(true);
    },
    shown,
  };
}

/** A memory's name as words: `quote-annual-prices` is "Quote annual prices". */
function memoryTitle(name: string): string {
  const words = name.replaceAll("-", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** A memory's first line in quotes, which is the fact when the rest is detail. */
function quoted(text: string): ReactNode {
  return (
    <span className="text-muted-foreground/80">
      “{text.split("\n")[0]?.trim()}”
    </span>
  );
}

/**
 * What a turn saved, changed and forgot in the person's memory, a row per
 * memory with what it now says. Undo forgets what the turn saved and puts
 * back what it changed or forgot, where the memory still says what the turn
 * left; a memory written by hand, with no text recorded, is listed but not
 * taken back.
 */
export function MemoryChangesCard({
  card,
  changes,
  undone: undoneBefore = false,
}: {
  card?: ChangesCard;
  changes: readonly SetupChange[];
  undone?: boolean;
}) {
  const recorded = changes.flatMap((change) =>
    change.memory ? [{ memory: change.memory, name: change.name }] : [],
  );
  const { undo, undone, undoing } = useChangeCardUndo({
    call: () =>
      rpcClient.workspace.memory.undoChanges.call({
        ...(card && { card }),
        changes: recorded,
      }),
    said: {
      all: "Your memories are back the way they were.",
      some: "Your memories are back the way they were, except what you changed since.",
    },
    undoneBefore,
  });
  const { hidden, onShowMore, shown } = useShown(changes);
  return (
    <ChangeCard
      heading={setupChangesHeading("memory", changes)}
      hidden={hidden}
      icon={FingerprintIcon}
      onShowMore={onShowMore}
      slot="memory-changes"
      {...(recorded.length > 0 && {
        undo: {
          busy: undoing,
          onUndo: () => {
            void undo();
          },
        },
      })}
      undone={undone}
    >
      {shown.map((change) => {
        const word = setupChangeWord("memory", change.change);
        const gone = change.change === "removed";
        // What it says now, or what it said when the line says it is gone.
        const text = gone ? change.memory?.before : change.memory?.after;
        const title = memoryTitle(change.name);
        return (
          <ChangeRow
            key={change.name}
            lead={<RowGlyph icon={FingerprintIcon} />}
            lines={[
              {
                key: "said",
                words: text ? (
                  <>
                    {word}: {quoted(text)}
                  </>
                ) : (
                  word
                ),
              },
            ]}
            name={
              gone || undone ? (
                title
              ) : (
                <ScreenLink
                  className={NAME_LINK_CLASS_NAME}
                  href={memoryHref(change.name)}
                >
                  {title}
                </ScreenLink>
              )
            }
            quiet={gone || undone}
            struck={gone || undone}
          />
        );
      })}
    </ChangeCard>
  );
}

/**
 * The skills a turn created, changed or removed, a row per skill by the
 * name the person types it by. There is no Undo: a skill can be several
 * long files, and taking back part of one would break it.
 */
export function SkillChangesCard({
  changes,
}: {
  changes: readonly SetupChange[];
}) {
  // Shares the cache the composer's slash menu fills, so finding a skill is
  // a lookup rather than another walk of every skill source.
  const { data: skills = [] } = useQuery(
    rpcClient.workspace.skill.list.queryOptions({
      staleTime: SKILL_LIST_STALE_TIME_MS,
    }),
  );
  const { hidden, onShowMore, shown } = useShown(changes);
  return (
    <ChangeCard
      heading={setupChangesHeading("skill", changes)}
      hidden={hidden}
      icon={CubeIcon}
      onShowMore={onShowMore}
      slot="skill-changes"
    >
      {shown.map((change) => {
        // The names are folders in the workspace's skills, which `editable` marks.
        const skill = skills.find(
          (each) => each.editable && each.name === change.name,
        );
        // A skill that opted out of being invoked by hand goes by its bare
        // name, since the slash form would say it can be.
        const label =
          skill?.userInvocable === false
            ? change.name
            : skillMentionLabel(change.name);
        const gone = change.change === "removed";
        return (
          <ChangeRow
            key={change.name}
            lead={<RowGlyph icon={CubeIcon} />}
            lines={[
              { key: "done", words: setupChangeWord("skill", change.change) },
            ]}
            name={
              skill && !gone ? (
                <ScreenLink
                  className={NAME_LINK_CLASS_NAME}
                  href={skillHref(skill.id)}
                >
                  {label}
                </ScreenLink>
              ) : (
                label
              )
            }
            quiet={gone}
          />
        );
      })}
    </ChangeCard>
  );
}

/** What an app still needs before it works, in a few words, by its status; nothing for one that works. */
const NEEDS = new Map([
  ["needs-approval", "Needs your approval"],
  ["needs-key", "Needs a key"],
  ["needs-sign-in", "Needs you to sign in"],
]);

/**
 * The apps a turn set up, changed or removed, a row per app with its icon
 * and what it still needs, since a new one usually waits on a sign-in.
 * There is no Undo: removing an app drops its connection too.
 */
export function AppChangesCard({
  changes,
}: {
  changes: readonly SetupChange[];
}) {
  const { data } = useQuery(
    rpcClient.apps.live.list.experimental_liveOptions(),
  );
  const { hidden, onShowMore, shown } = useShown(changes);
  return (
    <ChangeCard
      heading={setupChangesHeading("app", changes)}
      hidden={hidden}
      icon={AppWindowIcon}
      onShowMore={onShowMore}
      slot="app-changes"
    >
      {shown.map((change) => {
        // The row names the app's folder; its page is at the id its file gives.
        const app = data?.apps.find((each) => each.name === change.name);
        const gone = change.change === "removed";
        const needs = app && !gone ? NEEDS.get(app.status) : undefined;
        return (
          <ChangeRow
            key={change.name}
            lead={
              app ? (
                <AppIcon
                  icon={app.icon}
                  name={app.name}
                  site={app.site}
                  size="sm"
                />
              ) : (
                <RowGlyph icon={AppWindowIcon} />
              )
            }
            lines={[
              { key: "done", words: setupChangeWord("app", change.change) },
              ...(needs ? [{ key: "needs", words: needs }] : []),
            ]}
            name={
              app && !gone ? (
                <ScreenLink
                  className={NAME_LINK_CLASS_NAME}
                  href={`/apps/${app.slug}`}
                >
                  {change.name}
                </ScreenLink>
              ) : (
                change.name
              )
            }
            quiet={gone}
          />
        );
      })}
    </ChangeCard>
  );
}
