import { openFilePreviewAtom } from "@/client/atoms/file-preview";
import { appendToPromptAtom } from "@/client/atoms/prompt-value";
import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { rpcClient } from "@/client/rpc/client";
import {
  ATTACHED_FOLDERS_MOUNT_ROOT,
  normalizeTaskFilePath,
  type TaskId,
} from "@instrument-org/workspace/client";
import { ImageIcon } from "@phosphor-icons/react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import {
  createContext,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import ReactMarkdown, {
  type Components,
  defaultUrlTransform,
  type Options,
} from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remend from "remend";

import { useHashLinkScroll } from "../hooks/use-hash-link-scroll";
import { getAssetUrl } from "../lib/get-asset-url";
import {
  containsMermaidFence,
  isMermaidLanguage,
  prefetchMermaid,
} from "../lib/mermaid";
import { cn } from "../lib/utils";
import { CodeBlock, CodeWithCopy } from "./code-block";
import { ExternalLink } from "./external-link";
import { FileActionsMenuItems } from "./file-actions-menu";
import { FileIcon } from "./file-icon";
import { MermaidDiagram } from "./mermaid-diagram";
import { useCurrentTaskFile } from "./task/current-task-files";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { contextMenuComponents } from "./ui/menu-components";

interface MarkdownProps {
  allowRawHtml?: boolean;
  assetBaseUrl?: string;
  // Drops the images the allow-list rejects instead of standing a placeholder
  // in for them. For markdown scraped from a page rather than authored for us:
  // the allow-list passes nothing such a page carries, so every placeholder is
  // permanent, and being block-level each one interrupts the prose it sits in
  // to name a picture the reader will never see.
  hideImages?: boolean;
  markdown: string;
  // Present only when rendered inside a task chat. Enables the task-file
  // right-click menu (Open in {App} / Save as… / Reveal / …); left-click
  // open-in-panel works without it.
  taskId?: TaskId;
}

// Carries the ambient task context down to the module-scope link renderer so a
// task-file reference can build its asset URL and file-action menu.
const MarkdownTaskContext = createContext<{
  assetBaseUrl?: string;
  taskId?: TaskId;
}>({});

type PluginList = NonNullable<Options["rehypePlugins"]>;
type RemarkPluginList = NonNullable<Options["remarkPlugins"]>;

const emptyPluginList: PluginList = [];
const emptyRemarkPluginList: RemarkPluginList = [];

