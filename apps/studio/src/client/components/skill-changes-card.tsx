import { featuresAtom } from "@/client/atoms/features";
import { InternalLink } from "@/client/components/internal-link";
import { SKILL_LIST_STALE_TIME_MS } from "@/client/lib/skill-query";
import { SKILL_TOKEN_CLASS_NAME } from "@/client/lib/skill-tokens";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { skillMentionLabel } from "@instrument-org/shared/skill-mention";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { CaretRightIcon, GraduationCapIcon } from "@phosphor-icons/react";
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
  const { data: skills = [] } = useQuery(
    rpcClient.workspace.skill.list.queryOptions({
      enabled: features.skills,
      staleTime: SKILL_LIST_STALE_TIME_MS,
    }),
  );

  if (!features.skills) {
    return null;
  }

  // Rendered from the name alone when the list has not caught up yet (or no
  // longer holds the skill), so the card is never missing from the transcript
  // and only its description arrives late.
  const entries = [
    ...data.created.map((name) => ({ name, verb: "Created" })),
    ...data.updated.map((name) => ({ name, verb: "Updated" })),
  ].map((entry) => ({
    ...entry,
    // Matched on the addressable name: a workspace skill keeps its plain one,
    // so a namesake from a vendor directory cannot answer for it here.
    skill: skills.find((skill) => skill.qualifiedName === entry.name),
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
          skill={skill}
          verb={verb}
        />
      ))}
    </div>
  );
}

function SkillChangeRow({
  name,
  skill,
  verb,
}: {
  name: string;
  skill: Skill | undefined;
  verb: string;
}) {
  // Spelled the way the skill is invoked, so the sentence doubles as a hint
  // that /name works in the composer. A skill that opted out of manual
  // invocation gets its bare name, since the slash form would be a lie.
  const label = skill?.userInvocable === false ? name : skillMentionLabel(name);

  return (
    <InternalLink
      className="group/skill flex items-center gap-3 rounded-2xl bg-card px-3 py-3 shadow-xs transition-colors select-none hover:bg-muted/40 dark:border dark:border-black/5 dark:hover:bg-muted/40"
      openInCurrentTab
      params={{ name }}
      to="/skills/$name"
    >
      {/* Portrait, and tall enough to stand level with the sentence plus two
          clamped lines of description beside it. Radius is the card's own less
          its padding, so the two curves sit concentric. */}
      <div className="flex h-14.5 w-11 shrink-0 items-center justify-center rounded-xl bg-foreground/5">
        <GraduationCapIcon className="size-5 text-muted-foreground" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-y-0.5">
        <span className="truncate text-sm leading-5 text-foreground">
          {verb} the <span className={SKILL_TOKEN_CLASS_NAME}>{label}</span>{" "}
          skill
        </span>
        {skill?.description ? (
          <span className="line-clamp-2 text-xs leading-[18px] text-muted-foreground">
            {skill.description}
          </span>
        ) : null}
      </div>
      <CaretRightIcon className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover/skill:text-muted-foreground" />
    </InternalLink>
  );
}
