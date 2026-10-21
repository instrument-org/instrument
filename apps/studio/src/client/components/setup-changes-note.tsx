import { openTopicDetails } from "@/client/atoms/topic-details-modal";
import { ScreenLink } from "@/client/components/skill-link";
import { memoryHref, skillHref } from "@/client/components/window/tab-location";
import { SKILL_LIST_STALE_TIME_MS } from "@/client/lib/skill-query";
import { SKILL_TOKEN_CLASS_NAME } from "@/client/lib/skill-tokens";
import { rpcClient } from "@/client/rpc/client";
import {
  type SessionMessageDataPart,
  setupChangeSentence,
} from "@instrument-org/workspace/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { BrainIcon } from "@phosphor-icons/react/Brain";
import { CubeIcon } from "@phosphor-icons/react/Cube";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

import { TopicPill } from "./window/chat-row";

type SetupChange =
  SessionMessageDataPart.SetupChangesDataPart["changes"][number];

/**
 * What a turn did to the person's skills, apps, topics and memories, a line
 * each, in the voice of the other notes under a reply. Only the turn's own
 * writes are here, so each line is something this chat did. The name in a
 * line opens the item, unless the line says it is gone.
 */
export function SetupChangesNote({ changes }: { changes: SetupChange[] }) {
  return (
    <div className="mt-2 flex flex-col gap-1">
      {changes.map((change) => (
        <SetupChangeLine
          change={change}
          key={`${change.kind}:${change.name}`}
        />
      ))}
    </div>
  );
}

// A topic has no icon of its own: its line wears the topic's pill.
const ICONS = {
  app: AppWindowIcon,
  memory: BrainIcon,
  skill: CubeIcon,
  topic: undefined,
} as const;

const LINK_CLASS_NAME =
  "inline font-medium text-foreground underline-offset-2 hover:underline";

function SetupChangeLine({ change }: { change: SetupChange }) {
  const Icon = ICONS[change.kind];
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {Icon && <Icon className="size-3.5 shrink-0" />}
      <span className="min-w-0">
        {change.kind === "app" ? (
          <AppSentence change={change} />
        ) : change.kind === "memory" ? (
          <Sentence
            change={change}
            link={(label) => (
              <ScreenLink
                className={LINK_CLASS_NAME}
                href={memoryHref(change.name)}
              >
                {label}
              </ScreenLink>
            )}
          />
        ) : change.kind === "skill" ? (
          <SkillSentence change={change} />
        ) : (
          <TopicSentence change={change} />
        )}
      </span>
    </p>
  );
}

/**
 * The line `setupChangeSentence` words, with the item's name drawn by
 * `link` while the item is still there.
 */
function Sentence({
  change,
  label,
  link,
}: {
  change: SetupChange;
  label?: string;
  link?: (label: ReactNode) => ReactNode;
}) {
  const sentence = setupChangeSentence(change, label ? { label } : {});
  return (
    <>
      {sentence.before}
      {link && change.change !== "removed"
        ? link(sentence.label)
        : sentence.label}
      {sentence.after}
    </>
  );
}

function AppSentence({ change }: { change: SetupChange }) {
  const { data } = useQuery(
    rpcClient.apps.live.list.experimental_liveOptions(),
  );
  // The line names the app's folder; its page is at the id its file gives.
  const app = data?.apps.find((each) => each.name === change.name);
  return (
    <Sentence
      change={change}
      {...(app && {
        link: (label) => (
          <ScreenLink className={LINK_CLASS_NAME} href={`/apps/${app.slug}`}>
            {label}
          </ScreenLink>
        ),
      })}
    />
  );
}

function SkillSentence({ change }: { change: SetupChange }) {
  // Shares the cache the composer's slash menu fills, so finding the skill is
  // a lookup rather than another walk of every skill source.
  const { data: skills = [] } = useQuery(
    rpcClient.workspace.skill.list.queryOptions({
      staleTime: SKILL_LIST_STALE_TIME_MS,
    }),
  );
  // The names are folders in the workspace's skills, which `editable` marks.
  const skill = skills.find(
    (each) => each.editable && each.name === change.name,
  );
  return (
    <Sentence
      change={change}
      // A skill that opted out of being invoked by hand gets its bare name,
      // since the slash form would say it can be.
      {...(skill?.userInvocable === false && { label: skill.name })}
      link={(label) => {
        const token = <span className={SKILL_TOKEN_CLASS_NAME}>{label}</span>;
        return skill ? (
          <ScreenLink className="inline" href={skillHref(skill.id)}>
            {token}
          </ScreenLink>
        ) : (
          token
        );
      }}
    />
  );
}

function TopicSentence({ change }: { change: SetupChange }) {
  const { data: topics = [] } = useQuery(
    rpcClient.workspace.topics.list.queryOptions(),
  );
  // The line names the topic's folder, which is its name.
  const topic = topics.find(
    (each) => each.name === change.name && !each.retired,
  );
  return (
    <Sentence
      change={change}
      {...(topic && {
        link: () => (
          <button
            className="inline-flex align-middle"
            onClick={() => {
              openTopicDetails(topic.id);
            }}
            type="button"
          >
            <TopicPill topic={topic} />
          </button>
        ),
      })}
    />
  );
}
