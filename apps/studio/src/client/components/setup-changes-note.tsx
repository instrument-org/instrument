import { SkillLink } from "@/client/components/skill-link";
import { SKILL_LIST_STALE_TIME_MS } from "@/client/lib/skill-query";
import { SKILL_TOKEN_CLASS_NAME } from "@/client/lib/skill-tokens";
import { rpcClient } from "@/client/rpc/client";
import { skillMentionLabel } from "@instrument-org/shared/skill-mention";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { BrainIcon } from "@phosphor-icons/react/Brain";
import { CubeIcon } from "@phosphor-icons/react/Cube";
import { useQuery } from "@tanstack/react-query";

type SetupChange =
  SessionMessageDataPart.SetupChangesDataPart["changes"][number];

/**
 * What a turn did to the person's skills, apps and memories, a line each, in
 * the voice of the other notes under a reply. Only the turn's own writes are
 * here, so each line is something this chat did.
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

/** The skills a chat from an earlier build recorded, drawn as the same lines. */
export function skillChangesAsSetupChanges(
  data: SessionMessageDataPart.SkillChangesDataPart,
): SetupChange[] {
  return [
    ...data.created.map(
      (name): SetupChange => ({ change: "added", kind: "skill", name }),
    ),
    ...data.updated
      .filter((name) => !data.created.includes(name))
      .map((name): SetupChange => ({ change: "changed", kind: "skill", name })),
  ];
}

const ICONS = {
  app: AppWindowIcon,
  memory: BrainIcon,
  skill: CubeIcon,
} as const;

function SetupChangeLine({ change }: { change: SetupChange }) {
  const Icon = ICONS[change.kind];
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0">
        {change.kind === "skill" ? (
          <SkillSentence change={change} />
        ) : change.kind === "app" ? (
          appSentence(change)
        ) : (
          memorySentence(change)
        )}
      </span>
    </p>
  );
}

function appSentence({ change, name }: SetupChange) {
  return change === "added"
    ? `Set up the ${name} app.`
    : change === "changed"
      ? `Updated the ${name} app.`
      : `Removed the ${name} app.`;
}

function memorySentence({ change, name }: SetupChange) {
  return change === "added"
    ? `Saved “${name}” to your memories.`
    : change === "changed"
      ? `Updated “${name}” in your memories.`
      : `Forgot “${name}”.`;
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
  // A skill that opted out of being invoked by hand gets its bare name, since
  // the slash form would say it can be.
  const label =
    skill?.userInvocable === false
      ? skill.name
      : skillMentionLabel(skill?.name ?? change.name);
  const token = <span className={SKILL_TOKEN_CLASS_NAME}>{label}</span>;
  if (change.change === "removed") {
    return <>Removed the {label} skill.</>;
  }
  return (
    <>
      {change.change === "added" ? "Created the " : "Updated the "}
      {skill ? (
        <SkillLink className="inline" name={skill.id}>
          {token}
        </SkillLink>
      ) : (
        token
      )}{" "}
      skill.
    </>
  );
}
