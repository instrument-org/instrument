import { FolderTrail } from "@/client/components/folder-trail";
import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import { ShowInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { RevealPath } from "@/client/components/reveal-path";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { joinHostPath } from "@/client/components/window/host-path";
import { FolderMark } from "@/client/components/window/folder-mark";
import { useWorkspaceFolder } from "@/client/lib/output-folder";
import { matchSkills, type SkillMatch } from "@/client/lib/skill-search";
import {
  isProvidedSource,
  skillPickRank,
  skillSourceLabel,
} from "@/client/lib/skill-source";
import { SKILL_NAME_MATCH_CLASS_NAME } from "@/client/lib/skill-tokens";
import { showInFolder, showInFolderLabel } from "@/client/lib/show-in-files";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { SKILLS_FOLDER_NAME } from "@instrument-org/workspace/client";
import { CubeIcon } from "@phosphor-icons/react/Cube";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useDeferredValue, useState } from "react";

type Skill = RPCOutput["workspace"]["skill"]["list"][number];

/**
 * Every skill a task can load, searchable: the person's own first, under the
 * workspace's Skills folder, then each other agent's, then a line saying how
 * many the app ships, which are listed only when a search finds them. A row
 * of a skill the app doesn't ship opens its folder through `onOpen`, and
 * `menu` sits at its end. `empty` stands in for the person's own rows while
 * they have none, counting no other agent's and no built-in.
 */