function containsMathSyntax(markdown: string) {
  return /```math\b|\\\(|\\\[|\\begin\{[a-z*]+\}|\$\$[\s\S]*?\$\$/.test(
    markdown,
  );
}

const markdownPre: Components["pre"] = ({ children }) => <>{children}</>;

// Native ordered-list markers sit outside the padding and grow leftward as the
// number's digit count rises, so past one digit they escape the message column.
// CSS can't size the gutter for this: it can't read the rendered number, and a
// manual `start` makes item count the wrong proxy (the largest number is
// `start + count - 1`). So compute the widest marker here and widen the gutter
// to fit, leaving native rendering (numbering, right-alignment, hanging indent)
// untouched.
const markdownOrderedList: Components["ol"] = ({
  children,
  node,
  ref: _ref,
  style,
  ...props
}) => {
  const itemCount =
    node?.children.filter(
      (child) => child.type === "element" && child.tagName === "li",
    ).length ?? 0;
  const firstNumber = typeof props.start === "number" ? props.start : 1;
  const digits = String(firstNumber + Math.max(0, itemCount - 1)).length;
  const paddingInlineStart = digits > 1 ? `${1 + digits * 0.5}em` : undefined;

  return (
    <ol
      {...props}
      style={paddingInlineStart ? { ...style, paddingInlineStart } : style}
    >
      {children}
    </ol>
  );
};

const markdownCode: Components["code"] = ({
  children,
  className,
  node: _node,
  ref: _ref,
  ...props
}) => {
  const match = /language-(\w+)/.exec(className ?? "");
  const language = match?.[1];

  if (!language) {
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

  if (isMermaidLanguage(language)) {
    return <MermaidDiagram code={codeString} language={language} />;
  }

  return (
    <CodeWithCopy content={codeString}>
      <CodeBlock code={codeString} language={language} />
    </CodeWithCopy>
  );
};

// A schemeless, non-anchor href is a candidate task-file reference (e.g. the
// agent's `[Download](output/report.xml)`). Real URLs carry a scheme
// (`https:`, `mailto:`, `data:`) or are protocol-relative (`//host`); those go
// to ExternalLink instead.
const isTaskFileHref = (href: string): boolean =>
  !href.startsWith("#") &&
  !href.startsWith("//") &&
  !/^[a-z][a-z0-9+.-]*:/i.test(href);

const taskFilePathFromHref = (href: string): string => {
  let path = href;
  try {
    path = decodeURIComponent(href);
  } catch {
    // Keep the raw href when it isn't valid percent-encoding.
  }
  return normalizeTaskFilePath(path);
};

// A file the agent reached through a mount rather than the task directory, so
// the task-file index has nothing to say about it and the server has to resolve
// it. Every other absolute path is a host path no link may reach.
const isMountPath = (path: string): boolean =>
  path.startsWith(`${ATTACHED_FOLDERS_MOUNT_ROOT}/`) &&
  !path.split("/").includes("..");

// Renders a link to a file the agent produced as an interactive chip that opens
// the file in the artifact panel. Existence is gated: a path that resolves to no
// real file renders as plain text rather than a broken action, so hallucinated
// paths degrade safely.
const TaskFileLink = ({
  children,
  className,
  href,
}: {
  children: ReactNode;
  className?: string;
  href: string;
}) => {
  const { assetBaseUrl, taskId } = useContext(MarkdownTaskContext);
  const filePath = taskFilePathFromHref(href);
  const indexedFile = useCurrentTaskFile(filePath);
  // The live index covers the task directory only, so a file in a folder the
  // user shared is resolved one path at a time against the task's mounts
  // instead. Same route the artifact panel and a ```files fence take.
  const { data: mountedFile } = useQuery(
    rpcClient.workspace.task.files.fileInfo.queryOptions({
      input:
        taskId !== undefined && !indexedFile && isMountPath(filePath)
          ? { filePath, taskId }
          : skipToken,
    }),
  );
  const file = indexedFile ?? mountedFile;
  const navigate = useNavigate({ from: "/tasks/$id/" });
  const appendToPrompt = useSetAtom(appendToPromptAtom);

  if (!file) {
    return <span className={className}>{children}</span>;
  }

  const openInPanel = () => {
    void navigate({
      replace: true,
      search: (prev) => ({
        ...prev,
        artifactPanel: {
          filePath: file.filePath,
          modifiedAt: file.modifiedAt,
          type: "file" as const,
        },
      }),
    });
  };

  const chip = (
    <button
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 align-text-bottom text-sm font-medium text-foreground no-underline hover:bg-muted",
        className,
      )}
      onClick={openInPanel}
      title={file.filePath}
      type="button"
    >
      <FileIcon
        className="size-3.5 shrink-0 text-muted-foreground"
        filename={file.filename}
      />
      <span className="truncate">{children}</span>
    </button>
  );

  // The file-action menu needs a task id and asset origin; without the ambient
  // task context (e.g. reasoning or a previewed markdown file) the chip still
  // left-click opens the panel, just without a right-click menu.
  if (!taskId || !assetBaseUrl) {
    return chip;
  }

  const viewerFile: TaskFileViewerFile = {
    filename: file.filename,
    filePath: file.filePath,
    mimeType: file.mimeType,
    modifiedAt: file.modifiedAt,
    taskId,
    url: getAssetUrl({
      assetBase: assetBaseUrl,
      filePath: file.filePath,
      version: file.modifiedAt,
    }),
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{chip}</ContextMenuTrigger>
      <ContextMenuContent>
        <FileActionsMenuItems
          file={viewerFile}
          menuComponents={contextMenuComponents}
          onAddToChat={() => {
            appendToPrompt({
              key: { scope: "task", taskId },
              update: file.filePath,
            });
          }}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
};

