import { useAtomValue, useSetAtom } from "jotai";
import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

import { Prose } from "../prose";
import { lookAtAtom, lookContentSlotAtom } from "./look-at";

/**
 * A part of a message drawn into the window's Quick Look panel while the panel
 * shows the `LookContent` with this `id`, and nothing otherwise.
 *
 * Drawn from the message rather than by the panel, so what it shows keeps the
 * message's context: a file named in a table's cell opens from that chat.
 *
 * A table is the same table, only wider: the same Markdown, styles and copy
 * controls. A grid with sortable headers and cell selection was tried here and
 * is the wrong answer: opening something and having it come back as a
 * different kind of object, whose copy works differently, costs more than the
 * sorting is worth. The widening the block already does is what gives it the
 * room, since the panel names its body a `transcript` container.
 *
 * The panel closes when the message goes (its chat closed or navigated
 * away), since nothing would be left to draw in it.
 */
export function LookedAtContent({
  children,
  id,
}: {
  children: ReactNode;
  id: string;
}) {
  const slot = useAtomValue(lookContentSlotAtom);
  const setLookAt = useSetAtom(lookAtAtom);
  useEffect(
    () => () => {
      setLookAt((shown) =>
        shown?.kind === "content" && shown.content.id === id ? null : shown,
      );
    },
    [id, setLookAt],
  );
  return slot?.id === id
    ? createPortal(
        <Prose
          className="[--transcript-room:100cqi]"
          headings="document"
          size="sm"
        >
          {children}
        </Prose>,
        slot.element,
      )
    : null;
}
