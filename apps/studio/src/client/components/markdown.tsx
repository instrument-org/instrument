import { openFilePreviewAtom } from "@/client/atoms/file-preview";
import { appendToPromptAtom } from "@/client/atoms/prompt-value";
import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useFileDrag } from "@/client/hooks/use-file-drag";
import { useTaskPaneActions } from "@/client/hooks/use-task-pane";
import {
  AGENT_FILES_LANGUAGE,
  isAddressableTaskFilePath,
  type TaskId,
} from "@instrument-org/workspace/client";
import { ImageIcon } from "@phosphor-icons/react/Image";
import { useSetAtom } from "jotai";
import {
  isValidElement,
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
  type ExtraProps,
  type Options,
  type UrlTransform,
} from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remend from "remend";

import { useHashLinkScroll } from "../hooks/use-hash-link-scroll";
import { getAssetUrl } from "../lib/get-asset-url";
import {
  isImageSourceAllowed,
  MARKDOWN_IMAGE_KINDS,
  MARKDOWN_IMAGE_KINDS_WITH_REMOTE,
} from "../lib/image-policy";
import {
  containsMermaidFence,
  isMermaidLanguage,
  prefetchMermaid,
} from "../lib/mermaid";
import { rehypeAnimateWords } from "../lib/rehype-animate-words";
import { remarkDropBreakAfterBr } from "../lib/remark-drop-break-after-br";
import { isTaskFileHref, taskFilePathFromHref } from "../lib/task-file-href";
import { cn } from "../lib/utils";
import { AgentFilesBlock } from "./agent-files-block";
import { MarkdownCodeBlock } from "./code-block";
import { FileActionsMenuItems } from "./file-actions-menu";
import { FileIcon } from "./file-icon";
import {
  INLINE_CHIP_CLASS_NAME,
  INLINE_CHIP_ICON_CLASS_NAME,
  InlineLink,
} from "./inline-link";
import { MarkdownTable } from "./markdown-table";
import { MarkdownTaskContext } from "./markdown-task-context";
import { MermaidDiagram } from "./mermaid-diagram";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { contextMenuComponents } from "./ui/menu-components";

interface MarkdownProps {
  /**
   * Whether an image may be fetched from one of the allowed remote hosts.
   *
   * Defaults to true, which is right for markdown the agent wrote or the user
   * did. Pass false for markdown that arrived inside a file someone else
   * authored: loading a remote image is a request the moment the file is
   * opened, with no click in between, which discloses an IP and confirms the
   * file was read. The notebook viewer passes false for that reason, and loses
   * nothing by it -- a notebook's own images are embedded.
   */
  allowRemoteImages?: boolean;
  assetBaseUrl?: string;
  // Which bytes this text's file references are about; see
  // `MarkdownTaskContext`.
  assetVersion?: string;
  // Drops the images the allow-list rejects instead of standing a placeholder
  // in for them. For markdown scraped from a page rather than authored for us:
  // the allow-list passes nothing such a page carries, so every placeholder is
  // permanent, and being block-level each one interrupts the prose it sits in
  // to name a picture the reader will never see.
  hideImages?: boolean;
  // Fades each word in as it arrives, and is passed through to the constructs
  // that resolve their own contents; see `MarkdownTaskContext`.
  isStreaming?: boolean;
  markdown: string;
  // Present only when rendered inside a task chat. Enables the task-file
  // right-click menu (Open in {App} / Save as… / Reveal / …); left-click
  // open-in-panel works without it.
  taskId?: TaskId;
}

type PluginList = NonNullable<Options["rehypePlugins"]>;
type RemarkPluginList = NonNullable<Options["remarkPlugins"]>;

const emptyRemarkPluginList: RemarkPluginList = [];

type FenceNode = NonNullable<ExtraProps["node"]>;

