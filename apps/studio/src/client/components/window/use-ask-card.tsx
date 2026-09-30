import { type ReferenceElement } from "@floating-ui/dom";
import { useState } from "react";

import { AskPopover } from "./ask-popover";
import { useStageAsk } from "./staged-asks";

/** What a surface knows about the place an ask is about to be written for. */
export interface PendingAsk {
  excerpt?: string;
  /** Told the ask was let go without being kept. */
  onCancel?: () => void;
  /** Told the new ask's id once it is staged, to mark its place. */
  onStaged?: (id: string) => void;
  reference: ReferenceElement;
  target: string;
}

/**
 * The ask card for one file: `begin` opens it over a place, and keeping it
 * stages the ask for that file. Every surface that marks a place (an editor's
 * selection, a document's, a file's own Ask button) opens asks through this.
 */
export function useAskCard(path: string) {
  const stage = useStageAsk();
  const [pending, setPending] = useState<null | PendingAsk>(null);
  const card = pending ? (
    <AskPopover
      onCancel={() => {
        pending.onCancel?.();
        setPending(null);
      }}
      onSubmit={(instruction) => {
        const id = stage({
          ...(pending.excerpt ? { excerpt: pending.excerpt } : {}),
          instruction,
          path,
          target: pending.target,
        });
        pending.onStaged?.(id);
        setPending(null);
      }}
      reference={pending.reference}
      target={pending.target}
    />
  ) : null;
  return { begin: setPending, card };
}