const MarkdownLink: Components["a"] = ({
  children,
  className,
  href,
  node: _node,
  ...props
}) => {
  const handleHashLinkClick = useHashLinkScroll();

  // Whatever `urlTransform` refused arrives with its href emptied: a `file:` URL
  // that does not parse, a `javascript:` one. There is nothing left to open, and
  // an anchor with an empty href reads as a live link and does nothing.
  if (!href) {
    return <span className={className}>{children}</span>;
  }

  if (href.startsWith("#")) {
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

  if (isTaskFileHref(href)) {
    return (
      <TaskFileLink className={className} href={href}>
        {children}
      </TaskFileLink>
    );
  }

  return (
    <ExternalLink {...props} className={className} href={href}>
      {children}
    </ExternalLink>
  );
};

// `file:` is how a model spells a link to a file it just wrote, and the default
// transform drops the href whole rather than pass a scheme it does not know.
// Reduce such a URL to its path so it reaches `TaskFileLink` on the same terms
// as any other file reference. Passing it through instead only ever reaches
// `ExternalLink`, where the protocol allowlist refuses it: a blocked-link toast
// and a captured exception, never an opened file.
const markdownUrlTransform = (url: string): string => {
  if (!/^file:/i.test(url)) {
    return defaultUrlTransform(url);
  }
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
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
  if (!src) {
    return src;
  }
  // Leave real URLs (http/https/data/blob) and protocol-relative srcs for the
  // allow-list to judge; only resolve task-relative paths against the asset
  // origin. This covers bare `output/x.png` in addition to `./`/`../`.
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) {
    return src;
  }
  if (!assetBaseUrl) {
    return src;
  }
  return getAssetUrl({ assetBase: assetBaseUrl, filePath: src });
};

export const Markdown = memo(
  ({
    allowRawHtml,
    assetBaseUrl,
    hideImages,
    markdown,
    taskId,
  }: MarkdownProps) => {
    const openFilePreview = useSetAtom(openFilePreviewAtom);
    const [rehypePlugins, setRehypePlugins] =
      useState<PluginList>(emptyPluginList);
    const [remarkPlugins, setRemarkPlugins] = useState<RemarkPluginList>(
      emptyRemarkPluginList,
    );
    const needsMath = useMemo(() => containsMathSyntax(markdown), [markdown]);
    const needsMermaid = containsMermaidFence(markdown);

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

    // Mermaid is not a plugin, so it loads on its own schedule — but on the
    // same terms as the math bundle above: multiple megabytes that only
    // markdown carrying a diagram is allowed to pull in. Starting here rather
    // than waiting for `MermaidDiagram` to mount overlaps the download with the
    // rest of the fence streaming in.
    useEffect(() => {
      if (needsMermaid) {
        prefetchMermaid();
      }
    }, [needsMermaid]);

    return (
      <MarkdownTaskContext value={{ assetBaseUrl, taskId }}>
        <ReactMarkdown
          components={{
            a: MarkdownLink,
            code: markdownCode,
            img: ({
              alt,
              className,
              node: _node,
              ref: _ref,
              src,
              ...props
            }) => {
              const resolvedSrc = resolveImageSrc(src, assetBaseUrl);
              if (!isImageAllowed(resolvedSrc)) {
                return hideImages ? null : (
                  <ImagePlaceholder alt={alt} src={resolvedSrc} />
                );
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
            ol: markdownOrderedList,
            pre: markdownPre,
          }}
          rehypePlugins={rehypePlugins}
          remarkPlugins={[remarkGfm, remarkBreaks, ...remarkPlugins]}
          urlTransform={markdownUrlTransform}
        >
          {remend(markdown)}
        </ReactMarkdown>
      </MarkdownTaskContext>
    );
  },
);

Markdown.displayName = "Markdown";
