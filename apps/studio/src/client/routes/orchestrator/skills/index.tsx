import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { SKILLS_HREF } from "@/client/components/orchestrator/tab-location";
import { RevealPath } from "@/client/components/reveal-path";
import { SkillBadges } from "@/client/components/skill-badges";
import { Input } from "@/client/components/ui/input";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { matchSkills, type SkillMatch } from "@/client/lib/skill-search";
import { isProvidedSource, skillSourceLabel } from "@/client/lib/skill-source";
import { SKILL_NAME_MATCH_CLASS_NAME } from "@/client/lib/skill-tokens";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME, APP_NAME_SLUG } from "@instrument-org/shared";
import { FilesIcon } from "@phosphor-icons/react/Files";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useState } from "react";

/**
 * The Skills screen: every skill a task can load, grouped by where it comes
 * from, each a row that opens the skill's page. A place to see what the
 * conversation's tasks know how to do and where each piece of that came
 * from; a skill is used by asking for the work, never from here.
 */
export const Route = createFileRoute("/orchestrator/skills/")({
  component: SkillsRoute,
});

type Skill = RPCOutput["workspace"]["skill"]["list"][number];

// Where a group sits in the list. The user's own workspace first, since it is
// the one they author; then Instrument's provided skills; then skills found in
// the folders other agents keep theirs in.
const SOURCE_RANK: Record<Skill["source"], number> = {
  agents: 3,
  antigravity: 3,
  [APP_NAME_SLUG]: 1,
  claude: 3,
  codex: 3,
  copilot: 3,
  cursor: 3,
  gemini: 3,
  goose: 3,
  kiro: 3,
  opencode: 3,
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

// Skill paths come from the OS, so the separator is a backslash on Windows.
// Missing it leaves every skill's own folder looking like a separate place the
// source keeps its skills in.
function parentDir(path: string) {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : path;
}

// Where another agent keeps its skills is worth naming: it is how someone works
// out what those skills are and where they came from. The workspace's own
// folder is not, since nobody chose to put anything there.
function showsSourcePaths(source: Skill["source"]) {
  return !isProvidedSource(source) && source !== "workspace";
}

/**
 * One skill: its name the way it is invoked, what it is, and how much it
 * brings with it. The whole row opens the skill's page, with the gestures
 * every openable thing answers.
 *
 * Two lines rather than columns, because the pane this stands in is narrow:
 * a name column wide enough for the longest name left the description no
 * room at all.
 */
function SkillRow({
  ranges,
  skill,
}: {
  ranges: SkillMatch<Skill> | undefined;
  skill: Skill;
}) {
  const navigate = useNavigate();
  const gestures = useOpenGestures({
    href: `${SKILLS_HREF}/${skill.id}`,
    kind: "screen",
  });
  return (
    <button
      className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-accent/40"
      onAuxClick={gestures.onAuxClick}
      onClick={() => {
        void navigate({
          params: { name: skill.id },
          to: "/orchestrator/skills/$name",
        });
      }}
      onContextMenu={gestures.onContextMenu}
      type="button"
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-mono text-sm font-medium">
            {skill.userInvocable ? "/" : null}
            <FuzzyHighlight
              matchClassName={SKILL_NAME_MATCH_CLASS_NAME}
              ranges={ranges?.nameRanges ?? null}
              text={skill.name}
            />
          </span>
          <SkillBadges
            className="flex shrink-0 flex-wrap gap-1"
            skill={skill}
          />
        </span>
        <span className="mt-0.5 block truncate text-sm text-muted-foreground">
          <FuzzyHighlight
            ranges={ranges?.descriptionRanges ?? null}
            text={skill.description}
          />
        </span>
      </span>
      {skill.fileCount > 1 ? (
        <span className="flex shrink-0 items-center gap-1 pt-1 text-xs text-muted-foreground">
          <FilesIcon className="size-3.5" />
          {fileCountLabel(skill)}
        </span>
      ) : null}
    </button>
  );
}

function SkillsRoute() {
  useOnScreen({ screen: "skills" });
  const { data: skills = [], isLoading } = useQuery(
    rpcClient.workspace.skill.list.queryOptions(),
  );
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const matches = matchSkills(skills, deferredQuery, {
    scope: "name-and-description",
  });
  const matchBySkill = new Map(matches.map((match) => [match.skill, match]));
  const groups = groupSkills(matches.map((match) => match.skill));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-8 pt-6 pb-10">
      <h1 className="text-xl font-semibold">Skills</h1>
      <p className="mt-1 max-w-lg text-sm text-muted-foreground">
        {`Extra know-how ${APP_NAME} can draw on for particular kinds of work, and where each piece of it comes from.`}
      </p>

      <div className="mt-6 max-w-5xl">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            Finding installed skills…
          </p>
        ) : skills.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-10 text-center">
            <p className="font-medium">No skills yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {`Add a skill folder to a directory ${APP_NAME} reads, or ask for one.`}
            </p>
          </div>
        ) : (
          <>
            <div className="relative mb-8 max-w-md">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="Search skills"
                type="search"
                value={query}
              />
              {query ? (
                <button
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                  onClick={() => {
                    setQuery("");
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
                {groups.map((group) => {
                  const sourcePaths = showsSourcePaths(group.source)
                    ? group.dirs
                    : [];

                  return (
                    <section className="min-w-0" key={group.key}>
                      <div className="mb-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        <h2 className="text-lg font-medium text-muted-foreground">
                          {group.label}
                        </h2>
                        {sourcePaths.map((dir) => (
                          <RevealPath
                            className="max-w-full min-w-0"
                            hideIcon
                            key={dir}
                            path={dir}
                          />
                        ))}
                      </div>
                      <ul className="divide-y overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
                        {group.skills.map((skill) => (
                          <li className="min-w-0" key={skill.id}>
                            <SkillRow
                              ranges={matchBySkill.get(skill)}
                              skill={skill}
                            />
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
