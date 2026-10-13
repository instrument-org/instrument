import { useGuest } from "@/client/hooks/use-browser-targets";
import { useFindTarget } from "@/client/hooks/use-find-target";
import { getGuest, pageHoldingKeyboard } from "@/client/lib/browser-pool";
import { registerForegroundBrowser } from "@/client/lib/foreground-browser-registry";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Find-in-page state and wiring for a browser panel's guest. Owns the find bar's
 * open/query/result state, mirrors the guest's `found-in-page` matches, registers
 * as the Cmd+F target while foreground, and focuses the input on open. Resets
 * when the guest is reaped (`active` -> false) so a later reopen starts clean.
 */
export function useBrowserFind({
  active,
  covered = false,
  isVisible,
  surfaceRef,
  targetId,
}: {
  active: boolean;
  // This host is behind a full-window overlay, so it is not the one Cmd+F
  // should reach. The opener is a single slot: without this, a host that parks
  // its guest keeps claiming it, and an overlay that takes the slot and clears
  // it on unmount leaves the panel -- whose own inputs never changed -- never
  // re-registering, so Cmd+F stops working entirely.
  covered?: boolean;
  isVisible: boolean;
  /** The panel, which Cmd+F means while the keyboard is in it. */
  surfaceRef: RefObject<Element | null>;
  targetId: BrowserTargetId;
}) {
  const findInputRef = useRef<HTMLInputElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  // Active match / total from the guest's `found-in-page` event; null before any
  // search runs (or after it's cleared).
  const [findResult, setFindResult] = useState<null | {
    active: number;
    matches: number;
  }>(null);

  // Mirror the guest's match count into the find bar. Runs whenever the guest
  // is there; it fires this for every find and clears its highlights on
  // navigation, so a stale count self-corrects on the next search.
  const guest = useGuest(active ? targetId : null);
  useEffect(
    () =>
      guest?.on("found-in-page", ({ result }) => {
        setFindResult({
          active: result.activeMatchOrdinal,
          matches: result.matches,
        });
      }),
    [guest],
  );

  // The guest outlives this panel (it's pooled, not reaped on panel close), so a
  // find left highlighted stays highlighted when the panel remounts with the bar
  // closed. Clear the guest's highlight on unmount so a reopen starts clean.
  useEffect(() => {
    return () => {
      getGuest(targetId)?.stopFind("clearSelection");
    };
  }, [targetId]);

  // Register this panel as the foreground browser, so Cmd+R reloads its guest,
  // and as a find target, so Cmd+F opens (and re-focuses) its find bar when the
  // keyboard is in the panel or its page, or was last; see
  // foreground-browser-registry for why neither chord can be a renderer keydown.
  const isForeground = active && isVisible && !covered;
  useEffect(() => {
    if (!isForeground) {
      return;
    }
    return registerForegroundBrowser({ targetId });
  }, [isForeground, targetId]);
  useFindTarget({
    anchor: surfaceRef,
    enabled: isForeground,
    holdsKeyboard: () => pageHoldingKeyboard() === targetId,
    openFind: () => {
      setFindOpen(true);
      findInputRef.current?.focus();
      findInputRef.current?.select();
    },
  });

  // Focus the find input when the bar opens (its first render, when the opener
  // above couldn't focus it yet). Deferred a frame so it wins over Radix
  // returning focus to the overflow trigger when opened from the menu.
  useEffect(() => {
    if (!findOpen) {
      return;
    }
    const raf = requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [findOpen]);

  // The guest can be reaped (active -> false) while the bar is open; drop its
  // state during render (the pattern React allows over a cascading effect) so a
  // later reopen starts clean rather than showing a stale query and count.
  const [prevActive, setPrevActive] = useState(active);
  if (prevActive !== active) {
    setPrevActive(active);
    if (!active && findOpen) {
      setFindOpen(false);
      setFindQuery("");
      setFindResult(null);
    }
  }

  // Empty query clears the highlight; otherwise search. `forward` is only passed
  // for next/prev stepping (Enter / the arrows); a fresh keystroke omits it so
  // the guest re-anchors from the top.
  const runFind = (query: string, options?: { forward: boolean }) => {
    const target = getGuest(targetId);
    if (!target) {
      return;
    }
    if (!query) {
      target.stopFind("clearSelection");
      setFindResult(null);
      return;
    }
    target.find(
      query,
      options ? { findNext: true, forward: options.forward } : undefined,
    );
  };

  const closeFind = () => {
    getGuest(targetId)?.stopFind("clearSelection");
    setFindOpen(false);
    setFindQuery("");
    setFindResult(null);
  };

  return {
    closeFind,
    findInputRef,
    findOpen,
    findQuery,
    findResult,
    runFind,
    setFindOpen,
    setFindQuery,
  };
}
