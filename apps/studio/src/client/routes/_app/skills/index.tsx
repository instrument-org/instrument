import { openCreateSkill } from "@/client/atoms/create-skill-modal";
import { InternalLink } from "@/client/components/internal-link";
import { RevealPath } from "@/client/components/reveal-path";
import { Button } from "@/client/components/ui/button";
import { skillTitle } from "@/client/lib/skill-title";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/skills/")({
  component: SkillsPage,
  head: () => ({ meta: [{ title: "Skills" }] }),
  staticData: { tabIcon: "graduation-cap" },
});

type Skill = RPCOutput["workspace"]["skill"]["list"][number];

// Where a group sits in the list. Instrument's own skills first because they
// are the ones we can vouch for; everything else is grouped by the folder it
// actually lives in, so the listing describes the disk rather than which agent
// vendor happened to symlink it.
const SOURCE_RANK: Record<Skill["source"], number> = {
  agents: 3,
  claude: 3,
  codex: 3,
  cursor: 3,
  gemini: 3,
  opencode: 3,
  registry: 1,
  system: 0,
  workspace: 2,
};

const GROUP_LABELS: Partial<Record<Skill["source"], string>> = {
  registry: "Instrument registry",
  system: "Built in",
  workspace: "This workspace",
};

function groupSkills(skills: Skill[]) {
  const groups = new Map<string, { dir: string; skills: Skill[]; source: Skill["source"] }>();

  for (const skill of skills) {
    const dir = parentDir(skill.path);
    const group = groups.get(dir);
    if (group) {
      group.skills.push(skill);
      continue;
    }
    groups.set(dir, { dir, skills: [skill], source: skill.source });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      label: GROUP_LABELS[group.source] ?? parentDir(group.dir).split("/").pop() ?? group.dir,
      skills: group.skills.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort(
      (a, b) =>
        SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || a.dir.localeCompare(b.dir),
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
              Specialized instructions available to your agents.
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
            <p className="font-medium">No skills found</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Create a skill or add one to an installed agent skills directory.
            </p>
          </div>
        ) : (
          <div className="grid gap-10">
            {groups.map((group) => (
              <section key={group.dir}>
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="text-sm font-medium">{group.label}</h2>
                  <RevealPath path={group.dir} />
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {group.skills.map((skill) => (
                    <InternalLink
                      className="group rounded-2xl border bg-card p-5 transition-colors hover:bg-accent/40"
                      key={skill.name}
                      params={{ name: skill.name }}
                      to="/skills/$name"
                    >
                      <h3 className="text-sm font-semibold">
                        {skillTitle(skill.name)}
                      </h3>
                      <p className="mt-2 line-clamp-3 text-sm/relaxed text-muted-foreground">
                        {skill.description}
                      </p>
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
