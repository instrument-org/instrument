import { CopyButton } from "@/client/components/copy-button";
import { Markdown } from "@/client/components/markdown";
import { useSyntaxHighlighting } from "@/client/hooks/use-syntax-highlighting";
import { getLanguageFromFilePath } from "@/client/lib/file-extension-to-language";
import { rpcClient } from "@/client/rpc/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";

import { Spinner } from "./ui/spinner";

/**
 * One file from a skill package, shown as source.
 *
 * SKILL.md is the exception the caller handles: it is the skill itself and
 * reads as prose. Other markdown files should read the same way; everything
 * else is here to be inspected, so it shows the way it is written.
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
  const isMarkdownFile = isMarkdown(file);
  const text = data?.kind === "text" ? data.content : undefined;
  const split =
    text !== undefined && isMarkdownFile ? splitFrontmatter(text) : null;
  // Markdown renders as prose, so only the source view asks for highlighting.
  const { highlightedHtml, isHighlightable } = useSyntaxHighlighting({
    code: isMarkdownFile ? undefined : text,
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

  if (isMarkdownFile) {
    return (
      <div className="overflow-hidden rounded-lg bg-card">
        <div className="border-b bg-muted/20">
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <h2 className="font-mono text-xs font-medium">{file}</h2>
            <CopyButton
              className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              iconSize={14}
              onCopy={() => navigator.clipboard.writeText(data.content)}
            />
          </div>
          {split?.frontmatter ? (
            <pre className="overflow-x-auto border-t px-4 py-3 text-xs text-muted-foreground">
              {split.frontmatter}
            </pre>
          ) : null}
        </div>
        <div className="prose prose-custom max-w-none px-4 py-4 text-sm/relaxed wrap-break-word dark:prose-invert prose-figcaption:text-sm prose-kbd:text-inherit prose-code:text-inherit prose-pre:text-sm prose-table:text-sm">
          <Markdown markdown={split?.body ?? data.content} />
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg bg-card">
      <div className="border-b bg-muted/20">
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <h2 className="font-mono text-xs font-medium">{file}</h2>
          <CopyButton
            className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            iconSize={14}
            onCopy={() => navigator.clipboard.writeText(data.content)}
          />
        </div>
      </div>
      {highlightedHtml ? (
        <div
          className="overflow-x-auto p-4 text-xs"
          dangerouslySetInnerHTML={{ __html: highlightedHtml.join("\n") }}
        />
      ) : (
        // Highlighting is a round trip, so hold the plain text back long enough
        // that a file about to arrive highlighted doesn't flash unstyled first.
        <motion.pre
          animate={{ opacity: 1 }}
          className="overflow-x-auto p-4 text-xs"
          initial={{ opacity: isHighlightable ? 0 : 1 }}
          transition={{ delay: isHighlightable ? 0.3 : 0, duration: 0 }}
        >
          {split?.body ?? data.content}
        </motion.pre>
      )}
    </div>
  );
}

function isMarkdown(file: string) {
  const ext = file.split(".").pop()?.toLowerCase();
  return ext === "md" || ext === "mdx";
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
