import { useDeferredValue } from "react";

import { useSyntaxHighlighting } from "../hooks/use-syntax-highlighting";
import { CopyButton } from "./copy-button";

/** Shared styling for the controls that float over a rendered block. */
export const blockToolbarButtonClassName =
  // `card` rather than `muted` for the hover: muted is a translucent white in
  // dark mode, so the block underneath read straight through the control on top
  // of it. Both of these are solid in both themes.
  "rounded-md border border-border/50 bg-background p-1 text-muted-foreground hover:bg-card hover:text-foreground";

export const CodeWithCopy = ({
  children,
  content,
  ref,
}: {
  children: React.ReactNode;
  content: string;
  ref?: React.Ref<HTMLDivElement>;
}) => (
  <div className="group relative isolate" ref={ref}>
    {/* `focus-within` as well as hover: the button stays in the tab order while
        it is transparent, so without it a keyboard user lands on a control
        with nothing on screen to show for it. */}
    <div className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
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
