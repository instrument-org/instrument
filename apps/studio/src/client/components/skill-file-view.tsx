import { useSyntaxHighlighting } from "@/client/hooks/use-syntax-highlighting";
import { getLanguageFromFilePath } from "@/client/lib/file-extension-to-language";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";

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
  const { data, error, isLoading } = useQuery(
    rpcClient.workspace.skill.file.queryOptions({
      input: { name: skillName, path: file },
    }),
  );
  const { highlightedHtml } = useSyntaxHighlighting({
    code: data?.kind === "text" ? data.content : undefined,
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
      <div
        className="overflow-x-auto rounded-lg bg-card p-4 text-xs"
        dangerouslySetInnerHTML={{ __html: highlightedHtml.join("\n") }}
      />
    );
  }

  return (
    <pre className="overflow-x-auto rounded-lg bg-card p-4 text-xs">
      {data.content}
    </pre>
  );
}
