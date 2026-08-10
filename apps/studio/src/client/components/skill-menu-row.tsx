import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { type SkillMatch } from "@/client/lib/skill-search";
import { skillLocationHint, skillSourceLabel } from "@/client/lib/skill-source";
import { SKILL_NAME_MATCH_CLASS_NAME } from "@/client/lib/skill-tokens";
import { type RPCOutput } from "@/client/rpc/client";

/**
 * What a menu needs of a skill to offer it: enough to name it, describe it and
 * say where it came from.
 */
export type ComposerSkill = Pick<
  RPCOutput["workspace"]["skill"]["list"][number],
  | "aliases"
  | "description"
  | "id"
  | "name"
  | "path"
  | "qualifiedName"
  | "source"
  | "title"
>;

/**
 * A skill as every menu that offers one lays it out. The row it sits in belongs
 * to the menu -- an item under the plus button, a button under the caret -- so
 * this is only what goes inside.
 */
export function SkillMenuRow({ match }: { match: SkillMatch<ComposerSkill> }) {
  return (
    <>
      {/* The plain name, even where two sources share it: the source on the
          right is what tells them apart, and reading it there is easier than
          reading a prefix. Choosing the row stores the stable ID. */}
      <span className="shrink-0 font-mono text-sm font-medium">
        /
        <FuzzyHighlight
          matchClassName={SKILL_NAME_MATCH_CLASS_NAME}
          ranges={match.nameRanges}
          text={match.skill.name}
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        <FuzzyHighlight
          ranges={match.descriptionRanges}
          text={match.skill.description}
        />
      </span>
      {/* No delay: this is the answer to "which of these two is it?", and a
          hover that has to be held is no help while scanning the list. */}
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <span className="shrink-0 text-xs text-muted-foreground/70">
            {skillSourceLabel(match.skill.source)}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-80 break-all">
          {skillLocationHint(match.skill)}
        </TooltipContent>
      </Tooltip>
    </>
  );
}