function containsMathSyntax(markdown: string) {
  return /```math\b|\\\(|\\\[|\\begin\{[a-z*]+\}|\$\$[\s\S]*?\$\$/.test(
    markdown,
  );
}

/**
 * What raw HTML is held to once `rehype-raw` has re-parsed it: an author's
 * `<details>` and a README's `<img width>` are drawn, while an `onerror`, a
 * `<script>`, or a `style` never reaches the renderer process. The markdown
 * here is not ours -- a model wrote it, or it is a `.md` file that arrived in a
 * download or a folder the user shared -- so the allow-list is what makes
 * parsing it at all safe.
 *
 * Two departures from the default. `file:` is how a model spells a link to a
 * file it just wrote, which `markdownUrlTransform` reduces to a path and
 * `TaskFileLink` then judges against the task and its mounts.
 *
 * And `data:` on a `src`, without which an embedded image is dropped by the
 * pass rather than by any policy: the default admits `http` and `https` there
 * and nothing else, and this pass runs over the whole document rather than only
 * the markup it re-parsed. So a notebook cell holding both a `<br>` and one of
 * its own attachments lost the attachment, which is the case attachments exist
 * for. What a `data:` src may actually carry is still `isImageAllowed`'s
 * question, one place rather than two, and the tag names above are what keep
 * this reaching an `<img>` rather than an `iframe`, an `embed`, or a `script`.
 */
const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "file"],
    src: [...(defaultSchema.protocols?.src ?? []), "data"],
  },
};

// Only a document carrying HTML this renderer would actually draw is worth
// re-parsing, which is why this reads the allow-list rather than looking for
// anything angle-bracketed. Prose holding `Array<string>` keeps rendering as
// itself: turning the parser on for it would cost the word, since an unknown
// tag is unwrapped rather than shown.
const rawHtmlPattern = new RegExp(
  `<!--|</?(?:${(defaultSchema.tagNames ?? []).join("|")})(?=[\\s/>])`,
  "i",
);

// `rehype-slug` is what makes a link to a heading resolve to anything, so it
// runs for every document rather than waiting on the effect below -- an id that
// only appears on the second render is one a reader can click through first.
const baseRehypePlugins: PluginList = [rehypeSlug];

const nodeText = (node: FenceNode["children"][number]): string => {
  if (node.type === "text") {
    return node.value;
  }
  return node.type === "element" ? node.children.map(nodeText).join("") : "";
};

// A fence's info string is whatever the model wrote after the language, and the
// conventions in the wild are a bare path, ``` ```ts title="src/foo.ts" ```, and
// ``` ```ts:src/foo.ts ```. Anything else there -- a line range, a highlighter
// directive -- names no file, so a filename has to look like one.
const fenceFilename = (candidate: string | undefined): string | undefined => {
  const bare = /^(?:(?:file|filename|title)=)?["']?([^"'\s]+)["']?$/.exec(
    candidate?.trim() ?? "",
  )?.[1];
  return bare && /[^/]\.\w+$/.test(bare) ? bare : undefined;
};

// The `meta` mdast hands to hast for the rest of the info string. Read
// structurally rather than off the type: `ElementData` only carries the field
// where the plugin that sets it has been loaded for its types too.
const fenceMeta = (data: unknown): string | undefined =>
  data &&
  typeof data === "object" &&
  "meta" in data &&
  typeof data.meta === "string"
    ? data.meta
    : undefined;

interface Fence {
  code: string;
  filename?: string;
  language?: string;
}

const readFence = (node: FenceNode | undefined): Fence | undefined => {
  const code = node?.children.find(
    (child) => child.type === "element" && child.tagName === "code",
  );
  if (code?.type !== "element") {
    return undefined;
  }

  const className = code.properties.className;
  const info = (Array.isArray(className) ? className.map(String) : [])
    .find((name) => name.startsWith("language-"))
    ?.slice("language-".length);
  // `lang:path` puts the filename where the language goes, which would
  // otherwise leave the block both unhighlighted and unlabeled.
  const [language, taggedFilename] = info?.split(":") ?? [];

  return {
    code: nodeText(code).replace(/\n$/, ""),
    filename: fenceFilename(taggedFilename ?? fenceMeta(code.data)),
    language: language || undefined,
  };
};

// Only the `pre` is told which code is which: an inline `code` element is
// indistinguishable from the one inside a fence when all you have is the
// element itself. Reading the fence from here is what lets a fence with no
// language be a block at all -- reached through `code`, it fell through to the
// inline branch, where a browser collapses its newlines into spaces.
const markdownPre: Components["pre"] = ({ children, node }) => {
  const fence = readFence(node);

  // Raw HTML can carry a `pre` that holds anything, and there is no fence to
  // read; whatever it holds has already been rendered.
  if (!fence) {
    return <pre>{children}</pre>;
  }

  if (fence.language === AGENT_FILES_LANGUAGE) {
    return <AgentFilesBlock content={fence.code} />;
  }

  if (fence.language && isMermaidLanguage(fence.language)) {
    return <MermaidDiagram code={fence.code} language={fence.language} />;
  }

  return (
    <MarkdownCodeBlock
      code={fence.code}
      filename={fence.filename}
      language={fence.language}
    />
  );
};

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

// Renders a link to a file the agent produced as an interactive chip that opens
// the file in the artifact panel.
//
// Drawn from the path, with nothing asked of the server. What that trades away
// is the old behavior where a path matching no real file rendered as plain
// text: a hallucinated path is now a chip like any other. That is the better
// failure. Degrading to prose hid the fact that the reply claimed a file at
// all, while a chip that reports itself missing when clicked says what
// happened -- and is the only answer that can be right about a file deleted a
// minute after the message was written.
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
  const filename = filePath.split("/").at(-1) ?? filePath;
  const { openFiles } = useTaskPaneActions(taskId);
  const appendToPrompt = useSetAtom(appendToPromptAtom);
  // Before the guard below, so the chip that turns out not to name a task file
  // still asks in the same order every render.
  const dragProps = useFileDrag(
    taskId && isAddressableTaskFilePath(filePath)
      ? { filePath, taskId }
      : undefined,
  );

  if (!isAddressableTaskFilePath(filePath)) {
    return <span className={className}>{children}</span>;
  }

  const openInPanel = () => {
    openFiles([filePath]);
  };

  const chip = (
    <button
      className={cn(INLINE_CHIP_CLASS_NAME, className)}
      onClick={openInPanel}
      title={filePath}
      type="button"
      {...dragProps}
    >
      <FileIcon className={INLINE_CHIP_ICON_CLASS_NAME} filename={filename} />
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
    filename,
    filePath,
    taskId,
    url: getAssetUrl({ assetBase: assetBaseUrl, filePath }),
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
              update: filePath,
            });
          }}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
};

