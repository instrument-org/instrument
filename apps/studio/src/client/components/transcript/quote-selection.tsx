import { AskButton } from "@/client/components/document-viewers/ask-selection";
import { type VirtualElement } from "@floating-ui/dom";
import { useEffect, useState } from "react";

/**
 * Offers to quote words selected in a reply: a Quote button by the selection,
 * which hands the words to the box. Only words within one of the chat's
 * replies, since a tool's output or the person's own message is not something
 * to answer.
 */
export function QuoteSelection({
  onQuote,
  rootRef,
}: {
  onQuote: (words: string) => void;
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

  return picked ? (
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