export function SkillList({
  empty,
  menu,
  onOpen,
}: {
  empty: ReactNode;
  menu: (skill: Skill) => ReactNode;
  onOpen: (skill: Skill) => void;
}) {
  const { data: skills = [], isLoading } = useQuery(
    rpcClient.workspace.skill.list.queryOptions(),
  );
  const workspaceFolder = useWorkspaceFolder();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const isSearching = deferredQuery.trim() !== "";
  const matches = matchSkills(skills, deferredQuery, {
    scope: "name-and-description",
  });
  const matchBySkill = new Map(matches.map((match) => [match.skill, match]));
  const groups = groupSkills(matches.map((match) => match.skill));
  const ownCount = skills.filter(
    (skill) => skill.source === "workspace",
  ).length;
  const builtInCount = skills.filter((skill) =>
    isProvidedSource(skill.source),
  ).length;
  const skillsFolder =
    workspaceFolder === undefined
      ? undefined
      : joinHostPath(workspaceFolder, SKILLS_FOLDER_NAME);

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Finding installed skills…</p>
    );
  }

  const rows = (group: SkillGroup) => (
    <ul className="divide-y overflow-hidden rounded-xl border border-border bg-card">
      {group.skills.map((skill) => (
        <li className="min-w-0" key={skill.id}>
          <SkillRow
            menu={menu(skill)}
            onOpen={onOpen}
            ranges={matchBySkill.get(skill)}
            skill={skill}
          />
        </li>
      ))}
    </ul>
  );
  const ownGroup = groups.find((group) => group.source === "workspace");
  // Searching shows only the groups with a match, built-ins among them;
  // otherwise the person's own group stays, with `empty` while it has none,
  // and the built-ins are the one line at the foot.
  const shownGroups = isSearching
    ? groups
    : groups.filter((group) => !isProvidedSource(group.source));

  return (
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

      {isSearching && groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {`No skills match “${deferredQuery}”.`}
        </p>
      ) : (
        <div className="grid gap-8">
          {isSearching ? null : (
            <section className="min-w-0">
              <div className="mb-1.5 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h4 className="text-sm font-medium text-muted-foreground">
                  Your skills
                </h4>
                {skillsFolder !== undefined && ownCount > 0 ? (
                  <Button
                    className="text-foreground"
                    onClick={() => {
                      void showInFolder(skillsFolder, { kind: "folder" });
                    }}
                    size="xs"
                    variant="outline"
                  >
                    <ShowInFolderIcon kind="folder" />
                    {showInFolderLabel("folder")}
                  </Button>
                ) : null}
              </div>
              {skillsFolder === undefined ? null : (
                <FolderTrail
                  className="mb-2 text-xs text-muted-foreground"
                  path={skillsFolder}
                />
              )}
              {ownGroup ? rows(ownGroup) : empty}
            </section>
          )}
          {shownGroups
            .filter((group) => isSearching || group.source !== "workspace")
            .map((group) => (
              <section className="min-w-0" key={group.key}>
                <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    {groupLabel(group.source)}
                  </h4>
                </div>
                {group.source === "workspace" || isProvidedSource(group.source)
                  ? null
                  : group.dirs.map((dir) => (
                      <RevealPath
                        className="mb-2 max-w-full min-w-0"
                        key={dir}
                        path={dir}
                      />
                    ))}
                {rows(group)}
              </section>
            ))}
          {!isSearching && builtInCount > 0 ? (
            <p className="text-sm text-muted-foreground">
              {`${APP_NAME} also has ${builtInCount} built-in ${builtInCount === 1 ? "skill" : "skills"}.`}
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}

/** A group's heading: the person's own, the app's, or the other agent's name. */
function groupLabel(source: Skill["source"]) {
  if (source === "workspace") {
    return "Your skills";
  }
  return isProvidedSource(source)
    ? `Built into ${APP_NAME}`
    : skillSourceLabel(source);
}

type SkillGroup = ReturnType<typeof groupSkills>[number];

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
      skills: group.skills.sort((a, b) => a.name.localeCompare(b.name)),
      source: group.source,
    }))
    .sort(
      (a, b) =>
        skillPickRank(a.source) - skillPickRank(b.source) ||
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

/**
 * One skill: its title, the `/slash` form it is invoked by beside it (which
 * is the title too when the two match), and what it is. The row opens the
 * skill's folder unless the app ships the skill, and `menu` sits at its end.
 *
 * Two lines rather than columns, because the pane this stands in is narrow:
 * a name column wide enough for the longest name left the description no
 * room at all. At the narrowest the folder mark and the hover label give
 * their room to the words.
 */
function SkillRow({
  menu,
  onOpen,
  ranges,
  skill,
}: {
  menu: ReactNode;
  onOpen: (skill: Skill) => void;
  ranges: SkillMatch<Skill> | undefined;
  skill: Skill;
}) {
  // A skill the app ships lives deep in its own files, where there is
  // nothing for a person to read or change, so its row opens nothing.
  const opens = !isProvidedSource(skill.source);
  const rowClassName = cn(
    "flex min-w-0 flex-1 items-start gap-3 py-2.5 pl-3.5 text-left @max-sm/app-content:gap-2 @max-sm/app-content:pl-3",
    menu ? "pr-2" : "pr-3.5",
  );
  const name = (
    <FuzzyHighlight
      matchClassName={SKILL_NAME_MATCH_CLASS_NAME}
      ranges={ranges?.nameRanges ?? null}
      text={skill.name}
    />
  );
  const content = (
    <>
      <span className="mt-0.5 flex w-6 shrink-0 justify-center @max-sm/app-content:hidden">
        {opens ? (
          <FolderMark path={skill.path} size="row" />
        ) : (
          <CubeIcon className="size-5 text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          {skill.title === skill.name ? (
            <span className="truncate text-sm font-medium">
              {skill.userInvocable ? "/" : null}
              {name}
            </span>
          ) : (
            <>
              <span className="truncate text-sm font-medium @max-sm/app-content:whitespace-normal">
                {skill.title}
              </span>
              {skill.userInvocable ? (
                <span className="truncate text-xs text-muted-foreground">
                  /{name}
                </span>
              ) : null}
            </>
          )}
        </span>
        <span className="mt-0.5 block truncate text-sm text-muted-foreground @max-sm/app-content:line-clamp-2 @max-sm/app-content:whitespace-normal">
          <FuzzyHighlight
            ranges={ranges?.descriptionRanges ?? null}
            text={skill.description}
          />
        </span>
      </span>
      {opens ? (
        <span className="shrink-0 self-center text-xs text-muted-foreground opacity-0 group-hover/skill-row:opacity-100 group-focus-within/skill-row:opacity-100 @max-sm/app-content:hidden">
          {showInFolderLabel("folder")}
        </span>
      ) : null}
    </>
  );
  return (
    <div
      className={cn(
        "group/skill-row flex items-center",
        opens && "hover:bg-accent/40",
      )}
    >
      {opens ? (
        <button
          className={rowClassName}
          onClick={() => {
            onOpen(skill);
          }}
          title={showInFolderLabel("folder")}
          type="button"
        >
          {content}
        </button>
      ) : (
        <div className={rowClassName}>{content}</div>
      )}
      {menu ? <span className="shrink-0 pr-2">{menu}</span> : null}
    </div>
  );
}
