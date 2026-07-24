import { openCreateSkill } from "@/client/atoms/skill-modal";
import { CopyButton } from "@/client/components/copy-button";
import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import { InternalLink } from "@/client/components/internal-link";
import { RevealPath } from "@/client/components/reveal-path";
import { SkillBadges } from "@/client/components/skill-badges";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { matchSkills } from "@/client/lib/skill-search";
import { isProvidedSource, skillSourceLabel } from "@/client/lib/skill-source";
import { SKILL_TOKEN_CLASS_NAME } from "@/client/lib/skill-tokens";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import {
  FilesIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useDeferredValue } from "react";
import { z } from "zod";

const skillsSearchSchema = z.object({
  q: z.string().optional().default(""),
});

export const Route = createFileRoute("/_app/skills/")({
  component: SkillsPage,
  head: () => ({ meta: [{ title: "Skills" }] }),
  staticData: { tabIcon: "graduation-cap" },
  validateSearch: skillsSearchSchema,
});

type Skill = RPCOutput["workspace"]["skill"]["list"][number];

// The name is already bold, so a matched run reads as a color shift instead of
// extra weight, reusing the same brown that marks a skill mention elsewhere.
const NAME_MATCH_CLASS_NAME = cn("bg-transparent", SKILL_TOKEN_CLASS_NAME);

// Where a group sits in the list. The user's own workspace first, since it is
// the one they author; then Instrument's provided skills; then skills found in
// the folders other agents keep theirs in.
const SOURCE_RANK: Record<Skill["source"], number> = {
  agents: 3,
  antigravity: 3,
  claude: 3,
  codex: 3,
  copilot: 3,
  cursor: 3,
  gemini: 3,
  goose: 3,
  kiro: 3,
  opencode: 3,
  registry: 1,
  system: 1,
  windsurf: 3,
  workspace: 0,
};

// Every skill has a SKILL.md, so a count of one says nothing; what is worth
// knowing at a glance is that a skill brings scripts and references with it.
function fileCountLabel({ fileCount, filesTruncated }: Skill) {
  return `${fileCount}${filesTruncated ? "+" : ""} files`;
}

function groupSkills(skills: Skill[]) {
  const groups = new Map<
    string,
    { dirs: Set<string>; skills: Skill[]; source: Skill["source"] }
  >();

  for (const skill of skills) {
    const dir = parentDir(skill.path);
    // Skills group under their source's name, not their folder, so one vendor's
    // skills read as a single section however many folders they span.
    const key = skillSourceLabel(skill.source);
    const group = groups.get(key);
    if (group) {
      group.dirs.add(dir);
      group.skills.push(skill);
      continue;
    }
    groups.set(key, {
      dirs: new Set([dir]),
      skills: [skill],
      source: skill.source,
    });
  }

  return [...groups.entries()]
    .map(([key, group]) => ({
      dirs: [...group.dirs].sort(),
      key,
      label: skillSourceLabel(group.source),
      skills: group.skills.sort((a, b) => a.name.localeCompare(b.name)),
      source: group.source,
    }))
    .sort(
      (a, b) =>
        SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
        a.key.localeCompare(b.key),
    );
}

function parentDir(path: string) {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : path;
}

function SkillsPage() {
  const { data: skills = [], isLoading } = useQuery(
    rpcClient.workspace.skill.list.queryOptions(),
  );
  const { q } = Route.useSearch();
  const navigate = Route.useNavigate();
  const deferredQuery = useDeferredValue(q);
  const matches = matchSkills(skills, deferredQuery);
  const matchBySkill = new Map(matches.map((match) => [match.skill, match]));
  const groups = groupSkills(matches.map((match) => match.skill));

  return (
    <main className="h-full overflow-y-auto scroll-fade-y">
      <div className="mx-auto w-full max-w-5xl px-8 py-12">
        <div className="mb-10 flex items-center justify-between gap-6">
          <div>
            <h1 className="font-serif text-3xl tracking-tight">Skills</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {`Extra know-how ${APP_NAME} can draw on for particular kinds of work.`}
            </p>
          </div>
          <Button onClick={openCreateSkill}>
            <PlusIcon className="size-4" />
            New skill
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            Finding installed skills…
          </p>
        ) : skills.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-10 text-center">
            <p className="font-medium">No skills yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {`Create one, or add a skill folder to a directory ${APP_NAME} reads.`}
            </p>
          </div>
        ) : (
          <>
            <div className="relative mb-8 max-w-md">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
                onChange={(event) => {
                  const value = event.target.value;
                  void navigate({
                    replace: true,
                    search: (prev) => ({ ...prev, q: value || undefined }),
                  });
                }}
                placeholder="Search skills"
                type="search"
                value={q}
              />
              {q ? (
                <button
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                  onClick={() => {
                    void navigate({
                      replace: true,
                      search: (prev) => ({ ...prev, q: undefined }),
                    });
                  }}
                  type="button"
                >
                  <XIcon className="size-4" />
                </button>
              ) : null}
            </div>

            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {`No skills match “${deferredQuery}”.`}
              </p>
            ) : (
              <div className="grid gap-10">
                {groups.map((group) => (
                  <section className="min-w-0" key={group.key}>
                    <div className="mb-4">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        <h2 className="text-base font-semibold tracking-tight text-foreground">
                          {group.label}
                        </h2>
                        {isProvidedSource(group.source)
                          ? null
                          : group.dirs.map((dir) => (
                              <RevealPath
                                className="min-w-0 max-w-full"
                                hideIcon
                                key={dir}
                                path={dir}
                              />
                            ))}
                      </div>
                    </div>
                    <div className="divide-y overflow-hidden rounded-lg border">
                      {group.skills.map((skill) => {
                        const ranges = matchBySkill.get(skill);
                        return (
                          <div
                            className="group relative flex items-center gap-4 px-4 py-2.5 transition-colors hover:bg-accent/40"
                            key={skill.name}
                          >
                            <InternalLink
                              className="absolute inset-0"
                              params={{ name: skill.name }}
                              to="/skills/$name"
                            />
                            <div className="flex w-52 shrink-0 items-center gap-2">
                              <span className="min-w-0 truncate font-mono text-sm font-medium">
                                {skill.userInvocable ? "/" : null}
                                <FuzzyHighlight
                                  matchClassName={NAME_MATCH_CLASS_NAME}
                                  ranges={ranges?.nameRanges ?? null}
                                  text={skill.name}
                                />
                              </span>
                              {skill.userInvocable ? (
                                <CopyButton
                                  className="relative z-10 shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-0 transition-[color,opacity] group-hover:opacity-100 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100"
                                  iconSize={13}
                                  onCopy={() =>
                                    navigator.clipboard.writeText(
                                      `/${skill.name}`,
                                    )
                                  }
                                />
                              ) : null}
                            </div>
                            <div className="min-w-0 flex flex-1 items-center gap-2 text-sm text-muted-foreground">
                              <SkillBadges
                                className="relative z-10 flex shrink-0 flex-wrap gap-1"
                                skill={skill}
                              />
                              <span className="min-w-0 truncate">
                                <FuzzyHighlight
                                  ranges={ranges?.descriptionRanges ?? null}
                                  text={skill.description}
                                />
                              </span>
                            </div>
                            {skill.fileCount > 1 ? (
                              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                                <FilesIcon className="size-3.5" />
                                {fileCountLabel(skill)}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
