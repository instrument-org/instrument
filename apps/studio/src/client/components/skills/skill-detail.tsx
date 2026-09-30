import { CopyButton } from "@/client/components/copy-button";
import { FileTypeIcon } from "@/client/components/extend/file-system";
import { Markdown } from "@/client/components/markdown";
import { RevealPath } from "@/client/components/reveal-path";
import { SkillBadges } from "@/client/components/skill-badges";
import { SkillFileView } from "@/client/components/skill-file-view";
import { isProvidedSource, skillSourceLabel } from "@/client/lib/skill-source";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

const SKILL_FILE = "SKILL.md";

type Skill = RPCOutput["workspace"]["skill"]["byName"];

/**
 * One skill's page: what it is called and does, where it comes from, and the
 * skill itself as a task reads it, with the files it brings beside it.
 * `actions` draws what can be done to it beside the title.
 */
export function SkillDetail({
  actions,
  className,
  name,
}: {
  actions?: (skill: Skill) => ReactNode;
  className?: string;
  name: string;
}) {
  const {
    data: skill,
    isError,
    isLoading,
  } = useQuery(
    rpcClient.workspace.skill.byName.queryOptions({ input: { name } }),
  );
  // Keyed by skill so moving between skills starts back at SKILL.md without
  // an effect to reset it.
  const [selection, setSelection] = useState({ file: SKILL_FILE, skill: name });
  const selectedFile = selection.skill === name ? selection.file : SKILL_FILE;

  // A link outlives the skill it points at, so this page is reachable for
  // one that has been deleted or renamed. Said in place: the tab still says
  // what was asked for, and the list is a crumb away.
  if (isError) {
    return (
      <div className={cn("flex flex-col", className)}>
        <h1 className="font-mono text-xl font-semibold">{name}</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          No skill by that name is installed on this computer.
        </p>
      </div>
    );
  }
  if (isLoading || !skill) {
    return null;
  }

  return (
    <div className={cn("@container/skill", className)}>
      <div className="max-w-5xl">
        <div className="flex items-start gap-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{skill.title}</h1>
            <SkillBadges className="flex flex-wrap gap-2" skill={skill} />
          </div>
          {actions?.(skill)}
        </div>
        {/* The name a task loads it by, whole: the title above is for
            people, and this is the address. */}
        <p className="mt-1 font-mono text-sm text-muted-foreground">
          {skill.userInvocable
            ? `/${skill.qualifiedName}`
            : skill.qualifiedName}
        </p>
        <p className="mt-2 max-w-lg text-sm/relaxed text-muted-foreground">
          {skill.description}
        </p>
        <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
          <span>{`Source: ${skillSourceLabel(skill.source)}`}</span>
          {isProvidedSource(skill.source) ? null : (
            <RevealPath
              allowWrap
              className="max-w-full"
              hideIcon
              path={skill.path}
            />
          )}
        </div>

        {/* Two columns only when there is a rail to show; a skill with no
            bundled files should not leave a dead gutter. */}
        <div
          className={cn(
            "mt-8 border-t pt-8",
            skill.files.length > 0 &&
              "grid gap-10 @4xl/skill:grid-cols-[minmax(0,1fr)_14rem]",
          )}
        >
          <article className="min-w-0">
            {selectedFile === SKILL_FILE ? (
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
                <div className="border-b bg-muted/20">
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <h2 className="font-mono text-xs font-medium">
                      {SKILL_FILE}
                    </h2>
                    <CopyButton
                      className="rounded-sm p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                      iconSize={14}
                      onCopy={() =>
                        navigator.clipboard.writeText(skill.rawSkillFile)
                      }
                    />
                  </div>
                  {skill.frontmatter ? (
                    <pre className="overflow-x-auto border-t px-4 py-3 text-xs text-muted-foreground">
                      {skill.frontmatter}
                    </pre>
                  ) : null}
                </div>
                <div className="prose prose-custom px-4 py-4 text-sm/relaxed wrap-break-word dark:prose-invert prose-figcaption:text-sm prose-kbd:text-inherit prose-code:text-inherit prose-pre:text-sm prose-table:text-sm">
                  <Markdown markdown={skill.content} />
                </div>
              </div>
            ) : (
              <SkillFileView file={selectedFile} skillName={skill.id} />
            )}
          </article>

          {skill.files.length > 0 ? (
            <aside className="min-w-0 @4xl/skill:sticky @4xl/skill:top-0 @4xl/skill:self-start">
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
                <div className="border-b px-3 py-2">
                  <h2 className="text-xs font-medium">Skill files</h2>
                </div>
                <div className="grid max-h-96 gap-0.5 overflow-y-auto scroll-fade-y p-1.5 text-xs">
                  {skill.files.map((file) => (
                    <button
                      className={cn(
                        "flex min-w-0 items-center gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-accent/50",
                        file === selectedFile &&
                          "bg-accent text-accent-foreground",
                      )}
                      key={file}
                      onClick={() => {
                        setSelection({ file, skill: name });
                      }}
                      type="button"
                    >
                      <FileTypeIcon className="size-4" fileName={file} />
                      <span className="truncate font-mono">{file}</span>
                    </button>
                  ))}
                  {skill.filesTruncated ? (
                    <span className="px-1.5 py-1 text-muted-foreground">…</span>
                  ) : null}
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
