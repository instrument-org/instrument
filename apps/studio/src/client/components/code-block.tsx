import { useDeferredValue } from "react";

import { useSyntaxHighlighting } from "../hooks/use-syntax-highlighting";
import { CopyButton } from "./copy-button";

/** Shared styling for the controls that float over a rendered block. */
export const blockToolbarButtonClassName =
  "rounded-md border border-border/50 bg-background/80 p-1 text-muted-foreground backdrop-blur-sm hover:bg-muted hover:text-foreground";

export const CodeWithCopy = ({
  children,
  content,
}: {
  children: React.ReactNode;
  content: string;
}) => (
  <div className="group relative isolate">
    <div className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100">
      <CopyButton
        className={blockToolbarButtonClassName}
        iconSize={12}
        onCopy={async () => {
          await navigator.clipboard.writeText(content);
        }}
      />
    </div>
    {children}
  </div>
);

export const CodeBlock = ({
  code,
  language,
}: {
  code: string;
  language: string;
}) => {
  const deferredCode = useDeferredValue(code);
  const { highlightedHtml } = useSyntaxHighlighting({
    code: deferredCode,
    language,
  });

  if (!highlightedHtml) {
    return (
      <pre>
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div dangerouslySetInnerHTML={{ __html: highlightedHtml.join("\n") }} />
  );
};
