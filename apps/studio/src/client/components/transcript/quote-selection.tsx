import { AskButton } from "@/client/components/document-viewers/ask-selection";
import { type VirtualElement } from "@floating-ui/dom";
import { useMessageScroller } from "@/client/components/ui/message-scroller";
import { useOptionalFarRows } from "@/client/components/ui/scroll-owner/far-rows-context";
import { centeringJump } from "@/client/components/task/chat-find";
import { keepDrawn } from "@/client/components/ui/scroll-owner/keep-drawn";
import { useEffect, useId, useImperativeHandle, useState } from "react";

export interface QuoteSelectionRef {
  /** Brings quoted words into view, where the transcript still has them. */
  show: (words: string) => Promise<void>;
}

/**
 * Offers to quote words selected in a reply: a Quote button by the selection,
 * which hands the words to the box, and paints the words the box has quoted
 * for as long as it has them. Only words within one of the chat's
 * replies, since a tool's output or the person's own message is not something
 * to answer.
 */
export function QuoteSelection({
  onQuote,
  quoted,
  ref,
  rootRef,
}: {
  onQuote: (words: string) => void;
  /** The quotes the box has, as a JSON list. */
  quoted: string;
  ref?: React.Ref<QuoteSelectionRef>;
  rootRef: React.RefObject<HTMLElement | null>;
}) {
  const [picked, setPicked] = useState<null | {
    reference: VirtualElement;
    words: string;
  }>(null);

  useEffect(() => {
    let pressed = false;
    let frame = 0;
    const update = () => {
      if (pressed) {
        return;
      }
      const root = rootRef.current;
      setPicked(root && readSelection(root));
    };
    const onDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        rootRef.current?.contains(event.target)
      ) {
        pressed = true;
        setPicked(null);
      }
    };
    // Shown once the drag ends, not while it is still building.
    const onUp = () => {
      if (pressed) {
        pressed = false;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(update);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    document.addEventListener("selectionchange", update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
      document.removeEventListener("selectionchange", update);
    };
  }, [rootRef]);

  const { releaseAutoScroll, scrollToMessage } = useMessageScroller();
  const farRows = useOptionalFarRows();
  useImperativeHandle(ref, () => ({
    show: async (words) => {
      const root = rootRef.current;
      if (!root) {
        return;
      }
      // Words in a turn drawn as a box are drawn first, the newest such turn.
      const boxed = findQuoted(root, words)
        ? undefined
        : farRows?.boxesHaving({ words }).at(-1);
      if (farRows && boxed) {
        await keepDrawn(farRows, root, QUOTE_KEEPS, new Set([boxed]));
      }
      const range = findQuoted(root, words);
      const viewport = root.closest<HTMLElement>(
        '[data-slot="message-scroller-viewport"]',
      );
      const jump = range && viewport && centeringJump(range, viewport);
      if (jump) {
        releaseAutoScroll();
        scrollToMessage(jump.messageId, {
          align: "start",
          scrollMargin: jump.margin,
        });
      }
    },
  }));

  const highlight = `chat-quoted-${useId().replaceAll(/[^\da-z]/gi, "")}`;
  useEffect(() => {
    const root = rootRef.current;
    // Only this app's own list of words is ever handed in.
    const quotes = JSON.parse(quoted) as string[];
    if (!root || quotes.length === 0) {
      return;
    }
    let frame = 0;
    const paint = () => {
      CSS.highlights.set(
        highlight,
        new Highlight(
          ...quotes.flatMap((words) => findQuoted(root, words) ?? []),
        ),
      );
    };
    paint();
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    });
    observer.observe(root, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      CSS.highlights.delete(highlight);
    };
  }, [highlight, quoted, rootRef]);

  const button = picked ? (
    <AskButton
      label="Quote"
      onAsk={() => {
        setPicked(null);
        document.getSelection()?.removeAllRanges();
        onQuote(picked.words);
      }}
      onDismiss={() => {
        setPicked(null);
      }}
      reference={picked.reference}
    />
  ) : null;
  return (
    <>
      <style>
        {`::highlight(${highlight}) { background-color: color-mix(in oklab, var(--color-brand-500) 15%, transparent); }`}
      </style>
      {button}
    </>
  );
}

/**
 * Who keeps a turn drawn for the quote last shown (`FarRows.keep`), until
 * another is.
 */
const QUOTE_KEEPS = "quote";

/**
 * Where quoted words are in the newest reply that has them. Compared without
 * spaces, since a selection's line breaks are the layout's and the page's text
 * has none between its paragraphs.
 */
function findQuoted(root: HTMLElement, words: string): Range | undefined {
  const needle = words.replaceAll(/\s/g, "");
  if (!needle) {
    return undefined;
  }
  for (const reply of [
    ...root.querySelectorAll("[data-reply-row]"),
  ].reverse()) {
    const at: { node: Text; offset: number }[] = [];
    let text = "";
    const walker = document.createTreeWalker(reply, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node instanceof Text)) {
        continue;
      }
      for (let offset = 0; offset < node.data.length; offset++) {
        const char = node.data.charAt(offset);
        if (!/\s/.test(char)) {
          text += char;
          at.push({ node, offset });
        }
      }
    }
    const from = text.indexOf(needle);
    const start = at[from];
    const end = at[from + needle.length - 1];
    if (from !== -1 && start && end) {
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset + 1);
      return range;
    }
  }
  return undefined;
}

function readSelection(root: HTMLElement) {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const { startContainer } = range;
  const start =
    startContainer instanceof Element
      ? startContainer
      : startContainer.parentElement;
  const reply = start?.closest("[data-reply-row]");
  const words = selection.toString().trim();
  if (!reply || !root.contains(reply) || !words) {
    return null;
  }
  // A triple click on a reply's last line ends the selection at the start of
  // whatever follows, with none of its words.
  const past = document.createRange();
  past.selectNodeContents(reply);
  past.collapse(false);
  if (past.compareBoundaryPoints(Range.END_TO_END, range) < 0) {
    past.setEnd(range.endContainer, range.endOffset);
    if (past.toString().trim()) {
      return null;
    }
  }
  return {
    reference: {
      contextElement: reply,
      getBoundingClientRect: () => range.getBoundingClientRect(),
      getClientRects: () => range.getClientRects(),
    },
    words,
  };
}
