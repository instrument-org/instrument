import { openFilePreviewAtom } from "@/client/atoms/file-preview";
import { ImageIcon } from "@phosphor-icons/react";
import { useSetAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remend from "remend";

import { useHashLinkScroll } from "../hooks/use-hash-link-scroll";
import { useSyntaxHighlighting } from "../hooks/use-syntax-highlighting";
import { cn } from "../lib/utils";
import { CopyButton } from "./copy-button";
import { ExternalLink } from "./external-link";

interface MarkdownProps {
  allowRawHtml?: boolean;
  assetBaseUrl?: string;
  markdown: string;
}

type PluginList = NonNullable<Options["rehypePlugins"]>;
type RemarkPluginList = NonNullable<Options["remarkPlugins"]>;

const emptyPluginList: PluginList = [];
const emptyRemarkPluginList: RemarkPluginList = [];

function containsMathSyntax(markdown: string) {
  return /```math\b|\\\(|\\\[|\\begin\{[a-z*]+\}|\$\$[\s\S]*?\$\$/.test(
    markdown,
  );
}

const CodeWithCopy = ({
  children,
  content,
}: {
  children: React.ReactNode;
  content: string;
}) => (
  <div className="group relative">
    <div className="absolute top-1 right-1 z-10 opacity-0 transition-opacity group-hover:opacity-100">
      <CopyButton
        className="rounded-md border border-border/50 bg-background/80 p-1 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground"
        iconSize={12}
        onCopy={async () => {
          await navigator.clipboard.writeText(content);
        }}
      />
    </div>
    {children}
  </div>
);

const CodeBlock = ({ code, language }: { code: string; language: string }) => {
  const { highlightedHtml } = useSyntaxHighlighting({ code, language });

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

const ALLOWED_IMAGE_PATTERNS = [
  /^data:/,
  /^http:\/\/.*\.localhost(:\d+)?\//,
  /^https:\/\/images\.google\.com\//,
  /^https:\/\/github\.com\//,
  /^https:\/\/.*\.github\.com\//,
  /^https:\/\/.*\.githubusercontent\.com\//,
];

const isImageAllowed = (src: string | undefined): boolean => {
  if (!src) {
    return false;
  }
  if (src.startsWith("/") || src.startsWith("./") || src.startsWith("../")) {
    return true;
  }
  return ALLOWED_IMAGE_PATTERNS.some((pattern) => pattern.test(src));
};

const ImagePlaceholder = ({ alt, src }: { alt?: string; src?: string }) => (
  <div className="flex max-w-full items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
    <ImageIcon className="size-4 shrink-0" />
    <div className="min-w-0 flex-1">
      <div className="truncate">{alt || "Image"}</div>
      {src && <div className="truncate text-xs opacity-70">{src}</div>}
    </div>
  </div>
);

const resolveImageSrc = (
  src: string | undefined,
  assetBaseUrl: string | undefined,
): string | undefined => {
  if (!src || !assetBaseUrl) {
    return src;
  }
  if (src.startsWith("./") || src.startsWith("../")) {
    return `${assetBaseUrl}/${src.replace(/^\.\//, "")}`;
  }
  return src;
};

export const Markdown = memo(
  ({ allowRawHtml, assetBaseUrl, markdown }: MarkdownProps) => {
    const openFilePreview = useSetAtom(openFilePreviewAtom);
    const [rehypePlugins, setRehypePlugins] =
      useState<PluginList>(emptyPluginList);
    const [remarkPlugins, setRemarkPlugins] = useState<RemarkPluginList>(
      emptyRemarkPluginList,
    );
    const needsMath = useMemo(() => containsMathSyntax(markdown), [markdown]);

    const handleImageClick = useCallback(
      (event: React.MouseEvent<HTMLImageElement>) => {
        const src = event.currentTarget.src;
        const alt = event.currentTarget.alt || "image";
        if (src) {
          openFilePreview({ filename: alt, url: src });
        }
      },
      [openFilePreview],
    );

    const handleHashLinkClick = useHashLinkScroll();

    useEffect(() => {
      let isCancelled = false;

      async function loadPlugins() {
        const nextRehypePlugins: PluginList = [];
        const nextRemarkPlugins: RemarkPluginList = [];

        if (allowRawHtml) {
          const { default: rehypeRaw } = await import("rehype-raw");
          nextRehypePlugins.push(rehypeRaw);
        }

        if (needsMath) {
          const [{ default: rehypeKatex }, { default: remarkMath }] =
            await Promise.all([
              import("rehype-katex"),
              import("remark-math"),
              import("katex/dist/katex.min.css"),
            ]);

          nextRehypePlugins.push(rehypeKatex);
          nextRemarkPlugins.push([remarkMath, { singleDollarTextMath: false }]);
        }

        if (isCancelled) {
          return;
        }

        setRehypePlugins(nextRehypePlugins);
        setRemarkPlugins(nextRemarkPlugins);
      }

      void loadPlugins();

      return () => {
        isCancelled = true;
      };
    }, [allowRawHtml, needsMath]);

    return (
      <ReactMarkdown
        components={{
          a: ({ children, className, href, node: _node, ...props }) => {
            if (href?.startsWith("#")) {
              return (
                // eslint-disable-next-line no-restricted-syntax
                <a
                  {...props}
                  className={cn("cursor-pointer!", className)}
                  href={href}
                  onClick={handleHashLinkClick}
                >
                  {children}
                </a>
              );
            }

            return (
              <ExternalLink {...props} className={className} href={href}>
                {children}
              </ExternalLink>
            );
          },
          code: ({ children, className, node: _node, ref: _ref, ...props }) => {
            const match = /language-(\w+)/.exec(className ?? "");
            const language = match?.[1];
            const isInline = !language;

            if (isInline) {
              return (
                <code {...props} className={className}>
                  {children}
                </code>
              );
            }

            const codeString =
              typeof children === "string"
                ? children.replace(/\n$/, "")
                : Array.isArray(children)
                  ? children.join("")
                  : "";

            return (
              <CodeWithCopy content={codeString}>
                <CodeBlock code={codeString} language={language} />
              </CodeWithCopy>
            );
          },
          img: ({ alt, className, node: _node, ref: _ref, src, ...props }) => {
            const resolvedSrc = resolveImageSrc(src, assetBaseUrl);
            if (!isImageAllowed(resolvedSrc)) {
              return <ImagePlaceholder alt={alt} src={resolvedSrc} />;
            }

            return (
              <img
                {...props}
                alt={alt}
                className={cn(
                  "max-w-full cursor-pointer! rounded-md",
                  className,
                )}
                onClick={handleImageClick}
                src={resolvedSrc}
              />
            );
          },
          pre: ({ children }) => {
            return <>{children}</>;
          },
        }}
        rehypePlugins={rehypePlugins}
        remarkPlugins={[remarkGfm, remarkBreaks, ...remarkPlugins]}
      >
        {remend(markdown)}
      </ReactMarkdown>
    );
  },
);

Markdown.displayName = "Markdown";