// The label as text, which is what the destination is compared against.
//
// Walked rather than read off the top, because the markup a label carries is
// not the reader's problem: a model writing a host in backticks or bold has
// still written the host, and comparing against an element instead would put a
// redundant origin after every one of them. Anything with no text in it at all
// comes back empty and is disclosed, which is the same answer a label that says
// nothing gets.
const plainText = (children: ReactNode): string => {
  if (typeof children === "string") {
    return children;
  }
  if (Array.isArray(children)) {
    return children.map((child: ReactNode) => plainText(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return plainText(children.props.children);
  }
  return "";
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
  //
  // An anchor that never had an href is the other thing this shape covers: a
  // link target rather than a link, which is how a document written for another
  // renderer names a place in itself. Nothing to open there either, but the name
  // is the whole point of it, so the id comes along.
  if (!href) {
    return (
      <span className={className} id={props.id}>
        {children}
      </span>
    );
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
    <InlineLink
      {...props}
      className={className}
      href={href}
      label={plainText(children)}
    >
      {children}
    </InlineLink>
  );
};

const isImageAllowed = (
  src: string | undefined,
  allowRemoteImages: boolean,
): boolean =>
  isImageSourceAllowed(
    src,
    allowRemoteImages ? MARKDOWN_IMAGE_KINDS_WITH_REMOTE : MARKDOWN_IMAGE_KINDS,
  );

// react-markdown's own URL filter drops every `data:` URI before a component
// ever sees it, so an embedded image silently rendered as nothing -- which is
// how a notebook's attachments arrive, and the only way they can arrive. This
// hands them back for `<img>` alone and decides nothing else: what a `data:`
// src may actually carry stays with `isImageAllowed` above, one place rather
// than two. A `data:` *link* is still dropped, because clicking one hands the
// URI to the OS via `shell.openExternal`, which an image never does, and so is
// a `data:` src anywhere but an `<img>` -- `iframe`, `embed`, and `script`
// carry one too, which is why the raw-HTML allow-list drops all three.
//
// `file:` is how a model spells a link to a file it just wrote, and the default
// transform drops the href whole rather than pass a scheme it does not know.
// Reduce such a URL to its path so it reaches `TaskFileLink` on the same terms
// as any other file reference. Passing it through instead only ever reaches
// `ExternalLink`, where the protocol allowlist refuses it: a blocked-link toast
// and a captured exception, never an opened file.
const markdownUrlTransform: UrlTransform = (url, key, node) => {
  if (key === "src" && node.tagName === "img" && url.startsWith("data:")) {
    return url;
  }
  if (!/^file:/i.test(url)) {
    return defaultUrlTransform(url);
  }
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
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

/**
 * An image the message points at, which can turn out not to be there: an asset
 * pruned with its task, a path the model wrote from memory. Left alone that
 * draws as the browser's broken-image glyph, which names neither the image nor
 * what went wrong; the placeholder a blocked image already gets says both.
 *
 * The failure is held against the source that produced it, so a URL still
 * growing clears it as it goes.
 */
const MarkdownImage = ({
  alt,
  className,
  filePath,
  src,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  // The task-relative path behind `src`, when there is one. An embed can just
  // as well point at a real URL, which names no file to hand anyone.
  filePath?: string;
}) => {
  const { isStreaming, taskId } = useContext(MarkdownTaskContext);
  const [failedSrc, setFailedSrc] = useState<null | string>(null);
  const dragProps = useFileDrag(
    filePath && taskId ? { filePath, taskId } : undefined,
  );

  if (src !== undefined && src === failedSrc) {
    // Half a URL fails the same way a missing file does, and until the text
    // settles there is no telling which this is.
    return isStreaming ? null : <ImagePlaceholder alt={alt} src={src} />;
  }

  return (
    <img
      {...props}
      alt={alt}
      className={cn("max-w-full cursor-pointer! rounded-md", className)}
      onError={() => {
        setFailedSrc(src ?? null);
      }}
      src={src}
      {...dragProps}
    />
  );
};

const isAbsoluteImageSrc = (src: string) =>
  /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//");

const resolveImageSrc = (
  src: string | undefined,
  assetBaseUrl: string | undefined,
  assetVersion: string | undefined,
): string | undefined => {
  if (!src) {
    return src;
  }
  // Leave real URLs (http/https/data/blob) and protocol-relative srcs for the
  // allow-list to judge; only resolve task-relative paths against the asset
  // origin. This covers bare `output/x.png` in addition to `./`/`../`.
  if (isAbsoluteImageSrc(src)) {
    return src;
  }
  if (!assetBaseUrl) {
    return src;
  }
  return getAssetUrl({
    assetBase: assetBaseUrl,
    filePath: src,
    version: assetVersion,
  });
};

/**
 * The task file an `![](...)` embed points at, for the surfaces that act on the
 * file rather than on the picture.
 *
 * Written against the source as authored rather than the resolved asset URL:
 * the path is what the rest of the app names a file by, and reading it back out
 * of a URL means re-deriving something we were handed.
 */
const taskFilePathFromImageSrc = (src: string | undefined) =>
  src && !isAbsoluteImageSrc(src) && isAddressableTaskFilePath(src)
    ? src
    : undefined;

export const Markdown = memo(
  ({
    allowRemoteImages = true,
    assetBaseUrl,
    assetVersion,
    hideImages,
    isStreaming,
    markdown,
    taskId,
  }: MarkdownProps) => {
    const openFilePreview = useSetAtom(openFilePreviewAtom);
    const [rehypePlugins, setRehypePlugins] =
      useState<PluginList>(baseRehypePlugins);
    const [remarkPlugins, setRemarkPlugins] = useState<RemarkPluginList>(
      emptyRemarkPluginList,
    );
    const needsMath = useMemo(() => containsMathSyntax(markdown), [markdown]);
    const needsRawHtml = useMemo(
      () => rawHtmlPattern.test(markdown),
      [markdown],
    );
    const needsMermaid = containsMermaidFence(markdown);

    const handleImageClick = useCallback(
      (event: React.MouseEvent<HTMLImageElement>, filePath?: string) => {
        const src = event.currentTarget.src;
        const alt = event.currentTarget.alt || "image";
        if (src) {
          // The path rides along so the expanded view can act on the file and
          // not just draw it. Absent for an embed pointing at a real URL, where
          // there is no file to act on.
          openFilePreview({ filename: alt, filePath, taskId, url: src });
        }
      },
      [openFilePreview, taskId],
    );

    useEffect(() => {
      let isCancelled = false;

      async function loadPlugins() {
        const nextRehypePlugins: PluginList = [];
        const nextRemarkPlugins: RemarkPluginList = [];

        // The HTML parser behind `rehype-raw` is the largest thing this
        // component can pull in, so it waits for a document that has HTML in
        // it. Sanitizing is only meaningful over a tree it has re-parsed, so
        // the pair goes in together.
        if (needsRawHtml) {
          const { default: rehypeRaw } = await import("rehype-raw");

          nextRehypePlugins.push(rehypeRaw, [rehypeSanitize, sanitizeSchema]);
        }

        // After the sanitize pass, so the ids it generates are the ones a
        // heading link in the same document was written against rather than
        // the clobber-prefixed spelling.
        nextRehypePlugins.push(...baseRehypePlugins);

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
    }, [needsMath, needsRawHtml]);

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

    // The word split goes last, after everything that reads the text of a node
    // whole: the HTML `rehype-raw` re-parses, the formulas `rehype-katex`
    // consumes. It leaves the pipeline the moment the text settles, so a
    // finished message carries no spans at all.
    const streamingRehypePlugins = isStreaming
      ? [...rehypePlugins, rehypeAnimateWords]
      : rehypePlugins;

    return (
      <MarkdownTaskContext
        value={{ assetBaseUrl, assetVersion, isStreaming, taskId }}
      >
        <ReactMarkdown
          components={{
            a: MarkdownLink,
            img: ({
              alt,
              className,
              node: _node,
              ref: _ref,
              src,
              ...props
            }) => {
              const resolvedSrc = resolveImageSrc(
                src,
                assetBaseUrl,
                assetVersion,
              );
              if (!isImageAllowed(resolvedSrc, allowRemoteImages)) {
                return hideImages ? null : (
                  <ImagePlaceholder alt={alt} src={resolvedSrc} />
                );
              }
              const filePath = taskFilePathFromImageSrc(src);
              return (
                <MarkdownImage
                  {...props}
                  alt={alt}
                  className={className}
                  filePath={filePath}
                  onClick={(event) => {
                    handleImageClick(event, filePath);
                  }}
                  src={resolvedSrc}
                />
              );
            },
            ol: markdownOrderedList,
            pre: markdownPre,
            table: MarkdownTable,
          }}
          rehypePlugins={streamingRehypePlugins}
          remarkPlugins={[
            remarkGfm,
            remarkBreaks,
            remarkDropBreakAfterBr,
            ...remarkPlugins,
          ]}
          urlTransform={markdownUrlTransform}
        >
          {remend(markdown)}
        </ReactMarkdown>
      </MarkdownTaskContext>
    );
  },
);

Markdown.displayName = "Markdown";
