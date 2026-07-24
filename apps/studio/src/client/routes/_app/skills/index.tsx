import { openCreateSkill } from "@/client/atoms/create-skill-modal";
import { InternalLink } from "@/client/components/internal-link";
import { RevealPath } from "@/client/components/reveal-path";
import { Button } from "@/client/components/ui/button";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { FilesIcon, PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/skills/")({
  component: SkillsPage,
  head: () => ({ meta: [{ title: "Skills" }] }),
  staticData: { tabIcon: "graduation-cap" },
});

type Skill = RPCOutput["workspace"]["skill"]["list"][number];

// Where a group sits in the list. Instrument's own skills first because they
// are the ones we can vouch for, then the workspace, then skills discovered in
// the folders other agents keep theirs in.
const SOURCE_RANK: Record<Skill["source"], number> = {
  agents: 3,
  claude: 3,
  codex: 3,
  cursor: 3,
  gemini: 3,
  opencode: 3,
  registry: 0,
  system: 0,
  workspace: 1,
};

// Whether a skill we ship came from the bundle or the registry is our own
// packaging detail, so both read as one thing to the user.
const PROVIDED_LABEL = `Provided by ${APP_NAME}`;

// Each source names the app or place its skills come from; the folder on disk
// rides underneath as secondary detail rather than standing in as the heading.
const SOURCE_LABELS: Record<Skill["source"], string> = {
  agents: "Agent skills",
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini",
  opencode: "OpenCode",
  registry: PROVIDED_LABEL,
  system: PROVIDED_LABEL,
  workspace: "This workspace",
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
    const key = SOURCE_LABELS[skill.source];
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
      label: SOURCE_LABELS[group.source],
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
  const groups = groupSkills(skills);

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
        ) : groups.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-10 text-center">
            <p className="font-medium">No skills yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {`Create one, or add a skill folder to a directory ${APP_NAME} reads.`}
            </p>
          </div>
        ) : (
          <div className="grid gap-10">
            {groups.map((group) => (
              <section key={group.key}>
                <div className="mb-4">
                  <h2 className="text-base font-semibold tracking-tight">
                    {group.label}
                  </h2>
                  {group.label === PROVIDED_LABEL ? null : (
                    <div className="mt-1 grid gap-0.5">
                      {group.dirs.map((dir) => (
                        <RevealPath key={dir} path={dir} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {group.skills.map((skill) => (
                    <InternalLink
                      className="group rounded-2xl border bg-card p-5 transition-colors hover:bg-accent/40"
                      key={skill.name}
                      params={{ name: skill.name }}
                      to="/skills/$name"
                    >
                      <h3 className="text-sm font-semibold">{skill.title}</h3>
                      <p className="mt-2 line-clamp-3 text-sm/relaxed text-muted-foreground">
                        {skill.description}
                      </p>
                      {skill.fileCount > 1 ? (
                        <p className="mt-3 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                          <FilesIcon className="size-3.5" />
                          {fileCountLabel(skill)}
                        </p>
                      ) : null}
                    </InternalLink>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
