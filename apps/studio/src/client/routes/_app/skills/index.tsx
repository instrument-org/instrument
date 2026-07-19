import { InternalLink } from "@/client/components/internal-link";
import { rpcClient } from "@/client/rpc/client";
import { StackIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/skills/")({
  component: SkillsPage,
  head: () => ({ meta: [{ title: "Skills" }] }),
});

function SkillsPage() {
  const { data: skills = [], isLoading } = useQuery(
    rpcClient.workspace.skill.list.queryOptions(),
  );

  return (
    <main className="scroll-fade-y h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-8 py-12">
        <div className="mb-10 flex items-center gap-4">
          <div className="flex size-11 items-center justify-center rounded-xl bg-brown-100 text-brown-700 dark:bg-brown-900/60 dark:text-brown-200">
            <StackIcon className="size-6" weight="duotone" />
          </div>
          <div>
            <h1 className="font-serif text-3xl tracking-tight">Skills</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Specialized instructions available to your agents.
            </p>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Finding installed skills…</p>
        ) : skills.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-10 text-center">
            <p className="font-medium">No skills found</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Add a skill to your workspace skills folder or an agent skills directory.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {skills.map((skill) => (
              <InternalLink
                className="group rounded-2xl border bg-card p-5 transition-colors hover:bg-accent/40"
                key={skill.name}
                params={{ name: skill.name }}
                to="/skills/$name"
              >
                <div className="flex items-start justify-between gap-4">
                  <h2 className="font-mono text-sm font-semibold">/{skill.name}</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground capitalize">
                    {skill.source}
                  </span>
                </div>
                <p className="mt-3 line-clamp-3 text-sm/relaxed text-muted-foreground">
                  {skill.description}
                </p>
              </InternalLink>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
