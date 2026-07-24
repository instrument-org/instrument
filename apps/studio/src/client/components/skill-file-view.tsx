import { CopyButton } from "@/client/components/copy-button";
import { useSyntaxHighlighting } from "@/client/hooks/use-syntax-highlighting";
import { getLanguageFromFilePath } from "@/client/lib/file-extension-to-language";
import { rpcClient } from "@/client/rpc/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { Spinner } from "./ui/spinner";

/**
 * One file from a skill package, shown as source.
 *
 * SKILL.md is the exception the caller handles: it is the skill itself and
 * reads as prose, so it renders through the markdown pipeline. Everything else
 * is here to be inspected, so it shows the way it is written.
 */
export function SkillFileView({
  file,
  skillName,
}: {
  file: string;
  skillName: string;
}) {
  const { data, error, isLoading } = useQuery({
    ...rpcClient.workspace.skill.file.queryOptions({
      input: { name: skillName, path: file },
    }),
    placeholderData: keepPreviousData,
  });
  const split = data?.kind === "text" ? splitFrontmatter(data.content) : null;
  const { highlightedHtml } = useSyntaxHighlighting({
    code: split?.body,
    language: getLanguageFromFilePath(file),
  });

  if (isLoading) {
    return <Spinner className="size-5 text-muted-foreground" />;
  }

  if (error || !data) {
    return (
      <p className="text-sm text-muted-foreground">
        {error?.message ?? "This file could not be read."}
      </p>
    );
  }

  if (data.kind === "binary") {
    return (
      <p className="text-sm text-muted-foreground">
        This file is not text, so there is nothing to show here.
      </p>
    );
  }

  if (data.kind === "too-large") {
    return (
      <p className="text-sm text-muted-foreground">
        This file is too large to show here.
      </p>
    );
  }

  if (highlightedHtml) {
    return (
      <div className="overflow-hidden rounded-lg bg-card">
        {split?.frontmatter ? (
          <pre className="overflow-x-auto border-b bg-muted/30 px-4 py-3 text-xs">
            {split.frontmatter}
          </pre>
        ) : null}
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="font-mono text-xs font-medium">{file}</h2>
          <CopyButton
            className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            iconSize={14}
            onCopy={() => navigator.clipboard.writeText(data.content)}
          />
        </div>
        <div
          className="overflow-x-auto p-4 text-xs"
          dangerouslySetInnerHTML={{ __html: highlightedHtml.join("\n") }}
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg bg-card">
      {split?.frontmatter ? (
        <pre className="overflow-x-auto border-b bg-muted/30 px-4 py-3 text-xs">
          {split.frontmatter}
        </pre>
      ) : null}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="font-mono text-xs font-medium">{file}</h2>
        <CopyButton
          className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          iconSize={14}
          onCopy={() => navigator.clipboard.writeText(data.content)}
        />
      </div>
      <pre className="overflow-x-auto p-4 text-xs">
        {split?.body ?? data.content}
      </pre>
    </div>
  );
}

function splitFrontmatter(raw: string) {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { body: raw, frontmatter: null as null | string };
  }

  const normalized = raw.replaceAll("\r\n", "\n");
  const end = normalized.indexOf("\n---\n");
  if (end === -1) {
    return { body: raw, frontmatter: null as null | string };
  }

  return {
    body: normalized.slice(end + "\n---\n".length),
    frontmatter: normalized.slice(0, end + "\n---".length),
  };
}
