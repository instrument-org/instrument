import { featuresAtom } from "@/client/atoms/features";
import { InternalLink } from "@/client/components/internal-link";
import { SKILL_LIST_STALE_TIME_MS } from "@/client/lib/skill-query";
import { SKILL_TOKEN_CLASS_NAME } from "@/client/lib/skill-tokens";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { skillMentionLabel } from "@instrument-org/shared/skill-mention";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { GraduationCapIcon } from "@phosphor-icons/react/GraduationCap";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";

type Skill = RPCOutput["workspace"]["skill"]["list"][number];

export function SkillChangesCard({
  className,
  data,
}: {
  className?: string;
  data: SessionMessageDataPart.SkillChangesDataPart;
}) {
  const features = useAtomValue(featuresAtom);
  // Shares the cache the composer's slash menu fills, so the title and
  // description are a lookup rather than another walk of every skill source.
  const { data: skills = [], isSuccess } = useQuery(
    rpcClient.workspace.skill.list.queryOptions({
      enabled: features.skills,
      staleTime: SKILL_LIST_STALE_TIME_MS,
    }),
  );

  if (!features.skills) {
    return null;
  }

  // Rendered from the name alone until the list resolves, so the card is never
  // missing from the transcript and only its description arrives late.
  const entries = [
    ...data.created.map((name) => ({ name, verb: "Created" })),
    ...data.updated.map((name) => ({ name, verb: "Updated" })),
  ].map((entry) => ({
    ...entry,
    // These names are directories in the writable `/skills` mount, which is
    // where the agent wrote them and what `editable` marks.
    skill: skills.find((skill) => skill.editable && skill.name === entry.name),
  }));

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {entries.map(({ name, skill, verb }) => (
        <SkillChangeRow
          key={`${verb}:${name}`}
          name={name}
          resolved={isSuccess}
          skill={skill}
          verb={verb}
        />
      ))}
    </div>
  );
}

const CARD_CLASS_NAME =
  "flex items-center gap-3 rounded-2xl bg-card px-3 py-3 shadow-xs dark:border dark:border-black/5";

/* Portrait, and tall enough to stand level with the sentence plus two clamped
   lines of description beside it. Radius is the card's own less its padding, so
   the two curves sit concentric. */
const TILE_CLASS_NAME =
  "flex h-14.5 w-11 shrink-0 items-center justify-center rounded-xl bg-foreground/5";

function SkillChangeRow({
  name,
  resolved,
  skill,
  verb,
}: {
  name: string;
  resolved: boolean;
  skill: Skill | undefined;
  verb: string;
}) {
  // A skill can outlive the turn that wrote it: the transcript keeps the card
  // long after someone deletes the skill. Say so and stop linking rather than
  // sending them to a page that only reports the same absence. Until the list
  // resolves, a name it does not carry is unknown rather than gone.
  const isMissing = resolved && !skill;

  // Keep the sentence human-readable while the link below carries the stable
  // target. A skill that opted out of manual invocation gets its bare name,
  // since the slash form would be a lie.
  const addressableName = skill?.id ?? name;
  const label =
    skill?.userInvocable === false
      ? skill.name
      : skillMentionLabel(skill?.name ?? name);

  const body = (
    <>
      <div className={cn(TILE_CLASS_NAME, isMissing && "opacity-50")}>
        <GraduationCapIcon className="size-5 text-muted-foreground" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-y-0.5">
        <span
          className={cn(
            "truncate text-sm leading-5",
            isMissing ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {verb} the{" "}
          <span
            className={cn(SKILL_TOKEN_CLASS_NAME, isMissing && "opacity-70")}
          >
            {label}
          </span>{" "}
          skill
        </span>
        {isMissing ? (
          <span className="text-xs leading-[18px] text-muted-foreground">
            No longer available in this workspace
          </span>
        ) : skill?.description ? (
          <span className="line-clamp-2 text-xs leading-[18px] text-muted-foreground">
            {skill.description}
          </span>
        ) : null}
      </div>
    </>
  );

  if (isMissing) {
    return <div className={CARD_CLASS_NAME}>{body}</div>;
  }

  return (
    <InternalLink
      className={cn(
        CARD_CLASS_NAME,
        "group/skill select-none hover:bg-muted/40 dark:hover:bg-muted/40",
      )}
      openInCurrentTab
      params={{ name: addressableName }}
      to="/skills/$name"
    >
      {body}
      <CaretRightIcon className="size-4 shrink-0 text-muted-foreground/40 group-hover/skill:text-muted-foreground" />
    </InternalLink>
  );
}
